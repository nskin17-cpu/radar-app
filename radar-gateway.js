/**
 * Radar NR — шлюз Supabase с контрактом Google Apps Script.
 *
 * Весь код приложения общался с данными через api('action', payload) и ждал ответ
 * вида { success, orders/clients/... }. Шлюз повторяет этот контракт поверх Supabase,
 * поэтому Google Sheets выключаются одним флагом, а вызывающий код не меняется.
 *
 * Записи заказов и клиентов идут не напрямую, а через RadarStore — то есть попадают
 * в outbox и переживают обрыв сети, закрытие вкладки и перезагрузку.
 */
(function () {
  'use strict';

  var CFG = window.RadarConfig;
  var STORE = window.RadarStore;

  function ok(extra) { return Object.assign({ success: true }, extra || {}); }
  function fail(msg) { return { success: false, error: msg }; }
  function num(v, d) { var n = Number(v); return Number.isFinite(n) ? n : (d || 0); }
  function str(v) { return v == null ? '' : String(v); }

  // ── Конкуренты / моя компания ────────────────────────────────────────────────────────────
  var COMPANY_STR = ['name', 'city', 'website', 'instagram', 'phone', 'notes'];
  var COMPANY_NUM = ['nepal', 'loren', 'modern', 'plasticChair', 'woodChair', 'metalChair',
    'plateSnack', 'plateDinner', 'plateSub', 'glassWine', 'glassFlute', 'glassMartini',
    'glassRocks', 'cutlerySet', 'delivery', 'deliveryKm', 'setupPlates', 'setupGlasses',
    'setupCutlery', 'setupMetalChair', 'setupPlasticChair', 'setupCushionChair', 'proDiscount'];

  function toSnake(s) { return String(s).replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); }); }

  function companyRowToApp(row) {
    var out = { id: str(row.id) };
    COMPANY_STR.forEach(function (k) { out[k] = str(row[k]); });
    COMPANY_NUM.forEach(function (k) { out[k] = num(row[toSnake(k)], 0); });
    return out;
  }
  function companyAppToRow(c) {
    var out = { id: str(c.id) };
    COMPANY_STR.forEach(function (k) { out[k] = str(c[k]) || null; });
    COMPANY_NUM.forEach(function (k) { out[toSnake(k)] = num(c[k], 0); });
    out.updated_at = new Date().toISOString();
    return out;
  }

  // ── Заказы ───────────────────────────────────────────────────────────────────────────────
  /**
   * Часть кода шлёт неполный заказ — например {id, status} при смене статуса в списке.
   * Раньше это приводило к затиранию остальных полей. Здесь патч всегда накладывается
   * на текущее состояние заказа.
   */
  function mergeWithKnown(patch) {
    var id = str(patch && patch.id);
    if (!id) return { order: STORE.normalizeOrder(patch), previous: null };
    var known = null;
    if (Array.isArray(window.crmOrders)) known = window.crmOrders.find(function (o) { return o.id === id; }) || null;
    if (!known) {
      var cached = STORE.getOrdersCache();
      if (Array.isArray(cached)) known = cached.find(function (o) { return o.id === id; }) || null;
    }
    if (!known) return { order: STORE.normalizeOrder(patch), previous: null };
    var prev = STORE.normalizeOrder(known);
    var merged = STORE.normalizeOrder(Object.assign({}, prev, patch));
    // items приходят массивом только когда их действительно редактировали
    if (!Array.isArray(patch.items)) merged.items = prev.items;
    return { order: merged, previous: prev };
  }

  // ── Клиенты: статистика считается локально ───────────────────────────────────────────────
  /**
   * Раньше пересчёт статистики клиентов был отдельным вызовом Apps Script
   * (~5 c) и запускался после КАЖДОГО сохранения заказа, а следом ещё getClients (~8 c)
   * и 119 последовательных upsert'ов. Здесь то же самое считается из уже загруженных
   * заказов за миллисекунды и без единого сетевого запроса.
   */
  function recalcClientStats(clients, orders) {
    var paid = { paid: 1, paid_cash: 1 };
    var byName = {};
    (orders || []).forEach(function (o) {
      if (!paid[o.paymentStatus]) return;
      var key = str(o.clientName).trim().toLowerCase();
      if (!key) return;
      if (!byName[key]) byName[key] = { orders: 0, turnover: 0, revenue: 0 };
      var amount = num(o.orderAmount, 0);
      byName[key].orders++;
      byName[key].turnover += amount;
      byName[key].revenue += Math.max(0, amount - num(o.deliveryCost, 0) - num(o.setupCost, 0));
    });
    return (clients || []).map(function (c) {
      var s = byName[str(c.name).trim().toLowerCase()] || { orders: 0, turnover: 0, revenue: 0 };
      return Object.assign({}, c, { totalOrders: s.orders, totalTurnover: s.turnover, totalRevenue: s.revenue });
    });
  }

  // ── Таблица обработчиков ─────────────────────────────────────────────────────────────────
  var handlers = {
    // — заказы —
    getOrders: async function () {
      var r = await STORE.loadOrders();
      return ok({ orders: r.orders, fromCache: r.fromCache, error: r.error });
    },
    addOrder: async function (d) {
      var order = STORE.normalizeOrder(d.order || {});
      if (!order.id) order.id = STORE.makeOrderId();
      var res = STORE.saveOrder(order, { user: currentUserName() });
      return res.queued ? ok({ id: res.id, order: res.order }) : fail('Не удалось записать заказ локально');
    },
    updateOrder: async function (d) {
      var merged = mergeWithKnown(d.order || {});
      if (!merged.order.id) return fail('Не указан id заказа');
      var res = STORE.saveOrder(merged.order, { previous: merged.previous, user: currentUserName() });
      return res.queued ? ok({ id: res.id, order: res.order }) : fail('Не удалось записать заказ локально');
    },
    deleteOrder: async function (d) {
      var res = STORE.deleteOrder(str(d.id));
      return res.queued ? ok() : fail('Не указан id заказа');
    },

    // — клиенты —
    getClients: async function () {
      var c = await STORE.loadClients();
      var o = await STORE.loadOrders();
      return ok({ clients: recalcClientStats(c.clients, o.orders), fromCache: c.fromCache });
    },
    addClient: async function (d) {
      var res = STORE.saveClient(d.client || {});
      return ok({ id: res.id, client: res.client });
    },
    updateClient: async function (d) {
      var res = STORE.saveClient(d.client || {});
      return ok({ id: res.id, client: res.client });
    },
    deleteClient: async function (d) {
      STORE.deleteClient(str(d.id));
      return ok();
    },
    // Пересчёт больше не требует сервера — статистика считается при чтении.
    recalcClientsStats: async function () { return ok({ local: true }); },

    // — склад —
    getStock: async function () {
      var r = await STORE.loadStock();
      return ok({ stock: r.stock, fromCache: r.fromCache });
    },
    addStockItem: async function (d) {
      try { var row = await STORE.saveStockItem(d.item || {}); return ok({ id: row.id }); }
      catch (e) { return fail(e.message); }
    },
    updateStockItem: async function (d) {
      try { var row = await STORE.saveStockItem(d.item || {}); return ok({ id: row.id }); }
      catch (e) { return fail(e.message); }
    },
    deleteStockItem: async function (d) {
      try { await STORE.deleteStockItem(str(d.id)); return ok(); }
      catch (e) { return fail(e.message); }
    },

    // — категории —
    getCategories: async function () {
      var r = await STORE.loadCategories();
      return ok({ categories: r.categories, fromCache: r.fromCache });
    },
    addCategory: async function (d) {
      try { var row = await STORE.saveCategory(d.category || {}); return ok({ id: row.id }); }
      catch (e) { return fail(e.message); }
    },
    updateCategory: async function (d) {
      try { var row = await STORE.saveCategory(d.category || {}); return ok({ id: row.id }); }
      catch (e) { return fail(e.message); }
    },

    // — цены —
    getPricingConfig: async function () {
      var r = await STORE.loadPricing();
      return ok({ config: r.pricing, fromCache: r.fromCache });
    },
    savePricingConfig: async function (d) {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var cfg = d.config || {};
      var rows = Object.keys(cfg).map(function (k) { return { key: k, value: num(cfg[k], 0), updated_at: new Date().toISOString() }; });
      if (!rows.length) return ok();
      var res = await s.from('pricing_config').upsert(rows, { onConflict: 'key' }).select('key');
      if (res.error) return fail(res.error.message);
      return ok();
    },

    // — конкуренты —
    getCompetitors: async function () {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var res = await s.from('competitors').select('*');
      if (res.error) return fail(res.error.message);
      return ok({ entries: (res.data || []).map(companyRowToApp) });
    },
    addCompetitor: async function (d) {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var c = Object.assign({}, d.competitor || {});
      if (!c.id) c.id = 'C' + Date.now() + Math.floor(Math.random() * 900 + 100);
      var res = await s.from('competitors').upsert(companyAppToRow(c), { onConflict: 'id' }).select('id');
      if (res.error) return fail(res.error.message);
      return ok({ id: c.id });
    },
    updateCompetitor: async function (d) {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var res = await s.from('competitors').upsert(companyAppToRow(d.competitor || {}), { onConflict: 'id' }).select('id');
      if (res.error) return fail(res.error.message);
      if (!res.data || !res.data.length) return fail('Supabase не подтвердил запись');
      return ok();
    },
    deleteCompetitor: async function (d) {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var res = await s.from('competitors').delete().eq('id', str(d.id)).select('id');
      if (res.error) return fail(res.error.message);
      return ok();
    },

    // — моя компания —
    getMyCompany: async function () {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var res = await s.from('my_company').select('*').eq('id', 'MY').limit(1);
      if (res.error) return fail(res.error.message);
      var row = (res.data || [])[0];
      return ok({ company: row ? companyRowToApp(row) : null });
    },
    saveMyCompany: async function (d) {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var row = companyAppToRow(Object.assign({}, d.company || {}, { id: 'MY' }));
      var res = await s.from('my_company').upsert(row, { onConflict: 'id' }).select('id');
      if (res.error) return fail(res.error.message);
      if (!res.data || !res.data.length) return fail('Supabase не подтвердил запись');
      return ok();
    },

    // — история цен —
    getHistory: async function () {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var res = await s.from('history').select('*');
      if (res.error) return fail(res.error.message);
      return ok({
        history: (res.data || []).map(function (h) {
          return { month: h.month, companyId: h.company_id, companyName: h.company_name, nepal: h.nepal, loren: h.loren, modern: h.modern };
        })
      });
    },
    getHistoryLog: async function () {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var res = await s.from('history_log').select('*').order('created_at', { ascending: false }).limit(500);
      if (res.error) return fail(res.error.message);
      return ok({
        historyLog: (res.data || []).map(function (r) {
          return {
            id: r.id, createdAt: r.created_at, companyId: r.company_id, companyName: r.company_name,
            fieldKey: r.field_key, fieldLabel: r.field_label, oldValue: r.old_value,
            newValue: r.new_value, delta: r.delta, source: r.source
          };
        })
      });
    },
    addHistoryLog: async function (d) {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var e = d.entry || {};
      var row = {
        created_at: e.createdAt || new Date().toISOString(),
        company_id: str(e.companyId), company_name: str(e.companyName),
        field_key: str(e.fieldKey), field_label: str(e.fieldLabel),
        old_value: e.oldValue != null ? num(e.oldValue, 0) : null,
        new_value: num(e.newValue, 0), delta: num(e.delta, 0), source: str(e.source) || 'manual'
      };
      var res = await s.from('history_log').insert(row).select('id');
      if (res.error) return fail(res.error.message);
      return ok({ id: res.data && res.data[0] && res.data[0].id });
    },
    deleteHistoryLog: async function (d) {
      var s = STORE.sb();
      if (!s) return fail('Supabase не настроен');
      var res = await s.from('history_log').delete().eq('id', str(d.id)).select('id');
      if (res.error) return fail(res.error.message);
      return ok();
    }
  };

  function currentUserName() {
    try { return (window.currentUser && window.currentUser.username) || 'user'; }
    catch (e) { return 'user'; }
  }

  function handles(action) { return Object.prototype.hasOwnProperty.call(handlers, action); }

  async function call(action, data) {
    try {
      return await handlers[action](data || {});
    } catch (e) {
      console.error('[gateway] ' + action + ':', e);
      return fail((e && e.message) || String(e));
    }
  }

  window.RadarGateway = {
    handles: handles,
    call: call,
    recalcClientStats: recalcClientStats,
    companyRowToApp: companyRowToApp,
    companyAppToRow: companyAppToRow
  };
})();
