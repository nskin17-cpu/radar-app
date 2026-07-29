/**
 * Radar NR — «Выдача заказов»: доска склада (Сборка → Собрано → Выдан → Вернули).
 *
 * Для кого: сотрудник склада с допуском «assembly». Он видит ЧТО собрать и КОГДА,
 * но не видит клиента, адрес и суммы заказа — только состав, даты и номер.
 * Залог и компенсации он при этом фиксирует сам: это его операция при выдаче/возврате.
 *
 * Как устроено:
 *  - Источник данных — те же crmOrders (единая правда с CRM). Складское состояние
 *    лежит в order.wh (см. sql/security-5-warehouse.sql), переходы двигают и
 *    обычные статусы CRM: выдан → «В работе», вернули → «Выполнен», залог →
 *    depositStatus, компенсация → compensationAmount. Менеджеры видят работу
 *    склада в привычном списке заказов без новых сущностей.
 *  - Все правки идут через RadarStore (outbox): переживают офлайн и перезагрузку.
 *    Для складского допуска запись уходит как UPDATE (см. saveOrder.updateOnly) —
 *    RLS не разрешает ему INSERT, а серверный триггер пропускает только складские поля.
 *  - Переходы: кнопками на карточке (телефон) и перетаскиванием (компьютер).
 */
