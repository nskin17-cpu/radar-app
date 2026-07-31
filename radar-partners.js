/**
 * Radar NR — партнёрские (комиссионные) товары и взаиморасчёты.
 *
 * ЗАЧЕМ: часть позиций на складе принадлежит не NANDRENT, а внешнему партнёру.
 * По ним прибыль делится, ведётся отдельный баланс и своя аналитика.
 *
 * ДВА НЕЗАВИСИМЫХ АЛГОРИТМА — их нельзя смешивать:
 *
 *   service_fee   («партнёр оформляет заказ сам себе»)
 *     Сервисный сбор берётся с ПОЛНОЙ стоимости партнёрских товаров,
 *     ДО применения любых скидок. Проф. скидка на сбор не влияет — это
 *     жёсткое правило, поэтому база сбора считается от gross, а не от net.
 *     Доход NANDRENT = сбор. Остальные деньги по этим товарам — партнёру.
 *
 *   revenue_share («партнёрские товары арендует сторонний клиент»)
 *     Делится сумма ПОСЛЕ скидки клиента, в заданной пропорции
 *     (сейчас 50/50, задаётся у партнёра и меняется без правки кода).
 *
 * Какой алгоритм применить, решает resolveScheme(): по умолчанию по клиенту
 * заказа, но у партнёра можно зафиксировать схему принудительно.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ ДОЛЖНО БЫТЬ: ничего из этого модуля не попадает в смету,
 * акт и КП. Документы (radar-docs.js) печатают только name/qty/price позиции —
 * поля владельца туда физически не приходят. Маркировка в интерфейсе —
 * нейтральный код партнёра (например «AF»), а не название его компании.
 *
 * Собственные расчёты не хранятся в заказе: они лежат в partner_settlements
 * (см. sql/partners-1-system.sql), снимком на момент расчёта. Поэтому отчёт
 * за прошлый период не меняется, когда правят склад или условия партнёра.
 */
