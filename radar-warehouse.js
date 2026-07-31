/**
 * Radar NR — «Выдача заказов»: доска склада (Сборка → Собрано → Выдан → Вернули).
 *
 * Для кого: сотрудник склада с допуском «assembly». Он видит ЧТО собрать, КОГДА
 * и КУДА везти (тип получения и адрес доставки берутся из карточки заказа —
 * второй копии адреса в системе нет). Суммы заказа ему по-прежнему не нужны.
 *
 * Как устроено:
 *  - Источник данных — те же crmOrders (единая правда с CRM). Складское состояние
 *    лежит в order.wh (см. sql/security-5-warehouse.sql).
 *  - Колонку карточки всегда считает ОДНА функция colOf(): она смотрит и на
 *    складское состояние, и на статус заказа из CRM. Поэтому доска и список
 *    заказов не могут разойтись: сдвинул склад — поменялся статус, поменял
 *    статус менеджер — переехала карточка.
 *  - Все правки идут через RadarStore (outbox): переживают офлайн и перезагрузку.
 *    Для складского допуска запись уходит как UPDATE (см. saveOrder.updateOnly) —
 *    RLS не разрешает ему INSERT, а серверный триггер пропускает только складские поля.
 *  - Переходы: кнопками на карточке (телефон) и перетаскиванием (компьютер).
 *  - Порча, недостача и компенсация — это ЗАПИСЬ ФАКТА, а не операция со складом:
 *    остатки не трогаются, решение (списать, удержать залог, выставить счёт)
 *    принимает менеджер.
 */