(function () {
  'use strict';

  var WH_PAY_OK = { prepaid: 1, paid: 1, paid_cash: 1 };
  var WH_PAY_LABEL = { prepaid: 'Предоплата', paid: 'Оплачен', paid_cash: 'Наличные' };
  var WH_METHODS = { cash: 'Наличные', transfer: 'Перевод', card: 'Карта', none: 'Без залога' };
  var RETURN_WINDOW_DAYS = 14;   // сколько дней завершённые заказы видны в последней колонке
  var ASSEMBLY_HORIZON = 3;      // за сколько дней до выдачи заказ падает в «Сборку»

  // Деньгами занимается менеджер: склад лишь фиксирует факт (компенсация, недостача),
  // после чего карточка ждёт менеджера в колонке «Возврат залога / Компенсация» и
  // уходит в «Заказ завершён», когда вопрос закрыт (или сразу, если вопросов нет).
  var COLS = [
    { key: 'todo',       title: 'Сборка' },
    { key: 'assembled',  title: 'Собрано' },
    { key: 'issued',     title: 'Выдан' },
    { key: 'resolution', title: 'Залог / Компенсация' },
    { key: 'done',       title: 'Заказ завершён' }
  ];

  /** Возврат принят, но остались денежные вопросы: залог у нас или компенсация не закрыта. */
  function needsResolution(o, w) {
    if (w.resolvedAt) return false;
    if (o.depositStatus === 'deposited') return true;                       // залог надо вернуть или удержать
    if (Number(o.compensationAmount) > 0 && o.depositStatus === 'pending') return true; // компенсация без залога
    return false;
  }

  function $(id) { return document.getElementById(id); }
  function whUser() { return (window.currentUser && window.currentUser.username) || 'user'; }
  function nowIso() { return new Date().toISOString(); }
  function canEdit() { return typeof radarCanEdit === 'function' && radarCanEdit('assembly'); }
  // ВАЖНО: crmOrders/crmInitDone/crmPricing в crm.js объявлены через let —
  // это лексические глобали, а НЕ window.crmOrders. Обращаемся напрямую.
  function orders() { try { return Array.isArray(crmOrders) ? crmOrders : []; } catch (e) { return []; } }
  function crmReady() { try { return !!crmInitDone; } catch (e) { return false; } }
  function pricingCfg() { try { return crmPricing || {}; } catch (e) { return {}; } }
  function findOrder(id) { return orders().find(function (o) { return o.id === id; }); }

  /** Складское состояние с дефолтами — order.wh может отсутствовать. */
  function whGet(o) {
    var w = (o && o.wh && typeof o.wh === 'object') ? o.wh : {};
    return {
      state: w.state || 'todo',
      checklist: (w.checklist && typeof w.checklist === 'object') ? w.checklist : {},
      notes: Array.isArray(w.notes) ? w.notes : [],
      assembledAt: w.assembledAt || null, assembledBy: w.assembledBy || null,
      issuedAt: w.issuedAt || null, issuedBy: w.issuedBy || null,
      issue: (w.issue && typeof w.issue === 'object') ? w.issue : null,
      returnedAt: w.returnedAt || null, returnedBy: w.returnedBy || null,
      ret: (w.ret && typeof w.ret === 'object') ? w.ret : null,
      resolvedAt: w.resolvedAt || null, resolvedBy: w.resolvedBy || null,
      prevStatus: w.prevStatus || null
    };
  }

  function day0(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function parseDay(s) {
    var d = (typeof crmParseDateLocal === 'function') ? crmParseDateLocal(s) : (s ? new Date(s) : null);
    return d && !isNaN(d) ? day0(d) : null;
  }
  function fmtDate(s) { return typeof crmFormatDate === 'function' ? crmFormatDate(s) : (s || '—'); }
  function fmtDT(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  /** Раскладка заказов по колонкам. */
  function buildColumns() {
    var today = day0(new Date());
    var horizon = new Date(today); horizon.setDate(horizon.getDate() + ASSEMBLY_HORIZON);
    var retCutoff = new Date(today); retCutoff.setDate(retCutoff.getDate() - RETURN_WINDOW_DAYS);
    var out = { todo: [], assembled: [], issued: [], resolution: [], done: [] };

    orders().forEach(function (o) {
      var w = whGet(o);
      if (w.state === 'returned') {
        // Открытые денежные вопросы не протухают — висят, пока менеджер не закроет
        if (needsResolution(o, w)) { out.resolution.push(o); return; }
        var ra = w.returnedAt ? new Date(w.returnedAt) : null;
        if (ra && !isNaN(ra) && ra >= retCutoff) out.done.push(o);
        return;
      }
      // Менеджер закрыл заказ сам — с доски убираем, чтобы не собирали зря
      if (o.status === 'completed') return;
      if (w.state === 'issued') { out.issued.push(o); return; }
      if (w.state === 'assembled') { out.assembled.push(o); return; }
      // «Сборка»: оплачен или предоплачен, до выдачи не больше 3 дней (просроченные остаются)
      if (!WH_PAY_OK[o.paymentStatus]) return;
      var d = parseDay(o.startDate);
      if (!d || d > horizon) return;
      out.todo.push(o);
    });

    var byStart = function (a, b) { return (parseDay(a.startDate) || 0) - (parseDay(b.startDate) || 0); };
    out.todo.sort(byStart);
    out.assembled.sort(byStart);
    out.issued.sort(function (a, b) { return (parseDay(a.endDate) || 0) - (parseDay(b.endDate) || 0); });
    // Старые открытые вопросы — сверху, чтобы не зависали
    out.resolution.sort(function (a, b) { return String(whGet(a).returnedAt || '').localeCompare(String(whGet(b).returnedAt || '')); });
    out.done.sort(function (a, b) { return String(whGet(b).returnedAt || '').localeCompare(String(whGet(a).returnedAt || '')); });
    return out;
  }

  /** Бейдж срока: «выдача сегодня», «просрочено» и т.п. */
  function dueBadge(o, w) {
    var today = day0(new Date());
    var ref, word;
    if (w.state === 'issued') { ref = parseDay(o.endDate); word = 'возврат'; }
    else if (w.state === 'returned') return '<span class="wh-badge wh-b-grey">возврат ' + fmtDT(w.returnedAt) + '</span>';
    else { ref = parseDay(o.startDate); word = 'выдача'; }
    if (!ref) return '';
    var diff = Math.round((ref - today) / 86400000);
    if (diff < 0) return '<span class="wh-badge wh-b-red">' + word + ' просрочен' + (word === 'выдача' ? 'а' : '') + ' ' + (-diff) + ' дн</span>';
    if (diff === 0) return '<span class="wh-badge wh-b-red">' + word + ' сегодня</span>';
    if (diff === 1) return '<span class="wh-badge wh-b-amber">' + word + ' завтра</span>';
    return '<span class="wh-badge wh-b-grey">' + word + ' ' + fmtDate(w.state === 'issued' ? o.endDate : o.startDate) + '</span>';
  }

  function payBadge(o) {
    var cls = o.paymentStatus === 'prepaid' ? 'wh-b-amber' : 'wh-b-green';
    var lbl = WH_PAY_LABEL[o.paymentStatus];
    return lbl ? '<span class="wh-badge ' + cls + '">' + lbl + '</span>' : '';
  }

  function checklistProgress(o, w) {
    var total = (o.items || []).length;
    if (!total) return { done: 0, total: 0, pct: 0 };
    var done = 0;
    (o.items || []).forEach(function (_, i) { if (w.checklist[String(i)]) done++; });
    return { done: done, total: total, pct: Math.round(done * 100 / total) };
  }

  function itemName(i) { return typeof crmGetItemDisplayName === 'function' ? crmGetItemDisplayName(i) : (i && i.name) || '—'; }

  // ── Рендер доски ───────────────────────────────────────────────────────────

  function whRender() {
    var board = $('whBoard');
    if (!board) return;
    var cols = buildColumns();
    board.innerHTML = COLS.map(function (c) {
      var list = cols[c.key];
      return '<div class="wh-col" data-wh-col="' + c.key + '">' +
        '<div class="wh-col-head"><span>' + c.title + '</span><span class="wh-count">' + list.length + '</span></div>' +
        (list.length ? list.map(function (o) { return cardHtml(o, c.key); }).join('') :
          '<div class="wh-empty">' + emptyText(c.key) + '</div>') +
        '</div>';
    }).join('');
    bindDnD();
  }

  function emptyText(key) {
    return { todo: 'Нечего собирать — оплаченных заказов на ближайшие ' + ASSEMBLY_HORIZON + ' дня нет',
             assembled: 'Собранных заказов нет', issued: 'На руках у клиентов ничего нет',
             resolution: 'Открытых вопросов по залогам и компенсациям нет',
             done: 'Завершённых заказов за ' + RETURN_WINDOW_DAYS + ' дней нет' }[key] || 'Пусто';
  }

  function cardHtml(o, colKey) {
    var w = whGet(o);
    var p = checklistProgress(o, w);
    var items = (o.items || []);
    var shown = items.slice(0, 3);
    var more = items.length - shown.length;
    var deliv = o.deliveryType === 'pickup' ? 'Самовывоз' : 'Доставка';
    var edit = canEdit();

    var actions = '';
    if (edit) {
      if (colKey === 'todo') actions = btn('whMarkAssembled', o.id, 'Собрано ✓');
      else if (colKey === 'assembled') actions = btn('whMarkIssued', o.id, 'Выдать →') + btnSec('whPrintAct', o.id, 'Акт');
      else if (colKey === 'issued') actions = btn('whOpenReturn', o.id, 'Принять возврат ←') + btnSec('whPrintAct', o.id, 'Акт');
    } else if (colKey === 'assembled' || colKey === 'issued') {
      actions = btnSec('whPrintAct', o.id, 'Акт');
    }
    // Денежный вопрос закрывает менеджер (нужен допуск к заказам)
    if (colKey === 'resolution' && typeof radarCanEdit === 'function' && radarCanEdit('orders')) {
      actions = btn('whResolve', o.id, 'Вопрос закрыт ✓');
    }

    var noteCount = w.notes.length;
    var flags = [];
    // Ярлыки для менеджера: что именно требует внимания
    if (w.state === 'returned' && Number(o.compensationAmount) > 0 && !w.resolvedAt) {
      flags.push('<span class="wh-badge wh-b-red" title="' + esc(o.compensationNote || '') + '">компенсация ' + fN(o.compensationAmount) + ' ₽</span>');
    }
    if (w.state === 'returned' && o.depositStatus === 'deposited' && !w.resolvedAt) {
      flags.push('<span class="wh-badge wh-b-blue">залог к возврату</span>');
    }
    if (w.ret && (w.ret.missing || []).length && colKey !== 'done') {
      flags.push('<span class="wh-badge wh-b-amber">недостача</span>');
    }
    if (noteCount) flags.push('<span class="wh-badge wh-b-grey">💬 ' + noteCount + '</span>');

    return '<div class="wh-card" draggable="' + (edit ? 'true' : 'false') + '" data-wh-card="' + esc(o.id) + '" onclick="whOpenCard(\'' + esc(o.id) + '\')">' +
      '<div class="wh-card-top"><span class="wh-num">' + esc(o.orderNumber || o.id) + '</span><span class="wh-deliv">' + deliv + '</span></div>' +
      '<div class="wh-badges">' + dueBadge(o, w) + payBadge(o) + flags.join('') + '</div>' +
      '<div class="wh-items">' + shown.map(function (i) {
        return '<div>• ' + esc(itemName(i)) + ' ×' + esc(i.qty) + '</div>';
      }).join('') + (more > 0 ? '<div class="wh-more">ещё ' + more + ' поз.</div>' : '') + '</div>' +
      (colKey === 'todo' && p.total ? '<div class="wh-progress-row"><div class="wh-progress"><i style="width:' + p.pct + '%"></i></div><span>' + p.done + '/' + p.total + '</span></div>' : '') +
      (actions ? '<div class="wh-actions" onclick="event.stopPropagation()">' + actions + '</div>' : '') +
      '</div>';
  }

  function btn(fn, id, label) { return '<button class="btn btn-sm" onclick="' + fn + '(\'' + esc(id) + '\')">' + label + '</button>'; }
  function btnSec(fn, id, label) { return '<button class="btn btn-sm btn-secondary" onclick="' + fn + '(\'' + esc(id) + '\')">' + label + '</button>'; }

  // ── Перетаскивание (компьютер). На телефоне — кнопки. ──────────────────────

  function bindDnD() {
    if (!canEdit()) return;
    document.querySelectorAll('[data-wh-card]').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/wh-order', el.dataset.whCard);
        e.dataTransfer.effectAllowed = 'move';
      });
    });
    document.querySelectorAll('[data-wh-col]').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('wh-drop'); });
      col.addEventListener('dragleave', function () { col.classList.remove('wh-drop'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault(); col.classList.remove('wh-drop');
        var id = e.dataTransfer.getData('text/wh-order');
        if (id) whMoveTo(id, col.dataset.whCol);
      });
    });
  }

  /** Маршрутизатор перемещений: и для перетаскивания, и для кнопок-переходов. */
  function whMoveTo(id, target) {
    var o = findOrder(id);
    if (!o) return;
    var w = whGet(o);
    var from = w.state === 'returned' ? (needsResolution(o, w) ? 'resolution' : 'done') : w.state;
    if (from === target) return;
    var route = from + '>' + target;
    if (route === 'todo>assembled') return whMarkAssembled(id);
    if (route === 'assembled>issued') return whMarkIssued(id);
    if (route === 'issued>resolution' || route === 'issued>done') return whOpenReturn(id);
    if (route === 'resolution>done') return whResolve(id);
    if (route === 'assembled>todo') return whReopen(id, 'todo');
    if (route === 'issued>assembled') return whReopen(id, 'assembled');
    if (route === 'resolution>issued' || route === 'done>issued') return whReopen(id, 'issued');
    showToast('Так перенести нельзя: только в соседний столбец', 'error');
  }

  // ── Сохранение ─────────────────────────────────────────────────────────────

  /**
   * Единая точка записи. label попадает в журнал заказа (виден менеджерам
   * в истории изменений), синхронизирует crmOrders и обе страницы.
   */
  function whSave(next, prev, label) {
    var entries = label ? [{ at: nowIso(), user: whUser(), field: '_wh', label: label, from: null, to: null }] : [];
    var res = RadarStore.saveOrder(next, {
      previous: prev,
      user: whUser(),
      updateOnly: !(typeof radarCanEdit === 'function' && radarCanEdit('orders')),
      extraLog: entries
    });
    var list = orders();
    var ix = list.findIndex(function (x) { return x.id === res.id; });
    if (ix >= 0) list[ix] = res.order;
    whRender();
    try { if (crmReady() && typeof crmRenderOrders === 'function') crmRenderOrders(); } catch (e) { }
    RadarStore.flush({ force: true });
    return res.order;
  }

  function guardEdit() {
    if (canEdit()) return true;
    showToast('Нет допуска на выдачу заказов', 'error');
    return false;
  }

  // ── Переходы ───────────────────────────────────────────────────────────────

  window.whToggleCheck = function (id, idx, checked) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var ch = Object.assign({}, w.checklist);
    if (checked) ch[String(idx)] = true; else delete ch[String(idx)];
    whSave(Object.assign({}, o, { wh: Object.assign({}, w, { checklist: ch }) }), o, null);
    var open = $('whCardModal') && $('whCardModal').classList.contains('active');
    if (open) whOpenCard(id, true);
  };

  window.whMarkAssembled = function (id) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var p = checklistProgress(o, w);
    if (p.total && p.done < p.total &&
        !confirm('Отмечено ' + p.done + ' из ' + p.total + ' позиций. Перенести в «Собрано» всё равно?')) return;
    whSave(Object.assign({}, o, {
      wh: Object.assign({}, w, { state: 'assembled', assembledAt: nowIso(), assembledBy: whUser() })
    }), o, 'Склад: заказ собран (' + p.done + '/' + p.total + ' поз.)');
    closeModal('whCardModal', true);
    showToast('Заказ собран', 'success');
  };

  /** Возврат карточки на шаг назад — если ошиблись. Статусы CRM откатываются тоже. */
  window.whReopen = function (id, target) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var labels = { todo: 'обратно в «Сборку»', assembled: 'обратно в «Собрано»', issued: 'обратно в «Выдан»' };
    if (!confirm('Вернуть заказ ' + (labels[target] || target) + '?')) return;
    var patchTop = {};
    var nw = Object.assign({}, w, { state: target });
    if (w.state === 'issued' && target === 'assembled') {
      patchTop.status = w.prevStatus || 'preparing';
      nw.issuedAt = null; nw.issuedBy = null;
    }
    if (w.state === 'returned' && target === 'issued') {
      patchTop.status = 'in_progress';
      // Компенсацию, записанную этим возвратом, откатываем; правки менеджера не трогаем
      if (w.ret && Number(w.ret.compensation) > 0 && Number(o.compensationAmount) === Number(w.ret.compensation)) {
        patchTop.compensationAmount = 0; patchTop.compensationNote = '';
      }
      nw.returnedAt = null; nw.returnedBy = null; nw.ret = null; nw.resolvedAt = null; nw.resolvedBy = null;
    }
    if (w.state === 'assembled' && target === 'todo') { nw.assembledAt = null; nw.assembledBy = null; }
    whSave(Object.assign({}, o, patchTop, { wh: nw }), o, 'Склад: возврат карточки ' + (labels[target] || target));
    closeModal('whCardModal', true);
  };

  // ── Выдача ─────────────────────────────────────────────────────────────────
  // Залог, способ оплаты и прочие деньги отмечает менеджер в карточке заказа
  // на странице «Заказы» — склад только фиксирует факт выдачи.

  window.whMarkIssued = function (id) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    if (!confirm('Выдать заказ ' + (o.orderNumber || '') + ' клиенту?')) return;
    whSave(Object.assign({}, o, { status: 'in_progress' }, {
      wh: Object.assign({}, w, {
        state: 'issued', issuedAt: nowIso(), issuedBy: whUser(), prevStatus: o.status
      })
    }), o, 'Склад: заказ выдан');
    closeModal('whCardModal', true);
    showToast('Заказ выдан', 'success');
  };

  // ── Возврат (модалка с чек-листом, компенсацией и залогом) ─────────────────

  window.whOpenReturn = function (id) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    $('whReturnOrderId').value = id;
    $('whReturnTitle').textContent = 'Возврат ' + (o.orderNumber || '');
    $('whReturnChecklist').innerHTML = (o.items || []).map(function (i, ix) {
      return '<label class="wh-check"><input type="checkbox" data-wh-ret="' + ix + '"> ' +
        esc(itemName(i)) + ' ×' + esc(i.qty) + '</label>';
    }).join('') || '<div class="wh-empty">Состав заказа пуст</div>';
    $('whReturnDamage').value = '';
    $('whReturnComp').value = '';
    $('whReturnCompNote').value = '';
    openModal('whReturnModal');
  };

  window.whReturnCheckAll = function () {
    document.querySelectorAll('#whReturnChecklist input[type=checkbox]').forEach(function (c) { c.checked = true; });
  };

  window.whConfirmReturn = function () {
    var id = $('whReturnOrderId').value;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var boxes = Array.prototype.slice.call(document.querySelectorAll('#whReturnChecklist input[type=checkbox]'));
    var missing = [];
    var retCheck = {};
    boxes.forEach(function (c) {
      var ix = Number(c.dataset.whRet);
      if (c.checked) retCheck[String(ix)] = true;
      else if (o.items && o.items[ix]) missing.push(itemName(o.items[ix]) + ' ×' + o.items[ix].qty);
    });
    if (missing.length && !confirm('Не отмечено: ' + missing.join(', ') + '.\nПринять возврат с недостачей?')) return;

    var damage = $('whReturnDamage').value.trim();
    var comp = Math.max(0, Number($('whReturnComp').value) || 0);
    var compNote = $('whReturnCompNote').value.trim();
    if (comp > 0 && !compNote && !damage &&
        !confirm('Компенсация ' + fN(comp) + ' ₽ без описания причины. Продолжить?')) return;

    // Статус залога склад не трогает: вернуть или удержать решает менеджер.
    // Карточка с компенсацией или невозвращённым залогом сама встанет в колонку
    // «Залог / Компенсация» и уйдёт в «Заказ завершён», когда менеджер закроет вопрос.
    var patchTop = { status: 'completed' };
    if (comp > 0) {
      patchTop.compensationAmount = comp;
      patchTop.compensationNote = compNote || damage || 'Зафиксировано складом при возврате';
    }

    var parts = ['Склад: возврат принят'];
    if (missing.length) parts.push('недостача: ' + missing.join(', '));
    if (damage) parts.push('повреждения: ' + damage);
    if (comp > 0) parts.push('компенсация ' + fN(comp) + ' ₽' + (compNote ? ' (' + compNote + ')' : ''));

    whSave(Object.assign({}, o, patchTop, {
      wh: Object.assign({}, w, {
        state: 'returned', returnedAt: nowIso(), returnedBy: whUser(),
        ret: { checklist: retCheck, missing: missing, damage: damage,
               compensation: comp, compensationNote: compNote }
      })
    }), o, parts.join('; '));
    closeModal('whReturnModal', true);
    closeModal('whCardModal', true);
    showToast('Возврат принят', 'success');
  };

  /** Менеджер закрыл денежный вопрос: залог вернул/удержал, компенсацию решил. */
  window.whResolve = function (id) {
    if (!(typeof radarCanEdit === 'function' && radarCanEdit('orders'))) {
      showToast('Вопрос по залогу и компенсации закрывает менеджер', 'error'); return;
    }
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var hints = [];
    if (o.depositStatus === 'deposited') hints.push('залог всё ещё отмечен как «Внесён» — не забудьте проставить «Вернули» или «Компенс.» в списке заказов');
    if (!confirm('Закрыть вопрос по заказу ' + (o.orderNumber || '') + '?' + (hints.length ? '\n\nВнимание: ' + hints.join('; ') : ''))) return;
    whSave(Object.assign({}, o, {
      wh: Object.assign({}, w, { resolvedAt: nowIso(), resolvedBy: whUser() })
    }), o, 'Менеджер: вопрос по залогу/компенсации закрыт');
    closeModal('whCardModal', true);
    showToast('Заказ завершён', 'success');
  };

  // ── Карточка заказа (клик): состав, чек-лист, комментарии, история ─────────

  window.whOpenCard = function (id, keepScroll) {
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var edit = canEdit();
    var stateLbl = w.state === 'returned'
      ? (needsResolution(o, w) ? 'Залог / Компенсация' : 'Заказ завершён')
      : { todo: 'Сборка', assembled: 'Собрано', issued: 'Выдан' }[w.state];
    $('whCardTitle').textContent = (o.orderNumber || o.id) + ' — ' + stateLbl;

    var deliv = o.deliveryType === 'pickup' ? 'Самовывоз' : 'Доставка';
    $('whCardMeta').innerHTML =
      '<div class="wh-meta-line"><span>Выдача</span><strong>' + fmtDate(o.startDate) + '</strong></div>' +
      '<div class="wh-meta-line"><span>Возврат</span><strong>' + fmtDate(o.endDate) + '</strong></div>' +
      '<div class="wh-meta-line"><span>Получение</span><strong>' + deliv + '</strong></div>' +
      '<div class="wh-badges" style="margin:4px 0 0">' + dueBadge(o, w) + payBadge(o) + '</div>';

    // Чек-лист сборки: интерактивен только в «Сборке»
    var interactive = edit && w.state === 'todo';
    $('whCardItems').innerHTML = (o.items || []).map(function (i, ix) {
      var checked = !!w.checklist[String(ix)];
      if (interactive) {
        return '<label class="wh-check"><input type="checkbox" ' + (checked ? 'checked' : '') +
          ' onchange="whToggleCheck(\'' + esc(o.id) + '\',' + ix + ',this.checked)"> ' +
          esc(itemName(i)) + ' ×' + esc(i.qty) + '</label>';
      }
      return '<div class="wh-check wh-check-ro">' + (checked || w.state !== 'todo' ? '✓' : '○') + ' ' +
        esc(itemName(i)) + ' ×' + esc(i.qty) + '</div>';
    }).join('') || '<div class="wh-empty">Состав не заполнен</div>';

    // История склада
    var hist = [];
    hist.push({ at: o.createdAt, text: 'Заказ создан' });
    if (w.assembledAt) hist.push({ at: w.assembledAt, text: 'Собран — ' + esc(w.assembledBy || '') });
    if (w.issuedAt) {
      var it = 'Выдан — ' + esc(w.issuedBy || '');
      // Старые записи (когда залог фиксировал склад) показываем как есть
      if (w.issue && Number(w.issue.deposit) > 0) it += ', залог ' + fN(w.issue.deposit) + ' ₽ (' + (WH_METHODS[w.issue.method] || '') + ')';
      hist.push({ at: w.issuedAt, text: it });
    }
    if (w.returnedAt) {
      var rt = 'Возврат принят — ' + esc(w.returnedBy || '');
      if (w.ret) {
        if ((w.ret.missing || []).length) rt += '. Недостача: ' + esc(w.ret.missing.join(', '));
        if (w.ret.damage) rt += '. Повреждения: ' + esc(w.ret.damage);
        if (Number(w.ret.compensation) > 0) rt += '. Компенсация ' + fN(w.ret.compensation) + ' ₽' + (w.ret.compensationNote ? ' (' + esc(w.ret.compensationNote) + ')' : '');
      }
      hist.push({ at: w.returnedAt, text: rt });
    }
    if (w.resolvedAt) hist.push({ at: w.resolvedAt, text: 'Вопрос по залогу/компенсации закрыт — ' + esc(w.resolvedBy || '') });
    $('whCardTimeline').innerHTML = hist.filter(function (h) { return h.at; }).map(function (h) {
      return '<div><span class="mono">' + fmtDT(h.at) + '</span> ' + h.text + '</div>';
    }).join('') || '<div class="wh-empty">Событий пока нет</div>';

    // Комментарии
    $('whCardNotes').innerHTML = w.notes.map(function (n) {
      return '<div class="wh-note"><div class="wh-note-head"><strong>' + esc(n.user || '') + '</strong><span>' + fmtDT(n.at) + '</span></div>' + esc(n.text) + '</div>';
    }).join('') || '<div class="wh-empty">Комментариев нет</div>';
    $('whNoteForm').style.display = edit ? '' : 'none';
    if (!keepScroll) $('whNoteInput').value = '';

    // Кнопки действий по состоянию
    var reopenBtn = function (target, lbl) {
      return '<button class="btn btn-sm btn-secondary" onclick="whReopen(\'' + esc(o.id) + '\',\'' + target + '\')">' + lbl + '</button>';
    };
    var acts = [];
    if (edit) {
      if (w.state === 'todo') acts.push(btn('whMarkAssembled', o.id, 'Собрано ✓'));
      if (w.state === 'assembled') { acts.push(btn('whMarkIssued', o.id, 'Выдать →')); acts.push(reopenBtn('todo', '↩ В сборку')); }
      if (w.state === 'issued') { acts.push(btn('whOpenReturn', o.id, 'Принять возврат')); acts.push(reopenBtn('assembled', '↩ Не выдан')); }
      if (w.state === 'returned') acts.push(reopenBtn('issued', '↩ Отменить возврат'));
    }
    if (w.state === 'returned' && needsResolution(o, w) && typeof radarCanEdit === 'function' && radarCanEdit('orders')) {
      acts.push(btn('whResolve', o.id, 'Вопрос закрыт ✓'));
    }
    acts.push(btnSec('whPrintAct', o.id, 'Акт PDF'));
    $('whCardActions').innerHTML = acts.join('');

    $('whNoteInput').dataset.orderId = o.id;
    openModal('whCardModal');
  };

  window.whAddNote = function () {
    if (!guardEdit()) return;
    var id = $('whNoteInput').dataset.orderId;
    var text = $('whNoteInput').value.trim();
    if (!id || !text) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var notes = w.notes.concat([{ at: nowIso(), user: whUser(), text: text }]);
    whSave(Object.assign({}, o, { wh: Object.assign({}, w, { notes: notes }) }), o,
      'Склад: комментарий — ' + text);
    $('whNoteInput').value = '';
    whOpenCard(id, true);
  };

  // ── Акт: тот же PDF, что печатают менеджеры ────────────────────────────────

  window.whPrintAct = function (id) {
    var o = findOrder(id); if (!o) return;
    try {
      if (!window.RadarDocs || !RadarDocs.ready()) { showToast('Генератор PDF ещё не загрузился — обновите страницу', 'error'); return; }
      var order = RadarStore.normalizeOrder(Object.assign({}, o));
      var calc = RadarPricing.calcEstimate(order, pricingCfg(), false);
      RadarDocs.download('act', order, calc);
      showToast('Акт сформирован', 'success');
    } catch (e) { showToast('Ошибка акта: ' + (e && e.message || e), 'error'); }
  };

  // ── Загрузка страницы ──────────────────────────────────────────────────────

  window.whRefresh = async function () {
    var b = $('whRefreshBtn');
    if (b) { b.disabled = true; b.textContent = 'Обновляем…'; }
    try {
      var r = await api('getOrders');
      if (r && r.success && typeof crmNormalize === 'function') crmOrders = (r.orders || []).map(crmNormalize);
      whRender();
    } finally { if (b) { b.disabled = false; b.textContent = 'Обновить'; } }
  };

  var whOpened = false;
  window.whOpen = async function () {
    whRender();                              // мгновенно из кэша
    if (!crmReady() && typeof crmInit === 'function') {
      try { await crmInit(); } catch (e) { }
      whRender();
    } else if (!whOpened) {
      whRefresh();
    }
    whOpened = true;
    // Предупреждение, если миграция security-5 ещё не применена
    if (RadarStore.hasOrdersColumn) RadarStore.hasOrdersColumn('wh').then(function (ok) {
      var el = $('whMigrationWarn');
      if (el) el.style.display = ok === false ? '' : 'none';
    });
  };

  // Открытие по навигации — оборачиваем switchPage поверх обёртки crm.js
  var prevSwitch = window.switchPage;
  window.switchPage = function (p) {
    prevSwitch(p);
    if (p === 'warehouse') whOpen();
  };
})();