(function () {
  'use strict';

  function num(v, d) { var n = Number(v); return Number.isFinite(n) ? n : (d || 0); }
  function money(v) { return Math.round(num(v, 0)); }
  function str(v) { return v == null ? '' : String(v); }
  function key(v) { return str(v).trim().toLowerCase(); }
  function $(id) { return document.getElementById(id); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  // ══════════════════════════════════════════════════════════════════════════
  //  ЧАСТЬ 1. Чистый расчёт — без DOM и без сети.
  //  Те же цифры получают карточка заказа, дашборд и журнал взаиморасчётов.
  // ══════════════════════════════════════════════════════════════════════════

  var SCHEME_LABEL = {
    service_fee: 'Собственный заказ партнёра',
    revenue_share: 'Заказ стороннего клиента'
  };

  /** Заказ оформил сам партнёр? Сверяем по карточке клиента, имени и компании. */
  function isPartnerOwnOrder(partner, order) {
    if (!partner || !order) return false;
    var pClient = key(partner.clientId);
    if (pClient && key(order.clientId) === pClient) return true;
    var pName = key(partner.clientName) || key(partner.name);
    if (pName && key(order.clientName) === pName) return true;
    var pCompany = key(partner.company);
    if (pCompany && key(order.companyName) === pCompany) return true;
    return false;
  }

  function resolveScheme(partner, order) {
    var forced = str(partner && partner.settlementScheme);
    if (forced === 'service_fee' || forced === 'revenue_share') return forced;
    return isPartnerOwnOrder(partner, order) ? 'service_fee' : 'revenue_share';
  }

  /**
   * Чей это товар.
   * Приоритет — снимок в самой позиции заказа: если товар позже выкупят
   * у партнёра, взаиморасчёты по прошлым заказам не должны поехать.
   * Поиск по складу — запасной путь для заказов, сохранённых до этой версии.
   */
  function ownerOf(item, stockIndex) {
    var direct = str(item && item.partnerId).trim();
    if (direct) return direct;
    if (item && item.ownerType === 'own') return '';
    var s = stockIndex && stockIndex[key(item && item.name)];
    return s ? str(s.partnerId) : '';
  }

  /**
   * Оплачивает ли клиент эту позицию.
   *
   * Единственный случай, когда нет, — собственный заказ партнёра (service_fee):
   * свои изделия партнёр у нас не арендует, с них берётся только сервисный сбор.
   * В заказе стороннего клиента партнёрские товары оплачиваются как обычно.
   *
   * ВАЖНО: «неоплачиваемая» ≠ «скрытая». Позиция остаётся полноценной частью
   * заказа: сборка на складе, выдача и возврат, занятость, статистика выдач,
   * сетап и база сервисного сбора считают её по реальной цене. Обнуляется
   * только сумма к оплате и строка в клиентских документах.
   */
  function isBillableItem(item, order) {
    if (!order) return true;
    var pid = ownerOf(item, currentStockIndex());
    if (!pid) return true;
    var p = partnerById(pid);
    if (!p) return true;
    return resolveScheme(p, order) !== 'service_fee';
  }

  /** Позиции, которые видит клиент: для смет, актов и КП. */
  function billableItems(items, order) {
    return (items || []).filter(function (i) { return isBillableItem(i, order); });
  }

  function buildStockIndex(stock) {
    var idx = {};
    (stock || []).forEach(function (s) {
      var k = key(s && s.name);
      // Одноимённые позиции в разных категориях: партнёрская выигрывает,
      // иначе комиссионный товар молча потерялся бы в расчёте.
      if (k && (!idx[k] || (!idx[k].partnerId && s.partnerId))) idx[k] = s;
    });
    return idx;
  }

  // Индекс перестраивается, только когда сменился сам массив склада: список
  // заказов рисуется целиком на каждый рендер, и пересборка на каждую строку
  // была бы заметна уже на паре сотен позиций.
  var stockIndexCache = { src: null, idx: {} };
  function currentStockIndex() {
    var st = currentStock();
    if (stockIndexCache.src !== st) stockIndexCache = { src: st, idx: buildStockIndex(st) };
    return stockIndexCache.idx;
  }

  /**
   * Расчёт взаиморасчётов по одному заказу.
   *
   * input: { order, calc, partners, stock }
   *   calc — результат RadarPricing.calcOrder (нужны items[].lineTotal и discountPct).
   *
   * Возвращает { discountPct, ownGross, ownNet, rows: [...] } — по строке на партнёра.
   * Заказ без партнёрских товаров даёт пустой rows: раздел взаиморасчётов
   * в такой карточке просто не показывается.
   */
  function calcOrderSettlements(input) {
    input = input || {};
    var order = input.order || {};
    var calc = input.calc || {};
    var partnersById = {};
    (input.partners || []).forEach(function (p) { partnersById[str(p.id)] = p; });
    var stockIndex = buildStockIndex(input.stock);

    var discountPct = Math.min(100, Math.max(0, num(calc.discountPct, num(order.discount, 0))));
    var keep = 1 - discountPct / 100;
    var items = calc.items && calc.items.length ? calc.items : (order.items || []).map(function (i) {
      return { name: i.name, category: i.category, qty: num(i.qty, 0), price: num(i.price, 0), partnerId: i.partnerId, ownerType: i.ownerType, lineTotal: money(num(i.price, 0) * num(i.qty, 0)) };
    });

    var ownGross = 0;
    var groups = {};
    items.forEach(function (i, idx) {
      var src = (order.items || [])[idx];
      var lineTotal = money(i.lineTotal != null ? i.lineTotal : num(i.price, 0) * num(i.qty, 0));
      // partnerId ищем и в позиции расчёта, и в исходной позиции заказа:
      // RadarPricing.calcOrder пересобирает items и лишних полей не переносит.
      var partnerId = ownerOf({ name: i.name, partnerId: i.partnerId || (src && src.partnerId), ownerType: i.ownerType || (src && src.ownerType) }, stockIndex);
      if (!partnerId || !partnersById[partnerId]) { ownGross += lineTotal; return; }
      if (!groups[partnerId]) groups[partnerId] = { gross: 0, items: [] };
      groups[partnerId].gross += lineTotal;
      groups[partnerId].items.push({
        name: str(i.name), category: str(i.category),
        qty: num(i.qty, 0), price: money(i.price), total: lineTotal
      });
    });

    var rows = Object.keys(groups).map(function (pid) {
      var p = partnersById[pid];
      var g = groups[pid];
      var gross = money(g.gross);
      var net = money(gross * keep);
      var scheme = resolveScheme(p, order);

      var serviceFeePct = 0, serviceFeeAmount = 0, partnerSharePct = 0, partnerIncome = 0, companyIncome = 0;
      if (scheme === 'service_fee') {
        // База сбора — gross: скидка на сервисный сбор не распространяется.
        serviceFeePct = num(p.serviceFeePct, 0);
        serviceFeeAmount = money(gross * serviceFeePct / 100);
        companyIncome = serviceFeeAmount;
        partnerIncome = net - serviceFeeAmount;
      } else {
        partnerSharePct = num(p.partnerSharePct, 0);
        partnerIncome = money(net * partnerSharePct / 100);
        companyIncome = net - partnerIncome;
      }

      return {
        id: 'st-' + str(order.id) + '-' + pid,
        orderId: str(order.id), partnerId: pid, partner: p,
        scheme: scheme, schemeLabel: SCHEME_LABEL[scheme],
        partnerGross: gross, partnerNet: net, discountPct: discountPct,
        serviceFeePct: serviceFeePct, serviceFeeAmount: serviceFeeAmount,
        partnerSharePct: partnerSharePct,
        partnerIncome: partnerIncome, companyIncome: companyIncome,
        ownItemsTotal: money(ownGross * keep),
        items: g.items
      };
    }).sort(function (a, b) { return b.partnerGross - a.partnerGross; });

    return {
      discountPct: discountPct,
      ownGross: money(ownGross),
      ownNet: money(ownGross * keep),
      rows: rows
    };
  }

  /** Сводка по заказу для списка заказов и дашборда. */
  function orderSummary(order, ctx) {
    var calc = ctx && ctx.calc;
    if (!calc) {
      try { calc = RadarPricing.calcOrder({ order: order, items: order.items, discount: order.discount, pricing: (ctx && ctx.pricing) || {} }); }
      catch (e) { calc = {}; }
    }
    return calcOrderSettlements({ order: order, calc: calc, partners: state.partners, stock: (ctx && ctx.stock) || currentStock() });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ЧАСТЬ 2. Состояние и загрузка
  // ══════════════════════════════════════════════════════════════════════════

  var state = {
    partners: [], settlements: [], expenses: [], expenseTypes: [], payouts: [],
    loaded: false, missing: false, loading: null
  };

  // crmStock/crmOrders/crmPricing в crm.js объявлены через let — это лексические
  // глобали, а не window.*. Обращаемся напрямую и защищаемся от порядка загрузки.
  function currentStock() { try { return Array.isArray(crmStock) ? crmStock : []; } catch (e) { return []; } }
  function currentOrders() { try { return Array.isArray(crmOrders) ? crmOrders : []; } catch (e) { return []; } }
  function currentPricing() { try { return crmPricing || {}; } catch (e) { return {}; } }
  function whoami() { return (window.currentUser && window.currentUser.username) || 'system'; }
  function canEdit() { return typeof radarCanEdit === 'function' ? radarCanEdit('partners') : true; }
  function canView() { return typeof radarCanView === 'function' ? radarCanView('partners') : true; }

  function partnerById(id) {
    return state.partners.filter(function (p) { return p.id === str(id); })[0] || null;
  }

  async function load(force) {
    if (state.loading) return state.loading;
    if (state.loaded && !force) return state;
    state.loading = (async function () {
      var r = await Promise.all([
        RadarStore.loadPartners(), RadarStore.loadPartnerSettlements(),
        RadarStore.loadPartnerExpenses(), RadarStore.loadPartnerExpenseTypes(),
        RadarStore.loadPartnerPayouts()
      ]);
      state.partners = r[0].partners || [];
      state.settlements = r[1].settlements || [];
      state.expenses = r[2].expenses || [];
      state.expenseTypes = (r[3].types || []).filter(function (t) { return t.active; });
      state.payouts = r[4].payouts || [];
      state.missing = !!r[0].missing;
      state.loaded = true;
      state.loading = null;
      return state;
    })();
    return state.loading;
  }

  /** Партнёры нужны для бейджей на складе — грузим их даже без доступа к разделу. */
  async function ensurePartners() {
    if (state.partners.length || state.loaded) return state.partners;
    try {
      var r = await RadarStore.loadPartners();
      state.partners = r.partners || [];
      state.missing = !!r.missing;
    } catch (e) { state.partners = []; }
    return state.partners;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ЧАСТЬ 3. Маркировка в интерфейсе
  //  Нейтральный цветной бейдж с коротким кодом. Название компании партнёра
  //  показываем только в подсказке (title) — чтобы экран, случайно
  //  повёрнутый к клиенту, не вызвал вопросов.
  // ══════════════════════════════════════════════════════════════════════════

  function badgeCode(p) {
    if (!p) return '';
    if (p.code) return p.code;
    var src = str(p.company) || str(p.name);
    return src.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || 'П';
  }

  /** HTML бейджа партнёра. Пустая строка для наших товаров — вызывающему коду проще. */
  function badge(partnerId, opts) {
    var p = partnerById(partnerId);
    if (!p) return '';
    opts = opts || {};
    var title = 'Комиссионный товар · ' + (p.company || p.name);
    return '<span class="pt-badge' + (opts.dot ? ' pt-badge-dot' : '') + '" style="--pt:' + esc(p.color || '#7C5CFF') + '" title="' + esc(title) + '">'
      + (opts.dot ? '' : esc(badgeCode(p))) + '</span>';
  }

  /** Бейдж для позиции заказа (учитывает снимок владельца). */
  function itemBadge(item, opts) {
    return badge(ownerOf(item, currentStockIndex()), opts);
  }

  /** Есть ли в заказе партнёрские товары — для метки в списке заказов. */
  function orderPartnerIds(order) {
    var idx = currentStockIndex();
    var seen = {};
    (order && order.items || []).forEach(function (i) {
      var pid = ownerOf(i, idx);
      if (pid && partnerById(pid)) seen[pid] = 1;
    });
    return Object.keys(seen);
  }

  function orderBadges(order) {
    return orderPartnerIds(order).map(function (pid) { return badge(pid); }).join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ЧАСТЬ 4. Синхронизация расчётов с базой
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Пересчитывает и записывает взаиморасчёты по заказу.
   * Выплаченные строки (status='paid') не трогаем: иначе история расчётов
   * поехала бы задним числом после любой правки заказа.
   * Никогда не бросает — сохранение заказа не должно падать из-за этого модуля.
   */
  async function syncOrder(order) {
    if (!order || !order.id) return null;
    try {
      await ensurePartners();
      if (!state.partners.length) return null;
      if (!state.loaded) await load();

      var calc = RadarPricing.calcOrder({ order: order, items: order.items, discount: order.discount, pricing: currentPricing() });
      var res = calcOrderSettlements({ order: order, calc: calc, partners: state.partners, stock: currentStock() });
      var existing = state.settlements.filter(function (s) { return s.orderId === order.id; });
      var keepIds = {};

      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows[i];
        var prev = existing.filter(function (s) { return s.partnerId === row.partnerId; })[0];
        keepIds[row.partnerId] = 1;
        if (prev && prev.status === 'paid') continue;
        var payload = {
          id: prev ? prev.id : row.id,
          orderId: row.orderId, partnerId: row.partnerId, scheme: row.scheme,
          partnerGross: row.partnerGross, partnerNet: row.partnerNet, discountPct: row.discountPct,
          serviceFeePct: row.serviceFeePct, serviceFeeAmount: row.serviceFeeAmount,
          partnerSharePct: row.partnerSharePct,
          partnerIncome: row.partnerIncome, companyIncome: row.companyIncome,
          ownItemsTotal: row.ownItemsTotal,
          status: prev ? prev.status : 'accrued',
          comment: prev ? prev.comment : '',
          items: row.items
        };
        await RadarStore.savePartnerSettlement(payload);
        if (prev) Object.assign(prev, payload);
        else state.settlements.push(payload);
      }

      // Партнёрские товары убрали из заказа — снимаем и начисление.
      for (var j = 0; j < existing.length; j++) {
        var old = existing[j];
        if (keepIds[old.partnerId] || old.status === 'paid') continue;
        await RadarStore.deletePartnerSettlement(old.id);
        state.settlements = state.settlements.filter(function (s) { return s.id !== old.id; });
      }
      return res;
    } catch (e) {
      console.warn('[partners] взаиморасчёты по заказу ' + order.id + ' не обновлены:', e && e.message);
      return null;
    }
  }

  /** Полный пересчёт: закрывает заказы, сохранённые офлайн или до установки раздела. */
  async function recalcAll(onProgress) {
    await load(true);
    var orders = currentOrders();
    var done = 0, touched = 0;
    for (var i = 0; i < orders.length; i++) {
      var ids = orderPartnerIds(orders[i]);
      var had = state.settlements.some(function (s) { return s.orderId === orders[i].id; });
      if (ids.length || had) { await syncOrder(orders[i]); touched++; }
      done++;
      if (onProgress && done % 25 === 0) onProgress(done, orders.length);
    }
    await load(true);
    return { scanned: done, touched: touched };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ЧАСТЬ 5. Баланс и агрегаты
  // ══════════════════════════════════════════════════════════════════════════

  function orderById(id) {
    return currentOrders().filter(function (o) { return o.id === str(id); })[0] || null;
  }
  function settlementDate(s) {
    var o = orderById(s.orderId);
    return (o && (o.startDate || o.createdAt)) || s.calculatedAt || '';
  }

  function balanceOf(partnerId) {
    var accrued = 0, expenses = 0, paid = 0;
    state.settlements.forEach(function (s) {
      if (s.partnerId === partnerId && s.status !== 'cancelled' && s.status !== 'draft') accrued += num(s.partnerIncome, 0);
    });
    state.expenses.forEach(function (e) {
      if (e.partnerId === partnerId && e.billableTo === 'partner') expenses += num(e.amount, 0);
    });
    state.payouts.forEach(function (p) { if (p.partnerId === partnerId) paid += num(p.amount, 0); });
    return { accrued: money(accrued), expenses: money(expenses), paid: money(paid), balance: money(accrued - expenses - paid) };
  }

  function expensesOfOrder(orderId, partnerId) {
    return state.expenses.filter(function (e) {
      return e.orderId === str(orderId) && (!partnerId || e.partnerId === partnerId);
    });
  }
  function expenseTypeName(id) {
    var t = state.expenseTypes.filter(function (x) { return x.id === str(id); })[0];
    return t ? t.name : (str(id) || 'Прочее');
  }

  // ── Периоды ────────────────────────────────────────────────────────────────
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** Границы предустановленного периода, включительно. */
  function periodRange(preset, from, to) {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (preset === 'today') { /* как есть */ }
    else if (preset === 'week') { start.setDate(start.getDate() - start.getDay() + (start.getDay() === 0 ? -6 : 1)); }
    else if (preset === 'month') { start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 0); }
    else if (preset === 'quarter') { var q = Math.floor(now.getMonth() / 3); start = new Date(now.getFullYear(), q * 3, 1); end = new Date(now.getFullYear(), q * 3 + 3, 0); }
    else if (preset === 'year') { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear(), 11, 31); }
    else if (preset === 'custom') { return { from: str(from) || '0000-01-01', to: str(to) || '9999-12-31' }; }
    else return { from: '0000-01-01', to: '9999-12-31' };
    return { from: ymd(start), to: ymd(end) };
  }
  function inRange(date, range) {
    var d = str(date).slice(0, 10);
    return !!d && d >= range.from && d <= range.to;
  }

  /** Всё, что нужно дашборду и журналу по одному партнёру за период. */
  function report(partnerId, range) {
    var settlements = state.settlements.filter(function (s) {
      return s.partnerId === partnerId && s.status !== 'cancelled' && inRange(settlementDate(s), range);
    });
    var expenses = state.expenses.filter(function (e) {
      return e.partnerId === partnerId && inRange(e.spentAt, range);
    });
    var payouts = state.payouts.filter(function (p) {
      return p.partnerId === partnerId && inRange(p.paidAt, range);
    });

    var totals = {
      partnerRevenue: 0,      // общая выручка партнёрских товаров (после скидок)
      partnerGross: 0,        // она же до скидок
      serviceFee: 0,          // доход NANDRENT: сервисный сбор
      shareIncome: 0,         // доход NANDRENT: распределение прибыли
      companyIncome: 0,       // итого NANDRENT по партнёрским товарам
      partnerIncome: 0,       // начислено партнёру
      ownItemsTotal: 0,       // наши товары в тех же заказах
      ownOrders: 0, clientOrders: 0
    };
    settlements.forEach(function (s) {
      totals.partnerRevenue += num(s.partnerNet, 0);
      totals.partnerGross += num(s.partnerGross, 0);
      totals.partnerIncome += num(s.partnerIncome, 0);
      totals.companyIncome += num(s.companyIncome, 0);
      totals.ownItemsTotal += num(s.ownItemsTotal, 0);
      if (s.scheme === 'service_fee') { totals.serviceFee += num(s.serviceFeeAmount, 0); totals.ownOrders++; }
      else { totals.shareIncome += num(s.companyIncome, 0); totals.clientOrders++; }
    });
    Object.keys(totals).forEach(function (k) { totals[k] = money(totals[k]); });

    var expenseByType = {};
    var expenseTotal = 0;
    expenses.forEach(function (e) {
      var n = expenseTypeName(e.typeId);
      expenseByType[n] = money((expenseByType[n] || 0) + num(e.amount, 0));
      expenseTotal += num(e.amount, 0);
    });

    // Популярные позиции — из снапшота расчёта, а не из текущего склада:
    // отчёт за прошлый период не должен меняться после правки каталога.
    var byItem = {};
    settlements.forEach(function (s) {
      (s.items || []).forEach(function (i) {
        var k = str(i.name) || 'Без названия';
        if (!byItem[k]) byItem[k] = { name: k, category: str(i.category), rentals: 0, units: 0, total: 0 };
        byItem[k].rentals++;
        byItem[k].units += num(i.qty, 0);
        byItem[k].total += num(i.total, 0);
      });
    });
    var byCategory = {};
    Object.keys(byItem).forEach(function (k) {
      var it = byItem[k];
      var c = it.category || 'Без категории';
      if (!byCategory[c]) byCategory[c] = { category: c, units: 0, total: 0, positions: 0 };
      byCategory[c].units += it.units;
      byCategory[c].total += it.total;
      byCategory[c].positions++;
    });

    return {
      settlements: settlements, expenses: expenses, payouts: payouts,
      totals: totals,
      expenseTotal: money(expenseTotal),
      expenseByType: expenseByType,
      expenseAvg: settlements.length ? money(expenseTotal / settlements.length) : 0,
      orders: settlements.length,
      items: Object.keys(byItem).map(function (k) { return byItem[k]; }).sort(function (a, b) { return b.total - a.total; }),
      categories: Object.keys(byCategory).map(function (k) { return byCategory[k]; }).sort(function (a, b) { return b.total - a.total; }),
      payoutTotal: money(payouts.reduce(function (a, p) { return a + num(p.amount, 0); }, 0))
    };
  }

  // Движок цен спрашивает про каждую позицию, оплачивает ли её клиент.
  // Регистрируем правило один раз — дальше все расчёты (форма заказа, список,
  // смета, акт) автоматически учитывают собственные заказы партнёров.
  if (window.RadarPricing && RadarPricing.setBillingPolicy) {
    RadarPricing.setBillingPolicy(function (item, ctx) {
      return isBillableItem(item, ctx && (ctx.order || ctx));
    });
  }

  window.RadarPartners = {
    // чистый расчёт
    calcOrderSettlements: calcOrderSettlements,
    resolveScheme: resolveScheme,
    isPartnerOwnOrder: isPartnerOwnOrder,
    isBillableItem: isBillableItem,
    billableItems: billableItems,
    ownerOf: ownerOf,
    buildStockIndex: buildStockIndex,
    SCHEME_LABEL: SCHEME_LABEL,
    // состояние
    state: state, load: load, ensurePartners: ensurePartners,
    partnerById: partnerById, list: function () { return state.partners; },
    isMissing: function () { return state.missing; },
    // маркировка
    badge: badge, itemBadge: itemBadge, badgeCode: badgeCode,
    orderPartnerIds: orderPartnerIds, orderBadges: orderBadges,
    // синхронизация и агрегаты
    syncOrder: syncOrder, recalcAll: recalcAll, orderSummary: orderSummary,
    balanceOf: balanceOf, report: report, periodRange: periodRange,
    expensesOfOrder: expensesOfOrder, expenseTypeName: expenseTypeName,
    // служебное для UI-части
    _internal: { num: num, money: money, str: str, uid: uid, $: $, whoami: whoami, canEdit: canEdit, canView: canView, currentOrders: currentOrders, currentStock: currentStock, currentPricing: currentPricing, orderById: orderById, settlementDate: settlementDate }
  };
})();
