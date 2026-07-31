/**
 * Radar NR — интерфейс подсистемы партнёрских товаров.
 *
 * Вся арифметика живёт в radar-partners.js, здесь только отрисовка и формы.
 * Разделение сделано намеренно: цифры в карточке заказа, на дашборде и в
 * журнале взаиморасчётов обязаны совпадать, а значит считаться одной функцией.
 *
 * Ничего из этого файла не участвует в формировании сметы, акта и КП.
 */
(function () {
  'use strict';

  var P = window.RadarPartners;
  var I = P._internal;
  var $ = I.$, money = I.money, num = I.num, str = I.str, uid = I.uid;

  var ui = { partnerId: '', period: 'month', from: '', to: '' };

  function esc_(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s); }
  function fN_(n) { return typeof fN === 'function' ? fN(n) : String(n); }
  function fP(n) { return fN_(money(n)) + '₽'; }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'success'); }
  function today() { return new Date().toISOString().slice(0, 10); }

  function activePartner() {
    return P.partnerById(ui.partnerId) || P.list()[0] || null;
  }
  function range() { return P.periodRange(ui.period, ui.from, ui.to); }

  // ══════════════════════════════════════════════════════════════════════════
  //  Раздел «Взаиморасчёты» в карточке заказа
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Перерисовывает блок взаиморасчётов под текущее состояние формы заказа.
   * Заказ без партнёрских товаров блок не показывает вовсе — сотрудник
   * не должен видеть пустой раздел в каждом заказе.
   */
  function renderOrderBlock() {
    var host = $('crmPartnerBlock');
    if (!host) return;
    if (!P.list().length) { host.innerHTML = ''; return; }

    var order, calc;
    try {
      order = crmCollectOrder();
      calc = RadarPricing.calcOrder({ order: order, items: order.items, discount: order.discount, pricing: I.currentPricing() });
    } catch (e) { host.innerHTML = ''; return; }

    var orderId = str($('crmOrderId') && $('crmOrderId').value);
    var res = P.calcOrderSettlements({ order: order, calc: calc, partners: P.list(), stock: I.currentStock() });
    if (!res.rows.length) { host.innerHTML = ''; return; }

    var editable = I.canEdit();
    var html = '<div class="modal-section">Взаиморасчёты · внутренний раздел</div>'
      + '<div class="pt-hint" style="margin:-4px 0 8px">Не отображается в смете, акте и коммерческом предложении.</div>';

    res.rows.forEach(function (r) {
      var exp = orderId ? P.expensesOfOrder(orderId, r.partnerId) : [];
      var expTotal = exp.reduce(function (a, e) { return a + num(e.amount, 0); }, 0);
      var isFee = r.scheme === 'service_fee';

      html += '<div class="pt-settle">'
        + '<div class="pt-settle-head">' + P.badge(r.partnerId)
        + '<span>' + esc_(r.partner.company || r.partner.name) + '</span>'
        + '<span class="pt-settle-scheme">' + esc_(r.schemeLabel) + '</span></div>'
        + '<div class="pt-settle-body">';

      html += row('Стоимость товаров партнёра', fP(r.partnerGross), 'до скидки');
      if (r.discountPct > 0) html += row('После скидки ' + r.discountPct + '%', fP(r.partnerNet));

      if (isFee) {
        html += row('Сервисный сбор NANDRENT', fP(r.serviceFeeAmount),
          r.serviceFeePct + '% от полной стоимости — скидка не учитывается');
        html += '<div class="pt-hint" style="margin:2px 0 6px">Свои изделия партнёр не арендует: в составе заказа они показаны как 0 ₽ и не печатаются в смете и акте. На складе, в сетапе и в статистике выдач они учитываются полностью.</div>';
      } else {
        html += row('Распределение прибыли', r.partnerSharePct + ' / ' + money(100 - r.partnerSharePct),
          'от суммы после скидки клиента');
      }
      html += row('Доход партнёра', fP(r.partnerIncome), null, 'pt-row-partner');
      html += row('Доход NANDRENT по этим товарам', fP(r.companyIncome));
      if (r.ownItemsTotal > 0) html += row('Наши товары в этом заказе', fP(r.ownItemsTotal), '100% наши');
      html += row('Итого доход NANDRENT', fP(r.companyIncome + r.ownItemsTotal), null, 'pt-row-total');

      html += '<div class="pt-row"><span>Дополнительные расходы' + (exp.length ? ' · ' + exp.length : '') + '</span>'
        + '<b>' + fP(expTotal) + '</b></div>';
      exp.forEach(function (e) {
        html += '<div class="pt-row" style="padding-left:10px">'
          + '<span>' + esc_(P.expenseTypeName(e.typeId))
          + (e.comment ? ' <span class="pt-sub">' + esc_(e.comment) + '</span>' : '')
          + '</span><b>' + (editable ? '<a href="#" onclick="event.preventDefault();ptOpenExpenseModal({id:\'' + esc_(e.id) + '\'})" style="color:var(--blue)">' + fP(e.amount) + '</a>' : fP(e.amount)) + '</b></div>';
      });

      if (editable) {
        html += orderId
          ? '<button type="button" class="btn btn-sm btn-secondary" style="margin-top:8px" onclick="ptOpenExpenseModal({partnerId:\'' + esc_(r.partnerId) + '\',orderId:\'' + esc_(orderId) + '\'})">+ Расход</button>'
          : '<div class="pt-hint" style="margin-top:8px">Сохраните заказ, чтобы добавить расходы.</div>';
      }
      html += '</div></div>';
    });

    host.innerHTML = html;

    function row(label, value, sub, cls) {
      return '<div class="pt-row ' + (cls || '') + '"><span>' + esc_(label)
        + (sub ? '<span class="pt-sub">' + esc_(sub) + '</span>' : '')
        + '</span><b>' + value + '</b></div>';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Поле «Собственность» в карточке товара склада
  // ══════════════════════════════════════════════════════════════════════════

  function fillStockOwner(partnerId) {
    var sel = $('crmStockOwner'), group = $('crmStockOwnerGroup');
    if (!sel || !group) return;
    var list = P.list().filter(function (p) { return p.active || p.id === partnerId; });
    group.style.display = list.length ? '' : 'none';
    sel.innerHTML = '<option value="">NANDRENT (наш товар)</option>'
      + list.map(function (p) {
        return '<option value="' + esc_(p.id) + '"' + (p.id === partnerId ? ' selected' : '') + '>'
          + esc_(p.company || p.name) + '</option>';
      }).join('');
    sel.value = str(partnerId);
  }
  function stockOwnerValue() {
    var sel = $('crmStockOwner');
    return sel && sel.closest('#crmStockOwnerGroup') && sel.closest('#crmStockOwnerGroup').style.display !== 'none'
      ? str(sel.value) : '';
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Страница «Партнёры»
  // ══════════════════════════════════════════════════════════════════════════

  function renderTabs() {
    var el = $('ptPartnerTabs');
    if (!el) return;
    var list = P.list();
    if (!list.length) { el.innerHTML = ''; return; }
    if (!P.partnerById(ui.partnerId)) ui.partnerId = list[0].id;
    el.innerHTML = list.map(function (p) {
      return '<button class="filter-btn' + (p.id === ui.partnerId ? ' active' : '') + '" onclick="ptSelectPartner(\'' + esc_(p.id) + '\')">'
        + esc_(p.company || p.name) + (p.active ? '' : ' · архив') + '</button>';
    }).join('');
  }

  function card(label, value, cls, splitRows) {
    return '<div class="pt-card"><div class="pt-card-label">' + esc_(label) + '</div>'
      + '<div class="pt-card-value ' + (cls || '') + '">' + value + '</div>'
      + (splitRows ? '<div class="pt-card-split">' + splitRows + '</div>' : '') + '</div>';
  }
  function splitRow(label, value) {
    return '<span>' + esc_(label) + '<b>' + value + '</b></span>';
  }
  function table(headers, rows, empty) {
    if (!rows.length) return '<div class="pt-empty">' + esc_(empty || 'Нет данных за период') + '</div>';
    return '<div class="table-wrap"><table><thead><tr>'
      + headers.map(function (h) { return '<th>' + esc_(h) + '</th>'; }).join('')
      + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  var PAYOUT_METHOD = { transfer: 'Перевод', cash: 'Наличные', card: 'Карта', other: 'Другое' };
  function orderLink(orderId) {
    var o = I.orderById(orderId);
    var label = o ? (o.orderNumber || o.id) : orderId;
    if (!o) return esc_(label);
    return '<a href="#" onclick="event.preventDefault();switchPage(\'crm\');crmOpenDialog(\'' + esc_(orderId) + '\')" style="color:var(--blue)">' + esc_(label) + '</a>';
  }

  function render() {
    var body = $('ptBody');
    if (!body) return;
    var warn = $('ptMigrationWarn');
    if (warn) warn.style.display = P.isMissing() ? '' : 'none';

    renderTabs();
    var label = $('ptPeriodLabel');
    var r = range();
    if (label) label.textContent = ui.period === 'all' ? 'за всё время' : (r.from + ' — ' + r.to);

    var p = activePartner();
    if (!p) {
      body.innerHTML = '<div class="empty-state"><div class="empty-icon">🤝</div>'
        + '<div class="empty-text">Партнёров пока нет</div>'
        + '<div class="empty-sub">Добавьте партнёра, затем отметьте его товары на складе</div></div>';
      return;
    }

    var rep = P.report(p.id, r);
    var bal = P.balanceOf(p.id);
    var t = rep.totals;
    var editable = I.canEdit();

    var html = '';

    // ── Деньги за период
    html += '<div class="pt-cards">'
      + card('Выручка партнёрских товаров', fP(t.partnerRevenue), 'blue',
          splitRow('До скидок', fP(t.partnerGross)) + splitRow('Заказов', fN_(rep.orders)))
      + card('Доход NANDRENT', fP(t.companyIncome), 'green',
          splitRow('Сервисный сбор', fP(t.serviceFee))
          + splitRow('Распределение прибыли', fP(t.shareIncome))
          + splitRow('Наши товары в тех же заказах', fP(t.ownItemsTotal)))
      + card('Доход партнёра', fP(t.partnerIncome), 'purple',
          splitRow('Средний на заказ', fP(rep.orders ? t.partnerIncome / rep.orders : 0)))
      + card('Дополнительные расходы', fP(rep.expenseTotal), 'amber',
          splitRow('Средний на заказ', fP(rep.expenseAvg)) + splitRow('Записей', fN_(rep.expenses.length)))
      + '</div>';

    // ── Аналитика заказов
    html += '<div class="pt-cards">'
      + card('Собственные заказы партнёра', fN_(t.ownOrders), 'dark')
      + card('Заказы сторонних клиентов', fN_(t.clientOrders), 'dark')
      + card('Всего заказов с его товарами', fN_(rep.orders), 'dark')
      + card('Общий объём заказов', fP(t.partnerRevenue + t.ownItemsTotal), 'blue')
      + '</div>';

    // ── Баланс (за всё время, не за период — это состояние счёта)
    html += '<div class="pt-section"><div class="pt-section-title"><span>Баланс партнёра · за всё время</span>'
      + (editable ? '<button class="btn btn-sm" onclick="ptOpenPayoutModal()">+ Выплата</button>' : '')
      + '</div><div class="pt-cards">'
      + card('Начислено', fP(bal.accrued), 'dark')
      + card('Удержано расходов', fP(bal.expenses), 'amber')
      + card('Выплачено', fP(bal.paid), 'green')
      + card('Задолженность перед партнёром', fP(bal.balance), bal.balance > 0 ? 'purple' : 'dark')
      + '</div></div>';

    // ── Популярные товары
    html += '<div class="pt-section"><div class="pt-section-title">Популярные позиции</div>'
      + table(['Позиция', 'Категория', 'Сдач', 'Единиц', 'Сумма'],
          rep.items.slice(0, 30).map(function (i) {
            return '<tr><td style="font-weight:500">' + esc_(i.name) + '</td><td>' + esc_(i.category || '—')
              + '</td><td class="mono">' + fN_(i.rentals) + '</td><td class="mono">' + fN_(i.units)
              + '</td><td class="mono">' + fP(i.total) + '</td></tr>';
          })) + '</div>';

    if (rep.categories.length) {
      html += '<div class="pt-section"><div class="pt-section-title">По категориям</div>'
        + table(['Категория', 'Позиций', 'Единиц', 'Сумма'],
            rep.categories.map(function (c) {
              return '<tr><td style="font-weight:500">' + esc_(c.category) + '</td><td class="mono">' + fN_(c.positions)
                + '</td><td class="mono">' + fN_(c.units) + '</td><td class="mono">' + fP(c.total) + '</td></tr>';
            })) + '</div>';
    }

    // ── Расходы
    var byType = Object.keys(rep.expenseByType);
    html += '<div class="pt-section"><div class="pt-section-title"><span>Дополнительные расходы</span>'
      + (editable ? '<button class="btn btn-sm btn-secondary" onclick="ptOpenExpenseModal({partnerId:\'' + esc_(p.id) + '\'})">+ Расход</button>' : '')
      + '</div>';
    if (byType.length) {
      html += table(['Тип расхода', 'Сумма'], byType.sort(function (a, b) { return rep.expenseByType[b] - rep.expenseByType[a]; })
        .map(function (n) { return '<tr><td style="font-weight:500">' + esc_(n) + '</td><td class="mono">' + fP(rep.expenseByType[n]) + '</td></tr>'; }));
    }
    html += table(['Дата', 'Тип', 'Заказ', 'Сумма', 'За чей счёт', 'Сотрудник', 'Комментарий'],
      rep.expenses.map(function (e) {
        return '<tr' + (editable ? ' style="cursor:pointer" onclick="ptOpenExpenseModal({id:\'' + esc_(e.id) + '\'})"' : '') + '>'
          + '<td class="mono">' + esc_(e.spentAt) + '</td><td>' + esc_(P.expenseTypeName(e.typeId)) + '</td>'
          + '<td>' + (e.orderId ? orderLink(e.orderId) : '—') + '</td>'
          + '<td class="mono">' + fP(e.amount) + '</td>'
          + '<td>' + (e.billableTo === 'company' ? 'NANDRENT' : 'партнёр') + '</td>'
          + '<td>' + esc_(e.employee || '—') + '</td><td>' + esc_(e.comment || '—') + '</td></tr>';
      }), 'Расходов за период нет') + '</div>';

    // ── Журнал начислений
    html += '<div class="pt-section"><div class="pt-section-title">Журнал начислений</div>'
      + table(['Дата', 'Заказ', 'Клиент', 'Алгоритм', 'Товары партнёра', 'Сервисный сбор', 'Партнёру', 'NANDRENT', 'Статус'],
          rep.settlements.slice().sort(function (a, b) { return String(I.settlementDate(b)).localeCompare(String(I.settlementDate(a))); })
            .map(function (s) {
              var o = I.orderById(s.orderId);
              return '<tr><td class="mono">' + esc_(str(I.settlementDate(s)).slice(0, 10)) + '</td>'
                + '<td>' + orderLink(s.orderId) + '</td>'
                + '<td>' + esc_(o ? o.clientName : '—') + '</td>'
                + '<td>' + esc_(P.SCHEME_LABEL[s.scheme] || s.scheme) + '</td>'
                + '<td class="mono">' + fP(s.partnerNet) + '</td>'
                + '<td class="mono">' + (s.serviceFeeAmount ? fP(s.serviceFeeAmount) : '—') + '</td>'
                + '<td class="mono">' + fP(s.partnerIncome) + '</td>'
                + '<td class="mono">' + fP(s.companyIncome) + '</td>'
                + '<td>' + (s.status === 'paid' ? '<span class="badge badge-green">выплачено</span>' : '<span class="badge badge-blue">начислено</span>') + '</td></tr>';
            }), 'Заказов с товарами партнёра за период нет') + '</div>';

    // ── История выплат
    html += '<div class="pt-section"><div class="pt-section-title">История выплат</div>'
      + table(['Дата', 'Сумма', 'Способ', 'Сотрудник', 'Комментарий'],
          rep.payouts.map(function (x) {
            return '<tr' + (editable ? ' style="cursor:pointer" onclick="ptOpenPayoutModal(\'' + esc_(x.id) + '\')"' : '') + '>'
              + '<td class="mono">' + esc_(x.paidAt) + '</td><td class="mono">' + fP(x.amount) + '</td>'
              + '<td>' + esc_(PAYOUT_METHOD[x.method] || x.method || '—') + '</td><td>' + esc_(x.employee || '—') + '</td>'
              + '<td>' + esc_(x.comment || '—') + '</td></tr>';
          }), 'Выплат за период нет') + '</div>';

    // ── Условия
    html += '<div class="pt-section"><div class="pt-section-title"><span>Условия сотрудничества</span>'
      + (editable ? '<button class="btn btn-sm btn-secondary" onclick="ptOpenPartnerModal(\'' + esc_(p.id) + '\')">Изменить</button>' : '')
      + '</div><div class="pt-cards">'
      + card('Сервисный сбор', num(p.serviceFeePct, 0) + '%', 'dark')
      + card('Доля партнёра', num(p.partnerSharePct, 0) + '%', 'dark')
      + card('Алгоритм', p.settlementScheme === 'auto' ? 'по клиенту' : (P.SCHEME_LABEL[p.settlementScheme] || '—'), 'dark')
      + card('Позиций на складе', fN_(I.currentStock().filter(function (s) { return s.partnerId === p.id; }).length), 'dark')
      + '</div></div>';

    body.innerHTML = html;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Формы
  // ══════════════════════════════════════════════════════════════════════════

  function guardEdit() {
    if (I.canEdit()) return true;
    toast('Нет прав на изменение партнёров', 'error');
    return false;
  }

  window.ptSelectPartner = function (id) { ui.partnerId = str(id); render(); };
  window.ptOnPeriodChange = function () {
    ui.period = $('ptPeriod').value;
    var cr = $('ptCustomRange');
    if (cr) cr.style.display = ui.period === 'custom' ? 'inline-flex' : 'none';
    if (ui.period === 'custom') {
      if (!$('ptFrom').value) $('ptFrom').value = P.periodRange('month').from;
      if (!$('ptTo').value) $('ptTo').value = today();
      ui.from = $('ptFrom').value;
      ui.to = $('ptTo').value;
    }
    render();
  };
  window.ptRender = function () {
    ui.from = $('ptFrom') ? $('ptFrom').value : '';
    ui.to = $('ptTo') ? $('ptTo').value : '';
    render();
  };

  // ── Партнёр
  window.ptOpenPartnerModal = function (id) {
    if (!guardEdit()) return;
    var p = id ? P.partnerById(id) : null;
    $('ptPartnerModalTitle').textContent = p ? 'Партнёр' : 'Новый партнёр';
    $('ptPartnerId').value = p ? p.id : '';
    $('ptPartnerName').value = p ? p.name : '';
    $('ptPartnerCompany').value = p ? p.company : '';
    $('ptPartnerPhone').value = p ? p.phone : '';
    $('ptPartnerClient').value = p ? (p.clientName || '') : '';
    $('ptPartnerFee').value = p ? num(p.serviceFeePct, 0) : 5;
    $('ptPartnerShare').value = p ? num(p.partnerSharePct, 0) : 50;
    $('ptPartnerScheme').value = p ? p.settlementScheme : 'auto';
    $('ptPartnerCode').value = p ? p.code : '';
    $('ptPartnerColor').value = (p && p.color) || '#7C5CFF';
    $('ptPartnerNote').value = p ? p.note : '';
    $('ptPartnerActive').checked = p ? p.active !== false : true;
    $('ptPartnerDeleteBtn').style.display = p ? '' : 'none';
    var dl = $('ptClientList');
    if (dl) {
      var clients = [];
      try { clients = Array.isArray(crmClients) ? crmClients : []; } catch (e) { }
      dl.innerHTML = clients.map(function (c) { return '<option value="' + esc_(c.name) + '"></option>'; }).join('');
    }
    openModal('ptPartnerModal');
  };

  window.ptSavePartner = async function () {
    if (!guardEdit()) return;
    var name = $('ptPartnerName').value.trim();
    if (!name) { toast('Укажите имя партнёра', 'error'); return; }
    var clientName = $('ptPartnerClient').value.trim();
    var client = null;
    try { client = (Array.isArray(crmClients) ? crmClients : []).filter(function (c) { return c.name === clientName; })[0] || null; } catch (e) { }
    var id = $('ptPartnerId').value || ('p-' + name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 24) + '-' + Math.random().toString(36).slice(2, 5));
    var payload = {
      id: id, name: name,
      company: $('ptPartnerCompany').value.trim(),
      phone: $('ptPartnerPhone').value.trim(),
      clientId: client ? client.id : '',
      clientName: clientName,
      serviceFeePct: num($('ptPartnerFee').value, 0),
      partnerSharePct: num($('ptPartnerShare').value, 0),
      settlementScheme: $('ptPartnerScheme').value,
      code: $('ptPartnerCode').value.trim().toUpperCase(),
      color: $('ptPartnerColor').value,
      note: $('ptPartnerNote').value.trim(),
      active: $('ptPartnerActive').checked
    };
    try {
      await RadarStore.savePartner(payload);
      await P.load(true);
      ui.partnerId = id;
      closeModal('ptPartnerModal');
      toast('Сохранено');
      render();
    } catch (e) { toast(e.message || 'Ошибка сохранения', 'error'); }
  };

  window.ptDeletePartner = async function () {
    if (!guardEdit()) return;
    var id = $('ptPartnerId').value;
    if (!id) return;
    var used = I.currentStock().filter(function (s) { return s.partnerId === id; }).length;
    if (used) { toast('Сначала снимите метку партнёра с ' + used + ' поз. склада', 'error'); return; }
    if (!confirm('Удалить партнёра? Взаиморасчёты и выплаты по нему тоже будут удалены.')) return;
    try {
      await RadarStore.deletePartner(id);
      await P.load(true);
      ui.partnerId = '';
      closeModal('ptPartnerModal');
      toast('Удалено');
      render();
    } catch (e) { toast(e.message || 'Ошибка удаления', 'error'); }
  };

  // ── Расход
  window.ptOpenExpenseModal = function (opts) {
    if (!guardEdit()) return;
    opts = opts || {};
    var e = opts.id ? P.state.expenses.filter(function (x) { return x.id === opts.id; })[0] : null;
    var partnerId = e ? e.partnerId : (opts.partnerId || (activePartner() && activePartner().id) || '');
    var orderId = e ? e.orderId : str(opts.orderId);

    $('ptExpenseModalTitle').textContent = e ? 'Дополнительный расход' : 'Новый расход';
    $('ptExpenseId').value = e ? e.id : '';
    $('ptExpensePartner').value = partnerId;
    $('ptExpenseOrder').value = orderId;
    var p = P.partnerById(partnerId);
    var o = orderId ? I.orderById(orderId) : null;
    $('ptExpenseOrderInfo').innerHTML = esc_(p ? (p.company || p.name) : '—')
      + (o ? ' · заказ ' + esc_(o.orderNumber || o.id) + ' · ' + esc_(o.clientName) : ' · без привязки к заказу');

    var sel = $('ptExpenseType');
    sel.innerHTML = P.state.expenseTypes.map(function (t) {
      return '<option value="' + esc_(t.id) + '"' + (e && e.typeId === t.id ? ' selected' : '') + '>' + esc_(t.name) + '</option>';
    }).join('') || '<option value="other">Прочее</option>';
    if (e) sel.value = e.typeId;

    $('ptExpenseAmount').value = e ? num(e.amount, 0) : 0;
    $('ptExpenseDate').value = e ? e.spentAt : (o && o.endDate ? o.endDate : today());
    $('ptExpenseEmployee').value = e ? e.employee : I.whoami();
    $('ptExpenseBillable').value = e ? e.billableTo : 'partner';
    $('ptExpenseComment').value = e ? e.comment : '';
    $('ptExpenseDeleteBtn').style.display = e ? '' : 'none';
    openModal('ptExpenseModal');
  };

  window.ptSaveExpense = async function () {
    if (!guardEdit()) return;
    var partnerId = $('ptExpensePartner').value;
    if (!partnerId) { toast('Не выбран партнёр', 'error'); return; }
    var payload = {
      id: $('ptExpenseId').value || uid('exp'),
      partnerId: partnerId,
      orderId: $('ptExpenseOrder').value,
      typeId: $('ptExpenseType').value,
      amount: num($('ptExpenseAmount').value, 0),
      spentAt: $('ptExpenseDate').value || today(),
      employee: $('ptExpenseEmployee').value.trim(),
      billableTo: $('ptExpenseBillable').value,
      comment: $('ptExpenseComment').value.trim()
    };
    try {
      await RadarStore.savePartnerExpense(payload);
      await P.load(true);
      closeModal('ptExpenseModal');
      toast('Сохранено');
      render();
      renderOrderBlock();
    } catch (e) { toast(e.message || 'Ошибка сохранения', 'error'); }
  };

  window.ptDeleteExpense = async function () {
    if (!guardEdit()) return;
    var id = $('ptExpenseId').value;
    if (!id || !confirm('Удалить расход?')) return;
    try {
      await RadarStore.deletePartnerExpense(id);
      await P.load(true);
      closeModal('ptExpenseModal');
      toast('Удалено');
      render();
      renderOrderBlock();
    } catch (e) { toast(e.message || 'Ошибка удаления', 'error'); }
  };

  // ── Выплата
  window.ptOpenPayoutModal = function (id) {
    if (!guardEdit()) return;
    var x = id ? P.state.payouts.filter(function (y) { return y.id === id; })[0] : null;
    var p = x ? P.partnerById(x.partnerId) : activePartner();
    if (!p) return;
    var bal = P.balanceOf(p.id);
    $('ptPayoutId').value = x ? x.id : '';
    $('ptPayoutPartner').value = p.id;
    $('ptPayoutInfo').innerHTML = esc_(p.company || p.name) + ' · задолженность ' + fP(bal.balance);
    $('ptPayoutAmount').value = x ? num(x.amount, 0) : Math.max(0, bal.balance);
    $('ptPayoutDate').value = x ? x.paidAt : today();
    $('ptPayoutMethod').value = (x && x.method) || 'transfer';
    $('ptPayoutEmployee').value = x ? x.employee : I.whoami();
    $('ptPayoutComment').value = x ? x.comment : '';
    $('ptPayoutDeleteBtn').style.display = x ? '' : 'none';
    openModal('ptPayoutModal');
  };

  window.ptSavePayout = async function () {
    if (!guardEdit()) return;
    var payload = {
      id: $('ptPayoutId').value || uid('pay'),
      partnerId: $('ptPayoutPartner').value,
      amount: num($('ptPayoutAmount').value, 0),
      paidAt: $('ptPayoutDate').value || today(),
      method: $('ptPayoutMethod').value,
      employee: $('ptPayoutEmployee').value.trim(),
      comment: $('ptPayoutComment').value.trim()
    };
    if (!payload.partnerId) { toast('Не выбран партнёр', 'error'); return; }
    if (payload.amount <= 0) { toast('Укажите сумму выплаты', 'error'); return; }
    try {
      await RadarStore.savePartnerPayout(payload);
      await P.load(true);
      closeModal('ptPayoutModal');
      toast('Выплата записана');
      render();
    } catch (e) { toast(e.message || 'Ошибка сохранения', 'error'); }
  };

  window.ptDeletePayout = async function () {
    if (!guardEdit()) return;
    var id = $('ptPayoutId').value;
    if (!id || !confirm('Удалить выплату?')) return;
    try {
      await RadarStore.deletePartnerPayout(id);
      await P.load(true);
      closeModal('ptPayoutModal');
      toast('Удалено');
      render();
    } catch (e) { toast(e.message || 'Ошибка удаления', 'error'); }
  };

  // ── Полный пересчёт
  // Нужен после установки раздела и для заказов, сохранённых офлайн:
  // взаиморасчёт пишется только когда заказ уже подтверждён сервером.
  window.ptRecalcAll = async function () {
    if (!guardEdit()) return;
    var b = $('ptRecalcBtn');
    if (b) { b.disabled = true; b.textContent = 'Пересчёт…'; }
    try {
      var r = await P.recalcAll(function (done, total) {
        if (b) b.textContent = 'Пересчёт ' + done + '/' + total;
      });
      toast('Пересчитано заказов: ' + r.touched);
      render();
    } catch (e) { toast(e.message || 'Ошибка пересчёта', 'error'); }
    finally { if (b) { b.disabled = false; b.textContent = '↻ Пересчитать'; } }
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  Подключение к приложению
  // ══════════════════════════════════════════════════════════════════════════

  var opened = false;
  async function open() {
    if (!I.canView()) return;
    var addBtn = $('ptAddPartnerBtn'), recalcBtn = $('ptRecalcBtn');
    if (addBtn) addBtn.style.display = I.canEdit() ? '' : 'none';
    if (recalcBtn) recalcBtn.style.display = I.canEdit() ? '' : 'none';
    render();                                  // мгновенно из того, что уже загружено
    if (!I.currentOrders().length && typeof crmInit === 'function') {
      try { await crmInit(); } catch (e) { }
    }
    await P.load(!opened);
    opened = true;
    render();
  }

  var prevSwitch = window.switchPage;
  window.switchPage = function (p) {
    prevSwitch(p);
    if (p === 'partners') open();
  };

  window.RadarPartnersUI = {
    render: render,
    renderOrderBlock: renderOrderBlock,
    fillStockOwner: fillStockOwner,
    stockOwnerValue: stockOwnerValue,
    open: open
  };

  // Бейджи на складе и в заказах нужны раньше, чем пользователь зайдёт
  // в раздел партнёров, — подтягиваем справочник в фоне.
  window.addEventListener('load', function () {
    setTimeout(function () {
      P.ensurePartners().then(function (list) {
        if (!list.length) return;
        if (typeof crmRenderStock === 'function' && $('page-crmstock')) {
          try { crmRenderStock(); } catch (e) { }
        }
      });
    }, 1200);
  });
})();