(function () {
  'use strict';

  // «Подтверждён» тоже пускает заказ в сборку: клиент подтвердил, деньги придут
  // при выдаче — собирать надо заранее, иначе склад узнаёт о заказе в день выдачи.
  var WH_PAY_OK = { confirmed: 1, prepaid: 1, paid: 1, paid_cash: 1 };
  var WH_PAY_LABEL = { confirmed: 'Подтверждён', prepaid: 'Предоплата', paid: 'Оплачен', paid_cash: 'Наличные' };
  var WH_METHODS = { cash: 'Наличные', transfer: 'Перевод', card: 'Карта', none: 'Без залога' };
  var ASSEMBLY_HORIZON = 3;      // за сколько дней до выдачи заказ падает в «Сборку»

  // Деньгами занимается менеджер: склад лишь фиксирует факт (компенсация, недостача),
  // после чего карточка ждёт менеджера в колонке «Возврат залога / Компенсация» и
  // уходит в «Заказ завершён», когда вопрос закрыт (или сразу, если вопросов нет).
  var COLS = [
    { key: 'upcoming',   title: 'Ожидают' },
    { key: 'todo',       title: 'Сборка' },
    { key: 'assembled',  title: 'Собрано' },
    { key: 'issued',     title: 'Выдан' },
    { key: 'resolution', title: 'Залог / Компенсация' },
    { key: 'done',       title: 'Заказ завершён' }
  ];

  // Складское состояние ↔ статус работы в CRM. Одна таблица на оба направления,
  // чтобы «выдан» на доске и «В работе» в списке всегда означали одно и то же.
  var WH_TO_STATUS = { assembled: 'assembly', issued: 'in_progress', returned: 'completed' };

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

  // ── Месяц, который смотрим ─────────────────────────────────────────────────
  // Доска — не только «что сегодня»: по любому прошедшему месяцу должна быть
  // видна вся история, включая отменённые и завершённые заказы.

  var MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                     'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  function monthKeyOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function monthLabel(key) {
    var p = key.split('-');
    return MONTH_NAMES[Number(p[1]) - 1] + ' ' + p[0];
  }
  function currentMonthKey() { return monthKeyOf(new Date()); }

  var whMonth = null;   // null до первой отрисовки — тогда берём текущий месяц
  var whSearch = '';
  function selectedMonth() { return whMonth || currentMonthKey(); }

  /** Все месяцы, по которым есть заказы, плюс текущий — для выпадающего списка. */
  function availableMonths() {
    var set = {};
    set[currentMonthKey()] = 1;
    orders().forEach(function (o) {
      var d = parseDay(o.startDate);
      if (d) set[monthKeyOf(d)] = 1;
    });
    return Object.keys(set).sort();
  }

  function isFinished(o, w) { return w.state === 'returned' || o.status === 'completed'; }

  /**
   * Попадает ли заказ в выбранный месяц.
   *
   * Прошедшие месяцы — это архив: строго свой месяц, ничего не подмешиваем.
   * Текущий месяц — рабочая доска, а не календарь, поэтому к нему добавляются
   * незакрытые заказы с обеих сторон стыка месяцев: невыданный заказ прошлого
   * месяца (иначе просрочка исчезает с доски) и заказ на 1-е число, который
   * пора собирать уже 30-го (иначе 30-го числа склад его просто не увидит).
   */
  function inMonth(o, month) {
    var d = parseDay(o.startDate);
    if (!d) return false;
    var key = monthKeyOf(d);
    if (key === month) return true;
    if (month !== currentMonthKey()) return false;
    if (isFinished(o, whGet(o))) return false;
    return key < month || autoAssembly(o);
  }

  /** Заказ уже пора собирать: оплата подходит и до выдачи не больше 3 дней. */
  function autoAssembly(o) {
    if (!WH_PAY_OK[o.paymentStatus]) return false;
    var d = parseDay(o.startDate);
    if (!d) return false;
    var horizon = day0(new Date());
    horizon.setDate(horizon.getDate() + ASSEMBLY_HORIZON);
    return d <= horizon;
  }

  /**
   * ЕДИНСТВЕННОЕ место, где решается колонка карточки.
   * Складское состояние главнее: свои шаги склад отмечает сам. Статус заказа из
   * CRM подхватывается там, где склад ещё не дошёл, — менеджер мог закрыть заказ
   * или отметить выдачу вручную. Благодаря одной функции доска и список заказов
   * не расходятся ни в одну сторону.
   */
  function colOf(o, w) {
    if (w.state === 'returned') return needsResolution(o, w) ? 'resolution' : 'done';
    if (o.status === 'completed') return 'done';
    if (w.state === 'issued') return 'issued';
    if (w.state === 'assembled') return 'assembled';
    if (o.status === 'in_progress') return 'issued';
    if (o.status === 'assembly') return 'todo';
    return autoAssembly(o) ? 'todo' : 'upcoming';
  }

  /** Раскладка заказов по колонкам за выбранный месяц. */
  function buildColumns() {
    var month = selectedMonth();
    var q = whSearch.trim().toLowerCase();
    var out = { upcoming: [], todo: [], assembled: [], issued: [], resolution: [], done: [] };

    orders().forEach(function (o) {
      if (!inMonth(o, month)) return;
      if (q && (String(o.orderNumber || '') + ' ' + String(o.clientName || '')).toLowerCase().indexOf(q) < 0) return;
      out[colOf(o, whGet(o))].push(o);
    });

    // Даты разбираем один раз: внутри компаратора это делалось бы O(n log n) раз
    var dayCache = {};
    var at = function (o, field) {
      var k = o.id + '|' + field;
      if (!(k in dayCache)) { var d = parseDay(o[field]); dayCache[k] = d ? d.getTime() : 0; }
      return dayCache[k];
    };
    var byStart = function (a, b) { return at(a, 'startDate') - at(b, 'startDate'); };
    out.upcoming.sort(byStart);
    out.todo.sort(byStart);
    out.assembled.sort(byStart);
    out.issued.sort(function (a, b) { return at(a, 'endDate') - at(b, 'endDate'); });
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
    var cls = (o.paymentStatus === 'prepaid' || o.paymentStatus === 'confirmed') ? 'wh-b-amber' : 'wh-b-green';
    var lbl = WH_PAY_LABEL[o.paymentStatus];
    return lbl ? '<span class="wh-badge ' + cls + '">' + lbl + '</span>' : '';
  }

  /** Куда везти. Адрес живёт в карточке заказа — здесь только показываем его. */
  function deliveryOf(o) {
    if (o.deliveryType === 'pickup') return { label: 'Самовывоз', address: '' };
    var parts = [];
    if (o.deliveryAddress) parts.push(o.deliveryAddress);
    if (o.deliveryZone === 'outside') parts.push('за город' + (o.deliveryKm ? ' ' + o.deliveryKm + ' км' : ''));
    if (o.carryFloor === 'yes') parts.push('нужен пронос');
    return { label: 'Доставка', address: parts.join(', ') };
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
    renderMonthPicker();
    var cols = buildColumns();
    // На телефоне колонки листаются свайпом, поэтому сверху — короткие
    // переключатели: шесть столбцов пролистывать вслепую неудобно.
    var tabs = $('whTabs');
    if (tabs) {
      var activeTab = document.querySelector('[data-wh-tab].active');
      var active = activeTab ? activeTab.dataset.whTab : 'todo';
      tabs.innerHTML = COLS.map(function (c) {
        var cnt = cols[c.key].length;
        return '<button class="wh-tab' + (c.key === active ? ' active' : '') + '" data-wh-tab="' + c.key + '" onclick="whGoCol(\'' + c.key + '\')">' +
          shortTitle(c) + (cnt ? '<i>' + cnt + '</i>' : '') + '</button>';
      }).join('');
    }
    board.innerHTML = COLS.map(function (c) {
      var list = cols[c.key];
      return '<div class="wh-col" data-wh-col="' + c.key + '">' +
        '<div class="wh-col-head"><span>' + c.title + '</span><span class="wh-count">' + list.length + '</span></div>' +
        (list.length ? list.map(function (o) { return cardHtml(o, c.key); }).join('') :
          '<div class="wh-empty">' + emptyText(c.key) + '</div>') +
        '</div>';
    }).join('');
    bindDnD();
    watchScroll();
  }

  function renderMonthPicker() {
    var sel = $('whMonth');
    if (!sel) return;
    var month = selectedMonth();
    var months = availableMonths();
    if (months.indexOf(month) < 0) months.push(month);
    sel.innerHTML = months.sort().map(function (k) {
      return '<option value="' + k + '"' + (k === month ? ' selected' : '') + '>' + monthLabel(k) + '</option>';
    }).join('');
  }

  window.whSetMonth = function (key) { whMonth = key || currentMonthKey(); whRender(); };

  var whSearchTimer = null;
  window.whSetSearch = function (value) {
    clearTimeout(whSearchTimer);
    whSearchTimer = setTimeout(function () { whSearch = String(value || ''); whRender(); }, 200);
  };

  function shortTitle(c) {
    return { upcoming: 'Ожидают', resolution: 'Залог', done: 'Завершён' }[c.key] || c.title;
  }

  window.whGoCol = function (key) {
    var board = $('whBoard');
    var col = document.querySelector('[data-wh-col="' + key + '"]');
    if (board && col) {
      // scrollIntoView здесь бесполезен: scroll-snap возвращает доску назад.
      // Считаем целевое смещение сами и прокручиваем контейнер.
      var target = board.scrollLeft + (col.getBoundingClientRect().left - board.getBoundingClientRect().left);
      try { board.scrollTo({ left: target, behavior: 'smooth' }); } catch (e) { }
      // Плавную прокрутку иногда отменяет scroll-snap — добиваем напрямую
      setTimeout(function () {
        if (Math.abs(board.scrollLeft - target) > 8) board.scrollLeft = target;
      }, 320);
    }
    markTab(key);
  };
  function markTab(key) {
    document.querySelectorAll('[data-wh-tab]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.whTab === key);
    });
  }
  /** Подсветка активной вкладки при свайпе доски. */
  function watchScroll() {
    var board = $('whBoard');
    if (!board || board.dataset.scrollBound) return;
    board.dataset.scrollBound = '1';
    var t = null;
    board.addEventListener('scroll', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        var best = null, bestDist = Infinity;
        document.querySelectorAll('[data-wh-col]').forEach(function (col) {
          var d = Math.abs(col.getBoundingClientRect().left - board.getBoundingClientRect().left);
          if (d < bestDist) { bestDist = d; best = col.dataset.whCol; }
        });
        if (best) markTab(best);
      }, 90);
    }, { passive: true });
  }

  function emptyText(key) {
    return { upcoming: 'Заказов на этот месяц больше нет',
             todo: 'Нечего собирать — подтверждённых заказов на ближайшие ' + ASSEMBLY_HORIZON + ' дня нет',
             assembled: 'Собранных заказов нет', issued: 'На руках у клиентов ничего нет',
             resolution: 'Открытых вопросов по залогам и компенсациям нет',
             done: 'Завершённых заказов за этот месяц нет' }[key] || 'Пусто';
  }

  function cardHtml(o, colKey) {
    var w = whGet(o);
    var p = checklistProgress(o, w);
    var items = (o.items || []);
    var shown = items.slice(0, 3);
    var more = items.length - shown.length;
    var dl = deliveryOf(o);
    var edit = canEdit();

    var actions = '';
    if (edit) {
      if (colKey === 'todo') actions = btn('whMarkAssembled', o.id, 'Собрано ✓');
      else if (colKey === 'assembled') actions = btn('whMarkIssued', o.id, 'Выдать →') + btnSec('whPrintAct', o.id, 'Акт');
      else if (colKey === 'issued') actions = btn('whOpenReturn', o.id, 'Принять возврат ←') + btnSec('whPrintAct', o.id, 'Акт');
      else if (colKey === 'upcoming') actions = btnSec('whStartAssembly', o.id, 'Начать сборку →');
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
    if (w.ret && (w.ret.damaged || []).length && colKey !== 'done') {
      flags.push('<span class="wh-badge wh-b-amber">повреждения</span>');
    }
    if (noteCount) flags.push('<span class="wh-badge wh-b-grey">💬 ' + noteCount + '</span>');

    return '<div class="wh-card" draggable="' + (edit ? 'true' : 'false') + '" data-wh-card="' + esc(o.id) + '" onclick="whOpenCard(\'' + esc(o.id) + '\')">' +
      '<div class="wh-card-top"><span class="wh-num">' + esc(o.orderNumber || o.id) + '</span><span class="wh-deliv">' + dl.label + '</span></div>' +
      (dl.address ? '<div class="wh-addr" title="' + esc(dl.address) + '">📍 ' + esc(dl.address) + '</div>' : '') +
      '<div class="wh-badges">' + dueBadge(o, w) + payBadge(o) + flags.join('') + '</div>' +
      '<div class="wh-items">' + shown.map(function (i) {
        return '<div>• ' + esc(itemName(i)) + ' ×' + esc(i.qty) + '</div>';
      }).join('') + (more > 0 ? '<div class="wh-more">ещё ' + more + ' поз.</div>' : '') + '</div>' +
      (colKey === 'todo' && p.total ? '<div class="wh-progress-row" data-wh-progress="' + esc(o.id) + '"><div class="wh-progress"><i style="width:' + p.pct + '%"></i></div><span>' + p.done + '/' + p.total + '</span></div>' : '') +
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
    var from = colOf(o, whGet(o));
    if (from === target) return;
    var route = from + '>' + target;
    if (route === 'upcoming>todo') return whStartAssembly(id);
    if (route === 'todo>assembled') return whMarkAssembled(id);
    if (route === 'assembled>issued') return whMarkIssued(id);
    if (route === 'issued>resolution' || route === 'issued>done') return whOpenReturn(id);
    if (route === 'resolution>done') return whResolve(id);
    if (route === 'assembled>todo' || route === 'todo>upcoming') return whReopen(id, 'todo');
    if (route === 'issued>assembled') return whReopen(id, 'assembled');
    if (route === 'resolution>issued' || route === 'done>issued') return whReopen(id, 'issued');
    showToast('Так перенести нельзя: только в соседний столбец', 'error');
  }

  // ── Сохранение ─────────────────────────────────────────────────────────────

  /**
   * Единая точка записи. label попадает в журнал заказа (виден менеджерам
   * в истории изменений), синхронизирует crmOrders и обе страницы.
   *
   * opts.quiet — не перерисовывать доску и список заказов целиком. Нужен для
   * галочек чек-листа: там меняется один процент прогресса, а полная
   * перерисовка на каждый клик подтормаживает и сбрасывает фокус.
   */
  function whSave(next, prev, label, opts) {
    opts = opts || {};
    var entries = label ? [{ at: nowIso(), user: whUser(), field: '_wh', label: label, from: null, to: null }] : [];
    var res = RadarStore.saveOrder(next, {
      previous: prev,
      user: whUser(),
      updateOnly: !(typeof radarCanEdit === 'function' && radarCanEdit('orders')),
      extraLog: entries
    });
    // Раньше провал локальной записи проходил молча: интерфейс показывал успех,
    // а изменение не доезжало ни до очереди, ни до сервера.
    if (!res.queued) {
      showToast('Не удалось сохранить — освободите место в браузере и повторите', 'error');
      return null;
    }
    var list = orders();
    var ix = list.findIndex(function (x) { return x.id === res.id; });
    if (ix >= 0) list[ix] = res.order;
    if (!opts.quiet) {
      whRender();
      try { if (crmReady() && typeof crmRenderOrders === 'function') crmRenderOrders(); } catch (e) { }
    }
    RadarStore.flush({ force: true });
    return res.order;
  }

  function guardEdit() {
    if (canEdit()) return true;
    showToast('Нет допуска на выдачу заказов', 'error');
    return false;
  }

  // ── Переходы ───────────────────────────────────────────────────────────────

  /** Узел по значению атрибута — id заказа может содержать что угодно. */
  function nodeBy(attr, value) {
    var list = document.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < list.length; i++) if (list[i].getAttribute(attr) === value) return list[i];
    return null;
  }

  /** Точечная отрисовка прогресса сборки — вместо перерисовки доски и модалки. */
  function paintProgress(o) {
    var p = checklistProgress(o, whGet(o));
    var row = nodeBy('data-wh-progress', o.id);
    if (row) {
      var bar = row.querySelector('.wh-progress i');
      if (bar) bar.style.width = p.pct + '%';
      var lbl = row.querySelector('span');
      if (lbl) lbl.textContent = p.done + '/' + p.total;
    }
    var cnt = $('whCardProgress');
    if (cnt) cnt.textContent = p.total ? 'Отмечено ' + p.done + ' из ' + p.total : '';
  }

  window.whToggleCheck = function (id, idx, checked) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var ch = Object.assign({}, w.checklist);
    if (checked) ch[String(idx)] = true; else delete ch[String(idx)];
    var saved = whSave(Object.assign({}, o, { wh: Object.assign({}, w, { checklist: ch }) }), o, null, { quiet: true });
    if (saved) paintProgress(saved);
  };

  /** «Отметить всё» — на больших заказах это десятки кликов вместо одного. */
  window.whCheckAll = function (id) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var ch = {};
    (o.items || []).forEach(function (_, i) { ch[String(i)] = true; });
    var saved = whSave(Object.assign({}, o, { wh: Object.assign({}, w, { checklist: ch }) }), o, null, { quiet: true });
    if (!saved) return;
    document.querySelectorAll('#whCardItems input[type=checkbox]').forEach(function (c) { c.checked = true; });
    paintProgress(saved);
  };

  /** Забрать заказ в сборку раньше срока — иногда так удобнее складу. */
  window.whStartAssembly = function (id) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    whSave(Object.assign({}, o, { status: 'assembly' }, {
      wh: Object.assign({}, w, { state: 'todo', prevStatus: o.status })
    }), o, 'Склад: заказ взят в сборку');
    closeModal('whCardModal', true);
  };

  window.whMarkAssembled = function (id) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var p = checklistProgress(o, w);
    if (p.total && p.done < p.total &&
        !confirm('Отмечено ' + p.done + ' из ' + p.total + ' позиций. Перенести в «Собрано» всё равно?')) return;
    whSave(Object.assign({}, o, { status: WH_TO_STATUS.assembled }, {
      wh: Object.assign({}, w, {
        state: 'assembled', assembledAt: nowIso(), assembledBy: whUser(),
        prevStatus: w.prevStatus || o.status
      })
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
    var patchTop = { status: WH_TO_STATUS[target] || w.prevStatus || 'preparing' };
    var nw = Object.assign({}, w, { state: target });
    if (w.state === 'issued' && target === 'assembled') {
      nw.issuedAt = null; nw.issuedBy = null;
    }
    if (w.state === 'returned' && target === 'issued') {
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
    whSave(Object.assign({}, o, { status: WH_TO_STATUS.issued }, {
      wh: Object.assign({}, w, {
        state: 'issued', issuedAt: nowIso(), issuedBy: whUser(),
        prevStatus: w.prevStatus || o.status
      })
    }), o, 'Склад: заказ выдан');
    closeModal('whCardModal', true);
    showToast('Заказ выдан', 'success');
  };

  // ── Возврат (модалка с чек-листом, компенсацией и залогом) ─────────────────

  // Кладовщик фиксирует ФАКТ по каждой позиции. Остатки склада при этом не
  // меняются: списать бой, удержать залог или выставить счёт решает менеджер.
  var RET_OUTCOMES = [
    { key: 'ok',      label: 'Вернули' },
    { key: 'damaged', label: 'Повреждено' },
    { key: 'missing', label: 'Не вернули' }
  ];

  window.whOpenReturn = function (id) {
    if (!guardEdit()) return;
    var o = findOrder(id); if (!o) return;
    $('whReturnOrderId').value = id;
    $('whReturnTitle').textContent = 'Возврат ' + (o.orderNumber || '');
    $('whReturnChecklist').innerHTML = (o.items || []).map(function (i, ix) {
      return '<div class="wh-ret-row"><span>' + esc(itemName(i)) + ' ×' + esc(i.qty) + '</span>' +
        '<select data-wh-ret="' + ix + '">' + RET_OUTCOMES.map(function (r) {
          return '<option value="' + r.key + '">' + r.label + '</option>';
        }).join('') + '</select></div>';
    }).join('') || '<div class="wh-empty">Состав заказа пуст</div>';
    $('whReturnDamage').value = '';
    $('whReturnComp').value = '';
    $('whReturnCompNote').value = '';
    openModal('whReturnModal');
  };

  window.whReturnCheckAll = function () {
    document.querySelectorAll('#whReturnChecklist select[data-wh-ret]').forEach(function (s) { s.value = 'ok'; });
  };

  window.whConfirmReturn = function () {
    var id = $('whReturnOrderId').value;
    var o = findOrder(id); if (!o) return;
    var w = whGet(o);
    var missing = [], damaged = [], retCheck = {}, outcomes = {};
    document.querySelectorAll('#whReturnChecklist select[data-wh-ret]').forEach(function (s) {
      var ix = Number(s.dataset.whRet);
      var item = o.items && o.items[ix];
      var title = item ? itemName(item) + ' ×' + item.qty : '№' + (ix + 1);
      outcomes[String(ix)] = s.value;
      if (s.value === 'ok') retCheck[String(ix)] = true;
      else if (s.value === 'damaged') damaged.push(title);
      else missing.push(title);
    });
    var problems = [];
    if (missing.length) problems.push('не вернули: ' + missing.join(', '));
    if (damaged.length) problems.push('повреждено: ' + damaged.join(', '));
    if (problems.length && !confirm(problems.join('\n') + '.\nПринять возврат?')) return;

    var damage = $('whReturnDamage').value.trim();
    var comp = Math.max(0, Number($('whReturnComp').value) || 0);
    var compNote = $('whReturnCompNote').value.trim();
    if (comp > 0 && !compNote && !damage && !problems.length &&
        !confirm('Компенсация ' + fN(comp) + ' ₽ без описания причины. Продолжить?')) return;

    // Статус залога склад не трогает: вернуть или удержать решает менеджер.
    // Карточка с компенсацией или невозвращённым залогом сама встанет в колонку
    // «Залог / Компенсация» и уйдёт в «Заказ завершён», когда менеджер закроет вопрос.
    var patchTop = { status: WH_TO_STATUS.returned };
    if (comp > 0) {
      patchTop.compensationAmount = comp;
      patchTop.compensationNote = compNote || damage || problems.join('; ') || 'Зафиксировано складом при возврате';
    }

    var parts = ['Склад: возврат принят'];
    if (problems.length) parts.push(problems.join('; '));
    if (damage) parts.push('описание: ' + damage);
    if (comp > 0) parts.push('компенсация ' + fN(comp) + ' ₽' + (compNote ? ' (' + compNote + ')' : ''));

    whSave(Object.assign({}, o, patchTop, {
      wh: Object.assign({}, w, {
        state: 'returned', returnedAt: nowIso(), returnedBy: whUser(),
        ret: { checklist: retCheck, outcomes: outcomes, missing: missing, damaged: damaged,
               damage: damage, compensation: comp, compensationNote: compNote }
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
    var col = colOf(o, w);
    var colTitle = COLS.filter(function (c) { return c.key === col; })[0];
    $('whCardTitle').textContent = (o.orderNumber || o.id) + ' — ' + (colTitle ? colTitle.title : '');

    var dl = deliveryOf(o);
    $('whCardMeta').innerHTML =
      '<div class="wh-meta-line"><span>Выдача</span><strong>' + fmtDate(o.startDate) + '</strong></div>' +
      '<div class="wh-meta-line"><span>Возврат</span><strong>' + fmtDate(o.endDate) + '</strong></div>' +
      '<div class="wh-meta-line"><span>Получение</span><strong>' + dl.label + '</strong></div>' +
      (dl.address ? '<div class="wh-meta-line"><span>Адрес</span><strong>' + esc(dl.address) + '</strong></div>' : '') +
      '<div class="wh-badges" style="margin:4px 0 0">' + dueBadge(o, w) + payBadge(o) + '</div>';

    // Чек-лист сборки: интерактивен только в «Сборке»
    var interactive = edit && col === 'todo';
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
    $('whCheckAllBtn').style.display = interactive && (o.items || []).length ? '' : 'none';
    $('whCheckAllBtn').setAttribute('onclick', 'whCheckAll(\'' + esc(o.id) + '\')');
    paintProgress(o);

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
        if ((w.ret.missing || []).length) rt += '. Не вернули: ' + esc(w.ret.missing.join(', '));
        if ((w.ret.damaged || []).length) rt += '. Повреждено: ' + esc(w.ret.damaged.join(', '));
        if (w.ret.damage) rt += '. Описание: ' + esc(w.ret.damage);
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
      if (col === 'upcoming') acts.push(btn('whStartAssembly', o.id, 'Начать сборку →'));
      if (col === 'todo') acts.push(btn('whMarkAssembled', o.id, 'Собрано ✓'));
      if (col === 'assembled') { acts.push(btn('whMarkIssued', o.id, 'Выдать →')); acts.push(reopenBtn('todo', '↩ В сборку')); }
      if (col === 'issued') { acts.push(btn('whOpenReturn', o.id, 'Принять возврат')); acts.push(reopenBtn('assembled', '↩ Не выдан')); }
      if (w.state === 'returned') acts.push(reopenBtn('issued', '↩ Отменить возврат'));
    }
    if (col === 'resolution' && typeof radarCanEdit === 'function' && radarCanEdit('orders')) {
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

  // Правила доски (колонка, автосборка, месяц, адрес) не зависят от DOM —
  // отдаём их наружу, чтобы tests.html проверял логику напрямую, без кликов.
  window.RadarWarehouse = {
    colOf: colOf, whGet: whGet, autoAssembly: autoAssembly, inMonth: inMonth,
    deliveryOf: deliveryOf, monthKeyOf: monthKeyOf, needsResolution: needsResolution,
    checklistProgress: checklistProgress, WH_TO_STATUS: WH_TO_STATUS
  };

  // Открытие по навигации — оборачиваем switchPage поверх обёртки crm.js
  var prevSwitch = window.switchPage;
  window.switchPage = function (p) {
    prevSwitch(p);
    if (p === 'warehouse') whOpen();
  };
})();
