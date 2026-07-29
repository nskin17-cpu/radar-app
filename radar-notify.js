/**
 * Radar NR — центр уведомлений (клиентская часть).
 *
 * Движок живёт в Postgres (sql/notifications-1-system.sql): триггеры ловят
 * мгновенные события, pg_cron гоняет правила и дайджесты, pg_net шлёт
 * Telegram/Email. Здесь — только окно в этот движок:
 *   • колокольчик с числом непрочитанных (поллинг раз в 90 секунд);
 *   • лента уведомлений с переходом к заказу;
 *   • настройки пользователя: какие типы и в какие каналы получать,
 *     привязка Telegram по коду, e-mail;
 *   • экран администратора: глобальные тумблеры, токены, здоровье cron.
 *
 * Если SQL-миграция ещё не применена, панель честно говорит об этом
 * и поллинг отключается — приложение работает как раньше.
 */
(function () {
  'use strict';

  var POLL_MS = 90000;
  var state = {
    unread: 0, items: [], migrated: null, tab: 'feed',
    prefs: null, admin: null, timer: null
  };

  function $(id) { return document.getElementById(id); }
  function me() { return window.currentUser || null; }
  function rpc(fn, args) { return window.RadarStore.notifRpc(fn, args); }

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
    try {
      if (n.link.indexOf('page:') === 0) { switchPage(n.link.slice(5)); return; }
      if (n.link.indexOf('order:') === 0) {
        var oid = n.link.slice(6);
        if (typeof radarCanView === 'function' && radarCanView('orders')) {
          switchPage('crm');
          setTimeout(function () { try { if (typeof crmOpenDialog === 'function') crmOpenDialog(oid); } catch (e) { } }, 400);
        } else if (typeof radarCanView === 'function' && radarCanView('assembly')) {
          switchPage('warehouse');
          setTimeout(function () { try { if (typeof whOpenCard === 'function') whOpenCard(oid); } catch (e) { } }, 400);
        }
      }
    } catch (e) { }
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
    var c = r.contacts || {};
    var html = '<div class="notif-section">Каналы</div>' +
      '<div class="notif-contact"><b>Лента в приложении</b><span class="wh-badge wh-b-green">всегда включена</span></div>' +
      '<div class="notif-contact"><b>Telegram</b>' +
      (c.tg_linked ? '<span class="wh-badge wh-b-green">подключён</span>' :
        (r.tg_ready
          ? '<button class="btn btn-sm btn-secondary" onclick="notifTgLink()">Привязать</button>'
          : '<span class="wh-badge wh-b-grey" title="Администратор ещё не подключил бота">бот не настроен</span>')) +
      '</div>' +
      '<div id="notifTgHint" class="notif-hint" style="display:none"></div>' +
      '<div class="notif-contact"><b>Email</b><span style="display:flex;gap:6px;flex:1;max-width:240px">' +
      '<input type="email" id="notifEmail" placeholder="почта@пример.ру" value="' + esc(c.email || '') + '" style="flex:1">' +
      '<button class="btn btn-sm btn-secondary" onclick="notifSaveEmail()">Ок</button></span></div>' +
      '<div class="notif-feed-actions"><button class="btn btn-sm btn-secondary" onclick="notifTest()">Прислать пробное уведомление</button></div>';

    var byCat = {};
    (r.types || []).forEach(function (t) { (byCat[t.category] = byCat[t.category] || []).push(t); });
    Object.keys(CAT_LABELS).forEach(function (cat) {
      if (!byCat[cat]) return;
      html += '<div class="notif-section">' + CAT_LABELS[cat] + '</div>';
      byCat[cat].forEach(function (t) {
        var ch = t.channels || [];
        var tgOn = ch.indexOf('telegram') >= 0, emOn = ch.indexOf('email') >= 0;
        html += '<div class="notif-type' + (t.global_enabled ? '' : ' notif-type-off') + '">' +
          '<label class="notif-type-main"><input type="checkbox" ' + (t.enabled ? 'checked' : '') +
          ' onchange="notifPrefToggle(\'' + t.key + '\',this.checked)"> <span><b>' + esc(t.title) + '</b>' +
          '<small>' + esc(t.descr) + (t.global_enabled ? '' : ' — выключено администратором') + '</small></span></label>' +
          '<span class="notif-type-ch">' +
          '<label title="Telegram"><input type="checkbox" ' + (tgOn ? 'checked' : '') +
          ' onchange="notifPrefChannel(\'' + t.key + '\',\'telegram\',this.checked)">TG</label>' +
          '<label title="Email"><input type="checkbox" ' + (emOn ? 'checked' : '') +
          ' onchange="notifPrefChannel(\'' + t.key + '\',\'email\',this.checked)">✉</label>' +
          '</span></div>';
      });
    });
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
  window.notifSaveEmail = async function () {
    var r = await rpc('app_notif_contacts_set', { p_email: $('notifEmail').value.trim() });
    showToast(r.error ? 'Ошибка: ' + r.error : 'Email сохранён', r.error ? 'error' : 'success');
  };
  window.notifTgLink = async function () {
    var r = await rpc('app_notif_tg_code');
    var hint = $('notifTgHint');
    if (r.error || !r.code) { showToast('Ошибка: ' + (r.error || 'нет кода'), 'error'); return; }
    hint.style.display = '';
    hint.innerHTML = 'Откройте бота <b>' + esc(r.bot || 'вашего бота') + '</b> в Telegram и отправьте ему:<br>' +
      '<code style="font-size:15px">/start ' + esc(r.code) + '</code><br>' +
      'Через минуту привязка подтвердится автоматически.';
  };
  window.notifTest = async function () {
    var r = await rpc('app_notif_test');
    if (r.error) { showToast('Ошибка: ' + r.error, 'error'); return; }
    showToast('Лента: есть. Telegram: ' + (r.telegram || '—') + '. Email: ' + (r.email || '—'), 'success');
    poll(true);
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
      '<div class="notif-section">Telegram-бот</div>' +
      inp('tg_bot_name', 'Имя бота', '@nandrent_radar_bot') +
      inp('tg_bot_token', 'Токен бота (из @BotFather)', 'оставьте •••••• чтобы не менять', 'password') +
      '<div class="notif-section">Email (resend.com)</div>' +
      inp('email_from', 'Адрес отправителя', 'radar@nandrent.ru') +
      inp('resend_key', 'API-ключ Resend', 'оставьте •••••• чтобы не менять', 'password') +
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

  document.addEventListener('DOMContentLoaded', function () {
    var t = $('notifTab-admin');
    if (t) t.style.display = 'none';
    if (me()) { var b = $('notifBell'); if (b) b.style.display = ''; startPolling(); }
  });
})();
