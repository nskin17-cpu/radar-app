/**
 * Radar NR — надёжный слой данных поверх Supabase.
 *
 * Главный принцип: НИ ОДНО изменение не может пропасть молча.
 *
 * Как это устроено:
 *  1. Заказу присваивается id на клиенте — сервер больше не нужен, чтобы узнать «кто это».
 *  2. Любое изменение СНАЧАЛА синхронно пишется в localStorage (outbox — журнал упреждающей
 *     записи). С этого момента данные переживут закрытие вкладки, перезагрузку и разряд батареи.
 *  3. Только потом outbox отправляется в Supabase. Запись считается успешной, когда Supabase
 *     ВЕРНУЛ строку (select после upsert) — не когда «запрос ушёл».
 *  4. Пока подтверждения нет, операция остаётся в очереди и повторяется с нарастающей паузой,
 *     в том числе после восстановления сети и после следующего запуска приложения.
 *  5. Все записи идемпотентны (upsert по id), поэтому повтор никогда не плодит дубли.
 */
(function () {
  'use strict';

  var CFG = window.RadarConfig;
  var listeners = [];
  var client = null;
  var columnCache = {};       // { orders: Set(колонки), ... }
  var flushing = false;
  var flushTimer = null;
  var lastStatus = { state: 'idle', pending: 0, at: null, error: null };

  // ── Supabase client (singleton — старый код создавал новый клиент на каждый запрос) ───────
  function sb() {
    if (client) return client;
    var url = window.SUPABASE_URL;
    var key = window.SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    if (!window.supabase || !window.supabase.createClient) return null;
    client = window.supabase.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 1 } }
    });
    return client;
  }
  function resetClient() { client = null; columnCache = {}; }

  // ── Утилиты ──────────────────────────────────────────────────────────────────────────────
  function num(v, dflt) { var n = Number(v); return Number.isFinite(n) ? n : (dflt || 0); }
  function str(v) { return v == null ? '' : String(v); }
  function nowIso() { return new Date().toISOString(); }
  function lsGet(key, dflt) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : dflt; }
    catch (e) { return dflt; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.error('[store] localStorage переполнен:', e); return false; }
  }

  /** id заказа генерируется на клиенте — совместим со старым форматом O<epoch_ms>. */
  function makeOrderId() {
    return 'O' + Date.now() + Math.floor(Math.random() * 900 + 100);
  }

  /**
   * Человекочитаемый номер заказа. Выводится детерминированно из даты создания и id,
   * поэтому одинаково работает и для новых, и для 472 исторических заказов —
   * последовательность в БД не нужна.
   */
  function makeOrderNumber(order) {
    var src = order.createdAt || order.startDate || nowIso();
    var d = new Date(src);
    if (Number.isNaN(d.getTime())) d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var tail = str(order.id).replace(/\D/g, '').slice(-4).padStart(4, '0') || '0000';
    return 'NR-' + y + m + '-' + tail;
  }

  // ── Единая модель заказа ─────────────────────────────────────────────────────────────────
  function normalizeItem(i) {
    return {
      name: str(i && i.name).trim(),
      category: str(i && i.category).trim(),
      qty: Math.max(0, num(i && i.qty, 0)),
      price: Math.max(0, num(i && i.price, 0)),
      setup: !(i && i.setup === false)
    };
  }

  /** Приводит запись из любого источника (Supabase, Sheets, форма, кэш) к канонической модели. */
  function normalizeOrder(raw) {
    var o = raw || {};
    var items = o.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
    if (!Array.isArray(items)) items = [];

    var orderAmount = num(o.orderAmount != null ? o.orderAmount : o.order_amount, 0);
    var paidRaw = o.paidAmount != null ? o.paidAmount : o.paid_amount;
    var remainingRaw = o.remainingAmount != null ? o.remainingAmount : o.remaining_amount;
    var remaining = Math.max(0, num(remainingRaw, 0));
    var paid = paidRaw != null ? Math.max(0, num(paidRaw, 0)) : Math.max(0, orderAmount - remaining);

    var changeLog = o.changeLog || o.change_log || [];
    if (typeof changeLog === 'string') { try { changeLog = JSON.parse(changeLog); } catch (e) { changeLog = []; } }
    if (!Array.isArray(changeLog)) changeLog = [];

    var order = {
      id: str(o.id),
      orderNumber: str(o.orderNumber || o.order_number),
      createdAt: str(o.createdAt || o.created_at) || null,
      updatedAt: str(o.updatedAt || o.updated_at) || null,

      status: str(o.status) || 'preparing',
      paymentStatus: str(o.paymentStatus || o.payment_status) || 'pending_confirmation',

      clientId: str(o.clientId || o.client_id),
      clientName: str(o.clientName || o.client_name),
      clientPhone: str(o.clientPhone || o.client_phone),
      companyName: str(o.companyName || o.company_name),

      startDate: str(o.startDate || o.start_date).slice(0, 10),
      endDate: str(o.endDate || o.end_date).slice(0, 10),

      items: items.map(normalizeItem),

      deliveryType: str(o.deliveryType || o.delivery_type) || 'pickup',
      deliveryZone: str(o.deliveryZone || o.delivery_zone) || 'city',
      deliveryKm: Math.max(0, num(o.deliveryKm != null ? o.deliveryKm : o.delivery_km, 0)),
      deliveryAddress: str(o.deliveryAddress || o.delivery_address),
      deliveryCost: num(o.deliveryCost != null ? o.deliveryCost : o.delivery_cost, 0),

      setupRequired: str(o.setupRequired || o.setup_required) || 'no',
      setupCost: num(o.setupCost != null ? o.setupCost : o.setup_cost, 0),
      carryFloor: str(o.carryFloor || o.carry_floor) || 'no',

      extraChargeAmount: num(o.extraChargeAmount != null ? o.extraChargeAmount : o.extra_charge_amount, 0),
      extraChargeNote: str(o.extraChargeNote || o.extra_charge_note),

      discount: num(o.discount, 0),
      itemsTotal: num(o.itemsTotal != null ? o.itemsTotal : o.items_total, 0),
      orderAmount: orderAmount,
      budgetAmount: num(o.budgetAmount != null ? o.budgetAmount : o.budget_amount, 0),

      depositAmount: num(o.depositAmount != null ? o.depositAmount : o.deposit_amount, 0),
      depositStatus: str(o.depositStatus || o.deposit_status) || 'pending',
      compensationAmount: num(o.compensationAmount != null ? o.compensationAmount : o.compensation_amount, 0),
      compensationNote: str(o.compensationNote || o.compensation_note),

      paidAmount: paid,
      remainingAmount: Math.max(0, orderAmount - paid),

      comment: str(o.comment),
      changeLog: changeLog
    };
    if (!order.orderNumber) order.orderNumber = makeOrderNumber(order);
    return order;
  }

  var ORDER_COLUMN_MAP = {
    id: 'id',
    orderNumber: 'order_number',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    status: 'status',
    paymentStatus: 'payment_status',
    clientId: 'client_id',
    clientName: 'client_name',
    clientPhone: 'client_phone',
    companyName: 'company_name',
    startDate: 'start_date',
    endDate: 'end_date',
    items: 'items',
    deliveryType: 'delivery_type',
    deliveryZone: 'delivery_zone',
    deliveryKm: 'delivery_km',
    deliveryAddress: 'delivery_address',
    deliveryCost: 'delivery_cost',
    setupRequired: 'setup_required',
    setupCost: 'setup_cost',
    carryFloor: 'carry_floor',
    extraChargeAmount: 'extra_charge_amount',
    extraChargeNote: 'extra_charge_note',
    discount: 'discount',
    itemsTotal: 'items_total',
    orderAmount: 'order_amount',
    budgetAmount: 'budget_amount',
    depositAmount: 'deposit_amount',
    depositStatus: 'deposit_status',
    compensationAmount: 'compensation_amount',
    compensationNote: 'compensation_note',
    paidAmount: 'paid_amount',
    remainingAmount: 'remaining_amount',
    comment: 'comment',
    changeLog: 'change_log'
  };

  /** Пустые даты нельзя слать в колонку типа date — PostgREST ответит ошибкой 22007. */
  function dateOrNull(v) { return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

  function orderToRow(order) {
    var row = {};
    Object.keys(ORDER_COLUMN_MAP).forEach(function (key) {
      if (key === 'createdAt' || key === 'updatedAt') return;
      row[ORDER_COLUMN_MAP[key]] = order[key];
    });
    row.start_date = dateOrNull(order.startDate);
    row.end_date = dateOrNull(order.endDate);
    row.updated_at = nowIso();
    if (order.createdAt) row.created_at = order.createdAt;
    return row;
  }

  /**
   * Отбрасывает колонки, которых физически нет в таблице.
   * Благодаря этому приложение работает и до применения SQL-миграции, и после неё —
   * просто до миграции новые поля не сохраняются, и об этом честно пишется в консоль.
   */
  function filterToExistingColumns(table, row) {
    var known = columnCache[table];
    if (!known) return row;
    var out = {};
    var dropped = [];
    Object.keys(row).forEach(function (k) {
      if (known.has(k)) out[k] = row[k];
      else if (row[k] !== undefined && row[k] !== null && row[k] !== '' && row[k] !== 0) dropped.push(k);
    });
    if (dropped.length) console.warn('[store] в таблице ' + table + ' нет колонок: ' + dropped.join(', ') + ' — примените sql/migration-2026-07-orders.sql');
    return out;
  }

  async function loadColumns(table) {
    if (columnCache[table]) return columnCache[table];
    var s = sb();
    if (!s) return null;
    var res = await s.from(table).select('*').limit(1);
    if (res.error || !res.data || !res.data.length) return null;
    columnCache[table] = new Set(Object.keys(res.data[0]));
    return columnCache[table];
  }

  // ── История изменений ────────────────────────────────────────────────────────────────────
  var TRACKED_FIELDS = {
    clientName: 'Клиент', clientPhone: 'Телефон', companyName: 'Компания',
    startDate: 'Дата получения', endDate: 'Дата возврата',
    status: 'Статус работы', paymentStatus: 'Статус оплаты',
    deliveryType: 'Тип получения', deliveryZone: 'Зона доставки', deliveryKm: 'Км за город',
    deliveryAddress: 'Адрес', deliveryCost: 'Доставка ₽', setupCost: 'Сетап ₽',
    carryFloor: 'Пронос', extraChargeAmount: 'Доп. услуга ₽', extraChargeNote: 'Причина доп. услуги',
    discount: 'Скидка %', orderAmount: 'Общая сумма ₽', budgetAmount: 'Бюджет ₽',
    depositAmount: 'Залог ₽', depositStatus: 'Статус залога',
    compensationAmount: 'Компенсация ₽', compensationNote: 'Описание компенсации',
    paidAmount: 'Внесено ₽', comment: 'Комментарий'
  };
  var MAX_LOG = 200;

  function itemsSignature(items) {
    return (items || []).map(function (i) { return i.name + '|' + i.category + '|' + i.qty + '|' + i.price + '|' + (i.setup ? 1 : 0); }).join('~');
  }

  function buildChangeLog(prev, next, user) {
    var entries = [];
    var at = nowIso();
    var who = str(user) || 'system';
    if (!prev) {
      entries.push({ at: at, user: who, field: '_created', label: 'Заказ создан', from: null, to: null });
      return entries;
    }
    Object.keys(TRACKED_FIELDS).forEach(function (key) {
      var a = prev[key], b = next[key];
      if (typeof a === 'number' || typeof b === 'number') { a = num(a, 0); b = num(b, 0); }
      else { a = str(a); b = str(b); }
      if (a !== b) entries.push({ at: at, user: who, field: key, label: TRACKED_FIELDS[key], from: a, to: b });
    });
    if (itemsSignature(prev.items) !== itemsSignature(next.items)) {
      entries.push({
        at: at, user: who, field: 'items', label: 'Состав заказа',
        from: (prev.items || []).length + ' поз.', to: (next.items || []).length + ' поз.'
      });
    }
    return entries;
  }

  // ── Outbox: журнал упреждающей записи ────────────────────────────────────────────────────
  function readOutbox() {
    var v = lsGet(CFG.outbox.storageKey, null);
    return Array.isArray(v) ? v : [];
  }
  function writeOutbox(ops) { return lsSet(CFG.outbox.storageKey, ops.slice(0, CFG.outbox.maxOps)); }

  /**
   * Кладёт операцию в очередь. Синхронно и надёжно — возвращает true, только если
   * запись в localStorage действительно прошла.
   *
   * Операции для одной и той же сущности схлопываются: при автосохранении важно
   * последнее состояние, а не каждое нажатие клавиши.
   */
  function enqueue(kind, op, id, payload) {
    var ops = readOutbox().filter(function (x) {
      return !(x.kind === kind && x.entityId === id && x.state !== 'sending');
    });
    ops.push({
      opId: kind + ':' + id + ':' + Date.now() + ':' + Math.floor(Math.random() * 1000),
      kind: kind, op: op, entityId: id, payload: payload,
      createdAt: nowIso(), tries: 0, nextAttemptAt: 0, lastError: null, state: 'pending'
    });
    var ok = writeOutbox(ops);
    emit();
    return ok;
  }

  function removeOp(opId) {
    writeOutbox(readOutbox().filter(function (x) { return x.opId !== opId; }));
  }
  function updateOp(opId, patch) {
    var ops = readOutbox().map(function (x) { return x.opId === opId ? Object.assign({}, x, patch) : x; });
    writeOutbox(ops);
  }
  function pendingCount() { return readOutbox().length; }

  // ── Статус сохранения ────────────────────────────────────────────────────────────────────
  function onStatus(fn) { listeners.push(fn); fn(lastStatus); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function setStatus(state, error) {
    lastStatus = { state: state, pending: pendingCount(), at: nowIso(), error: error || null };
    listeners.forEach(function (fn) { try { fn(lastStatus); } catch (e) { } });
  }
  function emit() {
    var pending = pendingCount();
    if (pending === 0) { setStatus(lastStatus.state === 'error' ? 'saved' : (lastStatus.state === 'saving' ? 'saved' : lastStatus.state), null); return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    if (lastStatus.state !== 'error') setStatus('saving');
    else setStatus('error', lastStatus.error);
  }

  // ── Отправка очереди ─────────────────────────────────────────────────────────────────────
  async function sendOp(entry) {
    var s = sb();
    if (!s) throw new Error('Supabase не настроен (нет URL или ключа)');

    if (entry.kind === 'order') {
      if (entry.op === 'delete') {
        var del = await s.from('orders').delete().eq('id', entry.entityId).select('id');
        if (del.error) throw new Error(del.error.message);
        return true; // удаление уже удалённой строки — тоже успех (идемпотентно)
      }
      await loadColumns('orders');
      var row = filterToExistingColumns('orders', orderToRow(entry.payload));
      var res = await s.from('orders').upsert(row, { onConflict: 'id' }).select('id,updated_at');
      if (res.error) {
        // PGRST204 — колонки нет в схеме. Запоминаем и пробуем ещё раз без неё.
        var m = /column "?([a-z_]+)"? of relation|Could not find the '([a-z_]+)' column/i.exec(res.error.message || '');
        var bad = m && (m[1] || m[2]);
        if (bad && columnCache.orders) {
          columnCache.orders.delete(bad);
          var retryRow = filterToExistingColumns('orders', orderToRow(entry.payload));
          var res2 = await s.from('orders').upsert(retryRow, { onConflict: 'id' }).select('id,updated_at');
          if (res2.error) throw new Error(res2.error.message);
          if (!res2.data || !res2.data.length) throw new Error('Supabase не подтвердил запись');
          return true;
        }
        throw new Error(res.error.message);
      }
      // Главная проверка: строка вернулась из базы — значит запись реально применена.
      if (!res.data || !res.data.length) throw new Error('Supabase не подтвердил запись');
      return true;
    }

    if (entry.kind === 'client') {
      if (entry.op === 'delete') {
        var dc = await s.from('clients').delete().eq('id', entry.entityId).select('id');
        if (dc.error) throw new Error(dc.error.message);
        return true;
      }
      await loadColumns('clients');
      var crow = filterToExistingColumns('clients', clientToRow(entry.payload));
      var cres = await s.from('clients').upsert(crow, { onConflict: 'id' }).select('id');
      if (cres.error) throw new Error(cres.error.message);
      if (!cres.data || !cres.data.length) throw new Error('Supabase не подтвердил запись клиента');
      return true;
    }

    throw new Error('Неизвестный тип операции: ' + entry.kind);
  }

  function backoffMs(tries) {
    var base = CFG.autosave.retryBaseMs * Math.pow(2, Math.max(0, tries - 1));
    return Math.min(base, CFG.autosave.retryMaxMs);
  }

  async function flush(opts) {
    opts = opts || {};
    if (flushing) return;
    var ops = readOutbox();
    if (!ops.length) { emit(); return; }
    if (!navigator.onLine) { setStatus('offline'); scheduleFlush(5000); return; }

    flushing = true;
    setStatus('saving');
    var failed = null;
    try {
      for (var i = 0; i < ops.length; i++) {
        var entry = ops[i];
        if (!opts.force && entry.nextAttemptAt && Date.now() < entry.nextAttemptAt) continue;
        updateOp(entry.opId, { state: 'sending' });
        try {
          await sendOp(entry);
          removeOp(entry.opId);
        } catch (e) {
          var tries = (entry.tries || 0) + 1;
          updateOp(entry.opId, {
            state: 'pending', tries: tries,
            nextAttemptAt: Date.now() + backoffMs(tries),
            lastError: e && e.message ? e.message : String(e)
          });
          failed = e;
        }
      }
    } finally {
      flushing = false;
    }

    var left = pendingCount();
    if (left === 0) setStatus('saved');
    else if (failed) { setStatus('error', failed.message || String(failed)); scheduleFlush(backoffMs(1)); }
    else scheduleFlush(2000);
  }

  function scheduleFlush(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flush(); }, ms || 0);
  }

  // ── Публичное API: заказы ────────────────────────────────────────────────────────────────

  /**
   * Сохраняет заказ. Возвращает { id, order, queued:true } СРАЗУ после того,
   * как данные легли в localStorage. Отправка в Supabase идёт следом,
   * её результат приходит подписчикам onStatus.
   */
  function saveOrder(input, opts) {
    opts = opts || {};
    var order = normalizeOrder(input);
    if (!order.id) order.id = makeOrderId();
    if (!order.createdAt) order.createdAt = nowIso();
    if (!order.orderNumber) order.orderNumber = makeOrderNumber(order);
    order.updatedAt = nowIso();

    var prev = opts.previous ? normalizeOrder(opts.previous) : null;
    var changes = buildChangeLog(prev, order, opts.user);
    if (changes.length) {
      order.changeLog = (prev && prev.changeLog ? prev.changeLog : (order.changeLog || [])).concat(changes).slice(-MAX_LOG);
    }

    var stored = enqueue('order', 'upsert', order.id, order);
    updateOrdersCache(order);
    if (!stored) {
      setStatus('error', 'Не удалось записать в локальное хранилище (переполнен localStorage)');
      return { id: order.id, order: order, queued: false };
    }
    scheduleFlush(0);
    return { id: order.id, order: order, queued: true };
  }

  function deleteOrder(id) {
    if (!id) return { queued: false };
    enqueue('order', 'delete', id, { id: id });
    removeFromOrdersCache(id);
    scheduleFlush(0);
    return { queued: true };
  }

  function saveClient(input) {
    var c = normalizeClient(input);
    if (!c.id) c.id = 'CL' + Date.now() + Math.floor(Math.random() * 900 + 100);
    enqueue('client', 'upsert', c.id, c);
    scheduleFlush(0);
    return { id: c.id, client: c, queued: true };
  }
  function deleteClient(id) {
    if (!id) return { queued: false };
    enqueue('client', 'delete', id, { id: id });
    scheduleFlush(0);
    return { queued: true };
  }

  function normalizeClient(c) {
    c = c || {};
    return {
      id: str(c.id),
      name: str(c.name || c.clientName).trim(),
      company: str(c.company || c.companyName).trim(),
      phone: str(c.phone || c.clientPhone).trim(),
      proDiscount: num(c.proDiscount != null ? c.proDiscount : c.pro_discount, 0),
      city: str(c.city).trim() || 'Ростов-на-Дону',
      comment: str(c.comment).trim(),
      totalOrders: num(c.totalOrders != null ? c.totalOrders : c.total_orders, 0),
      totalTurnover: num(c.totalTurnover != null ? c.totalTurnover : c.total_turnover, 0),
      totalRevenue: num(c.totalRevenue != null ? c.totalRevenue : c.total_revenue, 0)
    };
  }
  function clientToRow(c) {
    return {
      id: c.id, name: c.name, company: c.company || null, phone: c.phone || null,
      pro_discount: num(c.proDiscount, 0), city: c.city || null, comment: c.comment || null,
      total_orders: num(c.totalOrders, 0), total_turnover: num(c.totalTurnover, 0),
      total_revenue: num(c.totalRevenue, 0), updated_at: nowIso()
    };
  }

  // ── Кэш для мгновенного старта и работы офлайн ───────────────────────────────────────────
  function getOrdersCache() { var v = lsGet(CFG.cache.ordersKey, []); return Array.isArray(v) ? v.map(normalizeOrder) : []; }
  function setOrdersCache(list) { lsSet(CFG.cache.ordersKey, list); }
  function updateOrdersCache(order) {
    var list = getOrdersCache();
    var ix = list.findIndex(function (o) { return o.id === order.id; });
    if (ix >= 0) list[ix] = order; else list.push(order);
    setOrdersCache(list);
  }
  function removeFromOrdersCache(id) {
    setOrdersCache(getOrdersCache().filter(function (o) { return o.id !== id; }));
  }

  /**
   * Накладывает ещё не отправленные операции поверх данных с сервера.
   * Без этого свежий заказ, который лежит в очереди, «пропал бы» из списка
   * сразу после перезагрузки — ровно тот симптом, из-за которого всё затевалось.
   */
  function applyPendingOps(orders) {
    var byId = {};
    orders.forEach(function (o) { byId[o.id] = o; });
    readOutbox().forEach(function (entry) {
      if (entry.kind !== 'order') return;
      if (entry.op === 'delete') delete byId[entry.entityId];
      else byId[entry.entityId] = normalizeOrder(entry.payload);
    });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  // ── Чтение ───────────────────────────────────────────────────────────────────────────────
  async function fetchAll(table, select, order) {
    var s = sb();
    if (!s) throw new Error('Supabase не настроен');
    var out = [];
    var page = 1000;
    for (var from = 0; ; from += page) {
      var q = s.from(table).select(select || '*').range(from, from + page - 1);
      if (order) q = q.order(order.column, { ascending: !!order.ascending });
      var res = await q;
      if (res.error) throw new Error(res.error.message);
      var rows = res.data || [];
      out = out.concat(rows);
      if (rows.length < page) break;
    }
    return out;
  }

  async function loadOrders() {
    try {
      var rows = await fetchAll('orders', '*', { column: 'start_date', ascending: true });
      if (rows.length && !columnCache.orders) columnCache.orders = new Set(Object.keys(rows[0]));
      var orders = rows.map(normalizeOrder);
      setOrdersCache(orders);
      return { orders: applyPendingOps(orders), fromCache: false };
    } catch (e) {
      console.warn('[store] заказы читаем из локального кэша:', e.message);
      return { orders: applyPendingOps(getOrdersCache()), fromCache: true, error: e.message };
    }
  }

  async function loadClients() {
    try {
      var rows = await fetchAll('clients', '*');
      var clients = rows.map(normalizeClient);
      lsSet(CFG.cache.clientsKey, clients);
      return { clients: clients, fromCache: false };
    } catch (e) {
      return { clients: lsGet(CFG.cache.clientsKey, []) || [], fromCache: true, error: e.message };
    }
  }

  async function loadStock() {
    try {
      var rows = await fetchAll('stock', '*');
      var stock = rows.map(function (s) {
        return {
          id: str(s.id), name: str(s.name), category: str(s.category),
          price: num(s.price, 0), setupRate: num(s.setup_rate, 0),
          qty: num(s.qty, 0), unit: str(s.unit) || 'шт'
        };
      });
      lsSet(CFG.cache.stockKey, stock);
      return { stock: stock, fromCache: false };
    } catch (e) {
      return { stock: lsGet(CFG.cache.stockKey, []) || [], fromCache: true, error: e.message };
    }
  }

  async function loadCategories() {
    try {
      var rows = await fetchAll('categories', '*');
      var cats = rows.map(function (c) { return { id: str(c.id), name: str(c.name), setupRate: num(c.setup_rate, 0) }; });
      lsSet(CFG.cache.categoriesKey, cats);
      return { categories: cats, fromCache: false };
    } catch (e) {
      return { categories: lsGet(CFG.cache.categoriesKey, []) || [], fromCache: true, error: e.message };
    }
  }

  async function loadPricing() {
    try {
      var rows = await fetchAll('pricing_config', '*');
      var cfg = {};
      rows.forEach(function (r) { cfg[str(r.key)] = num(r.value, 0); });
      lsSet(CFG.cache.pricingKey, cfg);
      return { pricing: cfg, fromCache: false };
    } catch (e) {
      return { pricing: lsGet(CFG.cache.pricingKey, {}) || {}, fromCache: true, error: e.message };
    }
  }

  async function saveStockItem(item) {
    var s = sb();
    if (!s) throw new Error('Supabase не настроен');
    var row = {
      name: str(item.name), category: str(item.category), price: num(item.price, 0),
      setup_rate: num(item.setupRate, 0), qty: num(item.qty, 0), unit: str(item.unit) || 'шт'
    };
    if (item.id) row.id = item.id;
    var res = await s.from('stock').upsert(row, { onConflict: item.id ? 'id' : 'name,category' }).select('*');
    if (res.error) throw new Error(res.error.message);
    if (!res.data || !res.data.length) throw new Error('Supabase не подтвердил запись позиции склада');
    return res.data[0];
  }
  async function deleteStockItem(id) {
    var s = sb();
    if (!s) throw new Error('Supabase не настроен');
    var res = await s.from('stock').delete().eq('id', id).select('id');
    if (res.error) throw new Error(res.error.message);
    return true;
  }
  async function saveCategory(cat) {
    var s = sb();
    if (!s) throw new Error('Supabase не настроен');
    var row = { id: str(cat.id) || str(cat.name), name: str(cat.name), setup_rate: num(cat.setupRate, 0) };
    var res = await s.from('categories').upsert(row, { onConflict: 'id' }).select('*');
    if (res.error) throw new Error(res.error.message);
    if (!res.data || !res.data.length) throw new Error('Supabase не подтвердил запись категории');
    return res.data[0];
  }

  // ── Возврат данных в Google Sheets, когда синхронизацию снова включат ────────────────────
  /**
   * Выгружает всё, что накопилось в Supabase, обратно в Google Sheets.
   * apiFn — функция вида api(action, data), т.е. существующий мост к Apps Script.
   * Ничего не удаляет: только upsert, поэтому запускать можно сколько угодно раз.
   */
  async function exportToGoogleSheets(apiFn, onProgress) {
    if (typeof apiFn !== 'function') return { success: false, error: 'Нужна функция api(action, data)' };
    var report = { orders: 0, clients: 0, stock: 0, failed: [] };
    var report_ = function (msg) { if (onProgress) try { onProgress(msg); } catch (e) { } };

    var od = await loadOrders();
    var existing = [];
    try {
      var g = await apiFn('getOrders');
      if (g && g.success && Array.isArray(g.orders)) existing = g.orders.map(function (o) { return String(o.id); });
    } catch (e) { }
    var existingSet = new Set(existing);

    for (var i = 0; i < od.orders.length; i++) {
      var o = od.orders[i];
      try {
        var action = existingSet.has(o.id) ? 'updateOrder' : 'addOrder';
        var r = await apiFn(action, { order: o });
        if (r && r.success) report.orders++; else report.failed.push('order:' + o.id);
      } catch (e) { report.failed.push('order:' + o.id); }
      if (i % 25 === 0) report_('Заказы: ' + i + '/' + od.orders.length);
    }

    var cd = await loadClients();
    for (var j = 0; j < cd.clients.length; j++) {
      var c = cd.clients[j];
      try {
        var rc = await apiFn('updateClient', { client: c });
        if (rc && rc.success) report.clients++; else report.failed.push('client:' + c.id);
      } catch (e) { report.failed.push('client:' + c.id); }
    }

    var sd = await loadStock();
    for (var k = 0; k < sd.stock.length; k++) {
      var st = sd.stock[k];
      try {
        var rs = await apiFn('updateStockItem', { item: st });
        if (rs && rs.success) report.stock++; else report.failed.push('stock:' + st.name);
      } catch (e) { report.failed.push('stock:' + st.name); }
    }

    return { success: report.failed.length === 0, report: report };
  }

  /**
   * Переносит из Google Sheets только те заказы, которых нет в Supabase.
   *
   * Нужен при переходе на Supabase как на единственный источник: в таблице
   * накопились заказы, которые фоновое дублирование в своё время не доставило,
   * и без переноса они исчезли бы из приложения.
   *
   * Строго добавление: существующие записи не трогаются, ничего не удаляется.
   */
  async function importMissingOrdersFromGoogle(apiFn) {
    var s = sb();
    if (!s) return { success: false, error: 'Supabase не настроен' };
    if (typeof apiFn !== 'function') return { success: false, error: 'Нужна функция api(action, data)' };

    var res = await apiFn('getOrders');
    if (!res || !res.success || !Array.isArray(res.orders)) {
      return { success: false, error: 'Не удалось прочитать заказы из Google Sheets' };
    }
    var existing = await fetchAll('orders', 'id');
    var have = new Set(existing.map(function (r) { return String(r.id); }));

    var candidates = res.orders.filter(function (o) {
      return o && o.id && !have.has(String(o.id)) && String(o.clientName || o.client_name || '').trim();
    });
    var skippedEmpty = res.orders.filter(function (o) {
      return o && o.id && !have.has(String(o.id)) && !String(o.clientName || o.client_name || '').trim();
    }).map(function (o) { return String(o.id); });

    await loadColumns('orders');
    var imported = [], failed = [];
    for (var i = 0; i < candidates.length; i++) {
      var order = normalizeOrder(candidates[i]);
      try {
        var row = filterToExistingColumns('orders', orderToRow(order));
        var up = await s.from('orders').insert(row).select('id');
        if (up.error) throw new Error(up.error.message);
        imported.push({ id: order.id, client: order.clientName, amount: order.orderAmount, items: order.items.length });
      } catch (e) {
        failed.push({ id: order.id, error: e.message });
      }
    }
    return {
      success: failed.length === 0,
      inSheets: res.orders.length, inSupabase: have.size,
      imported: imported, failed: failed, skippedEmpty: skippedEmpty
    };
  }

  // ── Автозапуск очереди ───────────────────────────────────────────────────────────────────
  window.addEventListener('online', function () { setStatus('saving'); flush({ force: true }); });
  window.addEventListener('offline', function () { setStatus('offline'); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && pendingCount()) flush({ force: true });
  });
  window.addEventListener('pageshow', function () { if (pendingCount()) flush({ force: true }); });

  // Последний рубеж: пользователь закрывает вкладку с неотправленными изменениями.
  window.addEventListener('beforeunload', function (e) {
    if (!pendingCount()) return;
    e.preventDefault();
    e.returnValue = 'Есть изменения, которые ещё не отправлены на сервер.';
    return e.returnValue;
  });

  window.RadarStore = {
    // инфраструктура
    sb: sb, resetClient: resetClient, loadColumns: loadColumns,
    // модель
    normalizeOrder: normalizeOrder, normalizeClient: normalizeClient,
    makeOrderId: makeOrderId, makeOrderNumber: makeOrderNumber,
    buildChangeLog: buildChangeLog, orderToRow: orderToRow,
    // запись
    saveOrder: saveOrder, deleteOrder: deleteOrder,
    saveClient: saveClient, deleteClient: deleteClient,
    saveStockItem: saveStockItem, deleteStockItem: deleteStockItem, saveCategory: saveCategory,
    // чтение
    loadOrders: loadOrders, loadClients: loadClients, loadStock: loadStock,
    loadCategories: loadCategories, loadPricing: loadPricing,
    getOrdersCache: getOrdersCache, applyPendingOps: applyPendingOps,
    // очередь
    flush: flush, pendingCount: pendingCount, readOutbox: readOutbox,
    onStatus: onStatus, getStatus: function () { return lastStatus; },
    clearOutbox: function () { writeOutbox([]); emit(); },
    // обмен с Google Sheets
    exportToGoogleSheets: exportToGoogleSheets,
    importMissingOrdersFromGoogle: importMissingOrdersFromGoogle
  };
})();
