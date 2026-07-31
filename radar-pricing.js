/**
 * Radar NR — единый сервис расчёта заказа и сметы.
 *
 * Чистые функции без DOM: одни и те же цифры получают форма заказа, список заказов,
 * PDF-смета и акт. Раньше расчёт был размазан по crmCalcTotal / crmCalcSetupCost /
 * crmCalcDeliveryCost / crmBuildEstimateHTML — и смета умела расходиться с формой.
 */
(function () {
  'use strict';

  var DEFAULTS = {
    deliveryBaseCity: 7200,
    deliveryPerKm: 110,
    setupMin: 2500,
    setupChairNepalMetal: 80,
    setupChairNepal: 105,
    setupChairModern: 60,
    setupChairModernWood: 50,
    setupChairModernCushion: 70,
    setupChairLoren: 125,
    setupGlass: 55,
    setupPlate: 45
  };

  function num(v, d) { var n = Number(v); return Number.isFinite(n) ? n : (d || 0); }
  function money(v) { return Math.round(num(v, 0)); }

  function mergePricing(raw) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = Number(raw && raw[k]);
      out[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULTS[k];
    });
    return out;
  }

  /**
   * Ставка сетапа за единицу. Приоритет — явная ставка из справочника склада;
   * подбор по названию остаётся запасным вариантом для позиций без ставки.
   */
  function setupRateFor(name, category, pricing, explicitRate) {
    var explicit = num(explicitRate, 0);
    if (explicit > 0) return explicit;
    var p = mergePricing(pricing);
    var s = (String(name || '') + ' ' + String(category || '')).toLowerCase();
    if (s.includes('лорен')) return p.setupChairLoren;
    if (s.includes('модерн') && s.includes('подуш')) return p.setupChairModernCushion;
    if (s.includes('модерн') && (s.includes('вяз') || s.includes('дерево'))) return p.setupChairModernWood;
    if (s.includes('модерн')) return p.setupChairModern;
    if (s.includes('непал') && (s.includes('метал') || s.includes('спинк'))) return p.setupChairNepalMetal;
    if (s.includes('непал')) return p.setupChairNepal;
    if (s.includes('бокал') || s.includes('флют') || s.includes('мартин') || s.includes('рокс') || s.includes('glass')) return p.setupGlass;
    if (s.includes('тарел')) return p.setupPlate;
    return 0;
  }

  /**
   * Оплачиваемость позиции.
   *
   * Позиция может присутствовать в заказе полностью — склад, сетап, аналитика,
   * история, бронь — и при этом не входить в сумму к оплате и в клиентские
   * документы. Это не «скрытие» позиции: её цена остаётся реальной, обнуляется
   * только то, что предъявляется клиенту.
   *
   * Сам движок цен не знает, почему позиция неоплачиваемая: правило
   * подключается снаружи через setBillingPolicy (сейчас — из radar-partners.js,
   * для собственных заказов партнёра). Поэтому новые схемы владения
   * не потребуют правок здесь.
   */
  var billingPolicy = null;
  function setBillingPolicy(fn) { billingPolicy = typeof fn === 'function' ? fn : null; }
  function isBillable(item, ctx) {
    if (item && item.billable === false) return false;
    if (!billingPolicy) return true;
    // Расчёт заказа не должен падать из-за внешней политики.
    try { return billingPolicy(item, ctx) !== false; } catch (e) { return true; }
  }

  function calcDelivery(input, pricing) {
    var p = mergePricing(pricing);
    if (input.deliveryType !== 'delivery') return 0;
    if (input.deliveryZone === 'outside') {
      return money(p.deliveryBaseCity + Math.max(0, num(input.deliveryKm, 0)) * p.deliveryPerKm);
    }
    return money(p.deliveryBaseCity);
  }

  function calcSetup(items, pricing) {
    var p = mergePricing(pricing);
    var total = 0;
    (items || []).forEach(function (i) {
      if (i.setup === false) return;
      var rate = setupRateFor(i.name, i.category, p, i.setupRate);
      total += rate * Math.max(0, num(i.qty, 0));
    });
    if (total > 0 && total < p.setupMin) total = p.setupMin;
    return money(total);
  }

  /**
   * Полный расчёт заказа.
   *
   * input: {
   *   items: [{name, category, qty, price, setup, setupRate}],
   *   pricing, discount (%), deliveryType, deliveryZone, deliveryKm,
   *   extraChargeAmount, paymentStatus, paidAmount,
   *   manual: { deliveryCost, setupCost, itemsTotal, orderAmount, budgetAmount }  // ручные правки
   * }
   *
   * Правило ручных полей: если пользователь сам вписал сумму, расчёт её не перетирает,
   * но всё остальное продолжает считаться автоматически.
   */
  function calcOrder(input) {
    input = input || {};
    var pricing = mergePricing(input.pricing);
    var manual = input.manual || {};
    var items = (input.items || []).map(function (i) {
      var qty = Math.max(0, num(i.qty, 0));
      var price = Math.max(0, num(i.price, 0));
      var setupOn = i.setup !== false;
      var rate = setupRateFor(i.name, i.category, pricing, i.setupRate);
      return {
        name: String(i.name || ''),
        category: String(i.category || ''),
        qty: qty,
        price: price,
        setup: setupOn,
        setupRate: rate,
        lineTotal: money(price * qty),
        lineSetup: setupOn ? money(rate * qty) : 0,
        billable: isBillable(i, input)
      };
    });

    // Неоплачиваемые позиции остаются в расчёте с реальной ценой (сетап,
    // аналитика, база сервисного сбора), но в сумму товаров не входят.
    var itemsGross = money(items.reduce(function (s, i) { return i.billable ? s + i.lineTotal : s; }, 0));
    var discountPct = Math.min(100, Math.max(0, num(input.discount, 0)));
    var discountAmount = money(itemsGross * discountPct / 100);

    var itemsTotal = manual.itemsTotal != null ? money(manual.itemsTotal) : money(itemsGross - discountAmount);
    var deliveryCost = manual.deliveryCost != null ? money(manual.deliveryCost) : calcDelivery(input, pricing);
    var setupCost = manual.setupCost != null ? money(manual.setupCost) : calcSetup(items, pricing);
    var extraCharge = money(input.extraChargeAmount);

    var computedTotal = money(itemsTotal + deliveryCost + setupCost + extraCharge);
    var orderAmount = manual.orderAmount != null ? money(manual.orderAmount) : Math.max(0, computedTotal);
    var budgetAmount = manual.budgetAmount != null ? money(manual.budgetAmount) : money(deliveryCost + setupCost);

    // Категории — для аналитики и группировки в смете
    var byCategory = {};
    items.forEach(function (i) {
      var key = i.category || 'Без категории';
      if (!byCategory[key]) byCategory[key] = { category: key, qty: 0, total: 0, setup: 0, count: 0 };
      byCategory[key].qty += i.qty;
      byCategory[key].total += i.lineTotal;
      byCategory[key].setup += i.lineSetup;
      byCategory[key].count++;
    });

    var paidStatuses = { paid: 1, paid_cash: 1 };
    var paid = paidStatuses[input.paymentStatus] ? orderAmount : Math.max(0, num(input.paidAmount, 0));
    if (paid > orderAmount) paid = orderAmount;

    return {
      items: items,
      categories: Object.keys(byCategory).map(function (k) { return byCategory[k]; })
        .sort(function (a, b) { return b.total - a.total; }),
      itemsGross: itemsGross,
      discountPct: discountPct,
      discountAmount: discountAmount,
      itemsTotal: itemsTotal,
      deliveryCost: deliveryCost,
      setupCost: setupCost,
      extraCharge: extraCharge,
      budgetAmount: budgetAmount,
      orderAmount: orderAmount,
      computedTotal: computedTotal,
      paidAmount: money(paid),
      remainingAmount: Math.max(0, money(orderAmount - paid)),
      prepay: money(orderAmount * 0.5),
      setupRequired: setupCost > 0 ? 'yes' : 'no'
    };
  }

  /**
   * Расчёт для сметы. withDiscount=false — «стандартная» смета по полным ценам:
   * скидка не применяется ни к строкам, ни к итогу.
   */
  function calcEstimate(order, pricing, withDiscount) {
    var base = {
      order: order,          // контекст заказа нужен политике оплачиваемости
      items: order.items,
      pricing: pricing,
      discount: withDiscount ? order.discount : 0,
      deliveryType: order.deliveryType,
      deliveryZone: order.deliveryZone,
      deliveryKm: order.deliveryKm,
      extraChargeAmount: order.extraChargeAmount,
      paymentStatus: order.paymentStatus,
      paidAmount: order.paidAmount,
      manual: {
        deliveryCost: order.deliveryCost,
        setupCost: order.setupCost
      }
    };
    // В смете со скидкой уважаем вручную выставленную итоговую сумму заказа,
    // в смете без скидки — всегда считаем по полным ценам.
    if (withDiscount) {
      if (order.itemsTotalManual != null) base.manual.itemsTotal = order.itemsTotalManual;
      if (order.orderAmountManual != null) base.manual.orderAmount = order.orderAmountManual;
    }
    var r = calcOrder(base);
    r.items = r.items.map(function (i) {
      var unit = withDiscount && r.discountPct > 0 ? Math.round(i.price * (1 - r.discountPct / 100)) : i.price;
      return Object.assign({}, i, { unitPrice: unit, unitTotal: money(unit * i.qty) });
    });
    return r;
  }

  window.RadarPricing = {
    DEFAULTS: DEFAULTS,
    mergePricing: mergePricing,
    setupRateFor: setupRateFor,
    calcDelivery: calcDelivery,
    calcSetup: calcSetup,
    setBillingPolicy: setBillingPolicy,
    calcOrder: calcOrder,
    calcEstimate: calcEstimate
  };
})();
