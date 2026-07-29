/**
 * Radar NR — центр уведомлений (клиентская часть).
 *
 * Движок живёт в Postgres (sql/notifications-1-system.sql): триггеры ловят
 * мгновенные события, pg_cron гоняет правила и дайджесты. Здесь — только
 * окно в этот движок:
 *   • колокольчик с числом непрочитанных (поллинг раз в 90 секунд);
 *   • лента уведомлений с переходом к заказу;
 *   • сотруднику — один переключатель Push на это устройство;
 *   • администратору — выбор типов и экран «Система» (ключи, здоровье cron).
 *
 * Каналы Telegram и Email движок поддерживает, но интерфейс их не показывает
 * (см. sql/notifications-3-simplify.sql): на практике ими не пользуются.
 *
 * Если SQL-миграция ещё не применена, панель честно говорит об этом
 * и поллинг отключается — приложение работает как раньше.
 */
(function () {
  'use strict';

  var POLL_MS = 90000;
  var state = {
    unread: 0, items: [], migrated: null, tab: 'feed',
    prefs: null, admin: null, timer: null, pendingLink: null
  };

  function $(id) { return document.getElementById(id); }
  function me() { return window.currentUser || null; }
  function rpc(fn, args) { return window.RadarStore.notifRpc(fn, args); }

  // ── Web Push: сервис-воркер и утилиты ──────────────────────────────────────

  function b64url(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToU8(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function isIphoneBrowserTab() {
    // iOS поддерживает Web Push только у приложения, установленного на экран «Домой»
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    var standalone = navigator.standalone === true ||
      (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    return ios && !standalone;
  }
  async function pushState() {
    if (!pushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      var sub = reg && await reg.pushManager.getSubscription();
      return sub ? 'on' : 'off';
    } catch (e) { return 'off'; }
  }

  // Переход по ссылке уведомления (из ленты, из пуша, из ?nl=)
  function navLink(link) {
    if (!link) return;
    try {
      if (link.indexOf('page:') === 0) { switchPage(link.slice(5)); return; }
      if (link.indexOf('order:') === 0) {
        var oid = link.slice(6);
        if (typeof radarCanView === 'function' && radarCanView('orders')) {
          switchPage('crm');
          setTimeout(function () { try { if (typeof crmOpenDialog === 'function') crmOpenDialog(oid); } catch (e) { } }, 400);
        } else if (typeof radarCanView === 'function' && radarCanView('assembly')) {
          switchPage('warehouse');
          setTimeout(function () { try { if (typeof whOpenCard === 'function') whOpenCard(oid); } catch (e) { } }, 400);
        }
      }
    } catch (e) { }
  }
  function navOrDefer(link) {
    if (me()) navLink(link); else state.pendingLink = link;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.radarNotifLink) navOrDefer(e.data.radarNotifLink);
    });
  }
  // Пуш открыл новое окно: ссылка приезжает параметром ?nl=
  (function () {
    var m = /[?&]nl=([^&]+)/.exec(location.search);
    if (m) {
      state.pendingLink = decodeURIComponent(m[1]);
      try { history.replaceState(null, '', location.pathname); } catch (e) { }
    }
  })();

  var SEV = { info: 'wh-b-blue', warn: 'wh-b-amber', critical: 'wh-b-red' };
  var CAT_LABELS = { finance: 'Финансы', orders: 'Заказы', warehouse: 'Склад', clients: 'Клиенты', team: 'Команда', digest: 'Сводки' };

  // ── Поллинг и бейдж ────────────────────────────────────────────────────────

  async function poll(fetchFull) {
    if (!me()) return;
    if (state.migrated === false) return;
    var r = await rpc('app_notif_feed', { p_limit: fetchFull ? 100 : 1 });
    if (r.error) {
      if (r.missing) { state.migrated = false; renderBadge(); if (panelOpen()) renderFeed(); }
      return;
    }
    state.migrated = true;
    state.unread = r.unread || 0;
    if (fetchFull) state.items = r.items || [];
    renderBadge();
    if (panelOpen() && fetchFull) renderFeed();
  }

  function renderBadge() {
    var b = $('notifBadge');
    if (!b) return;
    b.textContent = state.unread > 99 ? '99+' : String(state.unread);
    b.style.display = state.unread > 0 ? '' : 'none';
  }

  function startPolling() {
    clearInterval(state.timer);
    state.timer = setInterval(function () { poll(false); }, POLL_MS);
    poll(false);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && me()) poll(panelOpen());
  });

  // Колокольчик показываем после входа. showApp вызывается из radar.js —
  // подцепляемся к нему, не меняя чужой код.
  var origShowApp = window.showApp;
  window.showApp = function () {
    origShowApp.apply(this, arguments);
    var bell = $('notifBell');
    if (bell) bell.style.display = '';
    startPolling();
    if (state.pendingLink) {
      var l = state.pendingLink; state.pendingLink = null;
      setTimeout(function () { navLink(l); }, 600);
    }
  };
  var origLogout = window.logout;
  window.logout = function () {
    origLogout.apply(this, arguments);
    var bell = $('notifBell');
    if (bell) bell.style.display = 'none';
    clearInterval(state.timer);
    closePanel();
  };

  // ── Панель ─────────────────────────────────────────────────────────────────

  function panelOpen() { var p = $('notifPanel'); return p && p.classList.contains('open'); }

  window.notifToggle = function () {
    if (panelOpen()) closePanel(); else openPanel();
  };
  function openPanel() {
    $('notifPanel').classList.add('open');
    $('notifBackdrop').classList.add('open');
    // вкладка «Система» — только администратору
    var at = $('notifTab-admin');
    if (at) at.style.display = (typeof radarIsAdmin === 'function' && radarIsAdmin()) ? '' : 'none';
    if (state.tab === 'admin' && !(typeof radarIsAdmin === 'function' && radarIsAdmin())) state.tab = 'feed';
    setTab(state.tab || 'feed');
  }
  function closePanel() {
    var p = $('notifPanel'); if (p) p.classList.remove('open');
    var b = $('notifBackdrop'); if (b) b.classList.remove('open');
  }
  window.notifClose = closePanel;

  window.notifSetTab = setTab;
  function setTab(tab) {
    state.tab = tab;
    ['feed', 'prefs', 'admin'].forEach(function (t) {
      var el = $('notifTab-' + t);
      if (el) el.classList.toggle('active', t === tab);
      var pane = $('notifPane-' + t);
      if (pane) pane.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'feed') poll(true);
    if (tab === 'prefs') loadPrefs();
    if (tab === 'admin') loadAdmin();
  }

  // ── Лента ──────────────────────────────────────────────────────────────────

  function dayLabel(iso) {
    var d = new Date(iso), t = new Date();
    var d0 = d.toDateString(), t0 = t.toDateString();
    t.setDate(t.getDate() - 1);
    if (d0 === t0) return 'Сегодня';
    if (d0 === t.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
  }
  function timeLabel(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function renderFeed() {
    var box = $('notifPane-feed');
    if (!box) return;
    if (state.migrated === false) {
      box.innerHTML = '<div class="notif-empty">Система уведомлений ещё не включена.<br>' +
        'Выполните <b>sql/notifications-1-system.sql</b> в Supabase SQL Editor.</div>';
      return;
    }
    if (!state.items.length) {
      box.innerHTML = '<div class="notif-empty">Уведомлений пока нет</div>';
      return;
    }
    var html = '<div class="notif-feed-actions"><button class="btn btn-sm btn-secondary" onclick="notifMarkAll()">Прочитать всё</button></div>';
    var lastDay = '';
    state.items.forEach(function (n) {
      var day = dayLabel(n.created_at);
      if (day !== lastDay) { html += '<div class="notif-day">' + day + '</div>'; lastDay = day; }
      html += '<div class="notif-item' + (n.read_at ? '' : ' unread') + '" onclick="notifClick(\'' + n.id + '\')">' +
        '<div class="notif-item-head"><span class="wh-badge ' + (SEV[n.severity] || 'wh-b-grey') + '">' +
        (n.severity === 'critical' ? 'важно' : n.severity === 'warn' ? 'внимание' : 'инфо') + '</span>' +
        '<span class="notif-time">' + timeLabel(n.created_at) + '</span></div>' +
        '<div class="notif-title">' + esc(n.title) + '</div>' +
        (n.body ? '<div class="notif-body">' + esc(n.body) + '</div>' : '') +
        '</div>';
    });
    box.innerHTML = html;
  }

  window.notifMarkAll = async function () {
    await rpc('app_notif_mark_read', {});
    state.items.forEach(function (n) { if (!n.read_at) n.read_at = new Date().toISOString(); });
    state.unread = 0; renderBadge(); renderFeed();
  };

  window.notifClick = async function (id) {
    var n = state.items.find(function (x) { return x.id === id; });
    if (!n) return;
    if (!n.read_at) {
      n.read_at = new Date().toISOString();
      state.unread = Math.max(0, state.unread - 1);
      renderBadge(); renderFeed();
      rpc('app_notif_mark_read', { p_ids: [id] });
    }
    if (!n.link) return;
    closePanel();
    navLink(n.link);
  };

  // ── Настройки пользователя ─────────────────────────────────────────────────

  async function loadPrefs() {
    var box = $('notifPane-prefs');
    box.innerHTML = '<div class="notif-empty">Загрузка…</div>';
    var r = await rpc('app_notif_prefs_get');
    if (r.error) {
      box.innerHTML = '<div class="notif-empty">' + (r.missing ? 'Сначала выполните sql/notifications-1-system.sql' : esc(r.error)) + '</div>';
      return;
    }
    state.prefs = r;
    var isAdmin = typeof radarIsAdmin === 'function' && radarIsAdmin();

    // Главный переключатель: пуши на это устройство. Сотруднику этого достаточно —
    // что именно ему приходит, определяют его допуски, а не ручные галочки.
    var ps = await pushState();
    var pinfo = await rpc('app_notif_push_info');
    var html = '<div class="notif-push-card">' +
      '<div class="notif-push-title">Уведомления на это устройство</div>';
    if (ps === 'on') {
      html += '<div class="notif-push-state on">Включены</div>' +
        '<div class="notif-push-descr">Важное придёт на экран, даже когда приложение закрыто.</div>' +
        '<button class="btn btn-sm btn-secondary" onclick="notifPushDisable()">Выключить</button>';
    } else if (ps === 'unsupported' && isIphoneBrowserTab()) {
      html += '<div class="notif-push-state warn">Нужен ярлык на экране «Домой»</div>' +
        '<div class="notif-push-descr">Нажмите «Поделиться» → «На экран „Домой“» и откройте Radar с иконки — тогда уведомления можно включить.</div>';
    } else if (ps === 'unsupported') {
      html += '<div class="notif-push-state off">Браузер не поддерживает</div>' +
        '<div class="notif-push-descr">Откройте Radar в Safari на iPhone или в Chrome — там уведомления работают.</div>';
    } else if (ps === 'denied') {
      html += '<div class="notif-push-state off">Запрещены на устройстве</div>' +
        '<div class="notif-push-descr">Разрешите уведомления для Radar в настройках телефона, затем вернитесь сюда.</div>';
    } else if (pinfo && pinfo.configured === false) {
      html += '<div class="notif-push-state off">Пока не настроены</div>' +
        '<div class="notif-push-descr">Администратор ещё не включил уведомления в системе.</div>';
    } else {
      html += '<div class="notif-push-state off">Выключены</div>' +
        '<div class="notif-push-descr">Включите, чтобы не пропускать срочное: неоплаченные выдачи, нехватку товара, сборку на сегодня.</div>' +
        '<button class="btn btn-sm" onclick="notifPushEnable()">Включить</button>';
    }
    html += '</div>';
    if (pinfo && pinfo.my_devices > 1) {
      html += '<div class="notif-devices">Ваших устройств с уведомлениями: ' + pinfo.my_devices + '</div>';
    }
    html += '<div class="notif-feed-actions"><button class="btn btn-sm btn-secondary" onclick="notifTest()">Проверить</button></div>';

    // Выбор конкретных типов — только администратору. Остальные получают то,
    // что положено их роли: лишние тумблеры на телефоне только мешают.
    if (isAdmin) {
      var byCat = {};
      (r.types || []).forEach(function (t) { (byCat[t.category] = byCat[t.category] || []).push(t); });
      Object.keys(CAT_LABELS).forEach(function (cat) {
        if (!byCat[cat]) return;
        html += '<div class="notif-section">' + CAT_LABELS[cat] + '</div>';
        byCat[cat].forEach(function (t) {
          var pushOn = (t.channels || []).indexOf('webpush') >= 0;
          html += '<div class="notif-type' + (t.global_enabled ? '' : ' notif-type-off') + '">' +
            '<label class="notif-type-main"><input type="checkbox" ' + (t.enabled ? 'checked' : '') +
            ' onchange="notifPrefToggle(\'' + t.key + '\',this.checked)"> <span><b>' + esc(t.title) + '</b>' +
            '<small>' + esc(t.descr) + (t.global_enabled ? '' : ' — выключено в разделе «Система»') + '</small></span></label>' +
            '<span class="notif-type-ch">' +
            '<label title="Присылать пушем на телефон"><input type="checkbox" ' + (pushOn ? 'checked' : '') +
            ' onchange="notifPrefChannel(\'' + t.key + '\',\'webpush\',this.checked)">Push</label>' +
            '</span></div>';
        });
      });
    } else if ((r.types || []).length) {
      html += '<div class="notif-section">Что вам приходит</div><div class="notif-what">' +
        (r.types || []).map(function (t) { return '<div>• ' + esc(t.title) + '</div>'; }).join('') +
        '</div><div class="notif-devices">Список зависит от ваших разделов — его настраивает администратор.</div>';
    }
    box.innerHTML = html;
  }

  function prefType(key) { return (state.prefs.types || []).find(function (t) { return t.key === key; }); }

  window.notifPrefToggle = async function (key, on) {
    var t = prefType(key); if (!t) return;
    t.enabled = on;
    await rpc('app_notif_prefs_set', { p_type: key, p_enabled: on, p_channels: t.channels });
  };
  window.notifPrefChannel = async function (key, channel, on) {
    var t = prefType(key); if (!t) return;
    var ch = (t.channels || []).filter(function (c) { return c !== channel; });
    if (on) ch.push(channel);
    if (ch.indexOf('inapp') < 0) ch.unshift('inapp');
    t.channels = ch;
    await rpc('app_notif_prefs_set', { p_type: key, p_enabled: t.enabled, p_channels: ch });
  };
  window.notifTest = async function () {
    var r = await rpc('app_notif_test');
    if (r.error) { showToast('Ошибка: ' + r.error, 'error'); return; }
    showToast(r.devices > 0
      ? 'Отправлено — уведомление появится в ленте и на устройстве'
      : 'В ленту добавлено. Push не включён на этом устройстве', 'success');
    poll(true);
  };

  window.notifPushEnable = async function () {
    var info = await rpc('app_notif_push_info');
    if (info.error) { showToast('Ошибка: ' + info.error, 'error'); return; }
    if (!info.configured) { showToast('Администратор ещё не создал ключи Push (колокольчик → Система)', 'error'); return; }
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { showToast('Разрешение на уведомления не дано', 'error'); loadPrefs(); return; }
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToU8(info.vapid_public)
      });
      var r = await rpc('app_notif_push_subscribe', { p_sub: sub.toJSON() });
      if (r.error) { showToast('Ошибка: ' + r.error, 'error'); return; }
      showToast('Push включён на этом устройстве', 'success');
    } catch (e) {
      showToast('Не удалось включить Push: ' + (e && e.message || e), 'error');
    }
    loadPrefs();
  };
  window.notifPushDisable = async function () {
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (sub) {
        await rpc('app_notif_push_unsubscribe', { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      showToast('Push выключен на этом устройстве', 'success');
    } catch (e) { }
    loadPrefs();
  };

  // ── Администратор ──────────────────────────────────────────────────────────

  async function loadAdmin() {
    var box = $('notifPane-admin');
    box.innerHTML = '<div class="notif-empty">Загрузка…</div>';
    var r = await rpc('app_notif_admin_get');
    if (r.error) {
      box.innerHTML = '<div class="notif-empty">' + (r.missing ? 'Сначала выполните sql/notifications-1-system.sql' : esc(r.error)) + '</div>';
      return;
    }
    state.admin = r;
    var s = r.settings || {};
    var inp = function (key, label, ph, type) {
      return '<div class="input-group"><label class="input-label">' + label + '</label>' +
        '<input type="' + (type || 'text') + '" data-notif-setting="' + key + '" value="' + esc(s[key] || '') + '" placeholder="' + (ph || '') + '"></div>';
    };
    var html = '<div class="notif-section">Глобальные настройки</div>' +
      '<label class="notif-type-main" style="margin-bottom:8px"><input type="checkbox" id="notifGlobalOn" ' + (s.enabled === 'true' ? 'checked' : '') + '> <span><b>Уведомления включены</b><small>общий выключатель всей системы</small></span></label>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      inp('digest_time', 'Время сводки', '09:00') + inp('timezone', 'Часовой пояс', 'Europe/Moscow') +
      inp('weekly_dow', 'День отчёта (1=Пн)', '1') + inp('clients_period', 'Клиентский дайджест, дней', '3') +
      '</div>' +
      '<div class="notif-section">Push на телефоны</div>' +
      '<div class="notif-contact"><b>VAPID-ключи</b>' +
      ((r.push && r.push.keys_ready)
        ? '<span class="wh-badge wh-b-green">созданы</span>'
        : '<button class="btn btn-sm" onclick="notifPushGenKeys()">Сгенерировать</button>') +
      '</div>' +
      '<div class="notif-contact"><b>Подписанных устройств</b><span>' + ((r.push && r.push.subs_total) || 0) + '</span></div>' +
      inp('push_fn_url', 'Адрес Edge Function', 'https://…/functions/v1/notif-push') +
      '<div class="notif-feed-actions"><button class="btn btn-sm btn-secondary" onclick="notifPushCheck()">Проверить функцию</button></div>' +
      '<div class="notif-hint" style="display:block">Один раз: Supabase → Edge Functions → функция <b>notif-push</b> → вкладка Code → удалите шаблон, вставьте код из <b>supabase/functions/notif-push/index.ts</b> → Deploy; в Settings выключите «Verify JWT».</div>' +
      '<div class="notif-feed-actions">' +
      '<button class="btn btn-sm" onclick="notifAdminSave()">Сохранить</button>' +
      '<button class="btn btn-sm btn-secondary" onclick="notifRunNow()">Запустить проверки сейчас</button>' +
      '</div>' +
      '<div class="notif-section">Типы уведомлений (глобально)</div>';
    (r.types || []).forEach(function (t) {
      html += '<label class="notif-type-main notif-admin-type"><input type="checkbox" data-notif-type="' + t.key + '" ' + (t.enabled ? 'checked' : '') + '> <span><b>' +
        esc(t.title) + '</b><small>' + (CAT_LABELS[t.category] || t.category) + ' · ' +
        ({ instant: 'мгновенно', hourly: 'каждый час', daily: 'ежедневно', every3days: 'раз в 3 дня', weekly: 'еженедельно' }[t.schedule] || t.schedule) +
        '</small></span></label>';
    });
    html += '<div class="notif-section">Последние запуски</div>';
    var runs = r.runs || [];
    html += runs.length ? '<div class="notif-runs">' + runs.map(function (x) {
      return '<div>' + esc(x.type_key) + ' — ' + (x.last_run ? new Date(x.last_run).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—') +
        ', отправлено: ' + x.last_count + (x.last_error ? ' <span style="color:var(--red)">' + esc(x.last_error) + '</span>' : '') + '</div>';
    }).join('') + '</div>' : '<div class="notif-empty">Проверки ещё не запускались</div>';
    var qe = r.queue_errors || [];
    if (qe.length) {
      html += '<div class="notif-section">Ошибки доставки</div><div class="notif-runs">' + qe.map(function (x) {
        return '<div>' + esc(x.channel) + ': ' + esc(x.title) + ' — <span style="color:var(--red)">' + esc(x.error || '') + '</span></div>';
      }).join('') + '</div>';
    }
    var cron = r.cron || [];
    if (cron.length < 2) {
      html += '<div class="notif-hint" style="display:block">⚠ Задания pg_cron не найдены (' + cron.length + '/2) — перезапустите SQL-файл.</div>';
    }
    box.innerHTML = html;
  }

  window.notifAdminSave = async function () {
    var settings = { enabled: $('notifGlobalOn').checked ? 'true' : 'false' };
    document.querySelectorAll('[data-notif-setting]').forEach(function (el) { settings[el.dataset.notifSetting] = el.value.trim(); });
    var types = [];
    document.querySelectorAll('[data-notif-type]').forEach(function (el) { types.push({ key: el.dataset.notifType, enabled: el.checked }); });
    var r = await rpc('app_notif_admin_set', { p_settings: settings, p_types: types });
    showToast(r.error ? 'Ошибка: ' + r.error : 'Настройки уведомлений сохранены', r.error ? 'error' : 'success');
  };
  window.notifRunNow = async function () {
    var r = await rpc('app_notif_run_now');
    showToast(r.error ? 'Ошибка: ' + r.error : 'Готово: ' + (r.result || ''), r.error ? 'error' : 'success');
    loadAdmin(); poll(true);
  };

  window.notifPushGenKeys = async function () {
    if (!confirm('Сгенерировать VAPID-ключи для Push?\n\nЕсли ключи уже существовали, все подписанные устройства придётся подключить заново.')) return;
    try {
      var kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      var raw = await crypto.subtle.exportKey('raw', kp.publicKey);
      var jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
      var r = await rpc('app_notif_push_setkeys', { p_public: b64url(raw), p_private: jwk.d });
      showToast(r.error ? 'Ошибка: ' + r.error : 'Ключи Push созданы', r.error ? 'error' : 'success');
    } catch (e) {
      showToast('Не удалось создать ключи: ' + (e && e.message || e), 'error');
    }
    loadAdmin();
  };

  window.notifPushCheck = async function () {
    var d = await rpc('app_notif_push_diag');
    if (d.error) { showToast('Ошибка: ' + d.error, 'error'); return; }
    if (!d.keys_ready) { showToast('Сначала сгенерируйте VAPID-ключи', 'error'); return; }
    if (!d.url) { showToast('Не указан адрес Edge Function', 'error'); return; }
    try {
      var resp = await fetch(d.url, {
        method: 'POST',
        // apikey требует шлюз Supabase, x-push-secret — наша функция
        headers: {
          'Content-Type': 'application/json',
          'apikey': d.apikey || window.SUPABASE_ANON_KEY || '',
          'x-push-secret': d.secret
        },
        body: '{"drain":true}'
      });
      var j = {};
      try { j = await resp.json(); } catch (e) { }
      if (resp.ok && j.ok) {
        showToast('Функция работает: в очереди ' + (d.queued || 0) + ', обработано ' + (j.processed || 0) + ', отправлено ' + (j.sent || 0), 'success');
      } else if (j.message && /Hello|undefined/.test(j.message)) {
        showToast('В функции всё ещё шаблонный код Supabase — вставьте код notif-push и задеплойте заново', 'error');
      } else {
        showToast('Функция ответила: ' + (j.error || j.message || ('HTTP ' + resp.status)), 'error');
      }
    } catch (e) {
      showToast('Функция недоступна (не задеплоена?): ' + (e && e.message || e), 'error');
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var t = $('notifTab-admin');
    if (t) t.style.display = 'none';
    // Сервис-воркер только показывает пуши — кэшированием не занимается,
    // поэтому регистрируем всегда: обновлениям приложения он не мешает.
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('sw.js').catch(function () { }); } catch (e) { }
    }
    if (me()) { var b = $('notifBell'); if (b) b.style.display = ''; startPolling(); }
  });
})();
