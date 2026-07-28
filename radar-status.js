/**
 * Radar NR — индикатор сохранения.
 *
 * Показывает честное состояние: «Сохранено» появляется только после того, как
 * Supabase подтвердил запись. Пока подтверждения нет — «Сохранение…», при сбое —
 * «Ошибка сохранения» с кнопкой «Повторить». Молчаливого «всё хорошо» больше нет.
 */
(function () {
  'use strict';

  var STORE = window.RadarStore;
  if (!STORE) return;

  var host = null;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.id = 'radarSaveStatus';
    host.className = 'radar-save-status';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  }

  function timeOf(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  var VIEW = {
    idle: function () { return null; },
    saving: function (s) {
      return { cls: 'is-saving', icon: '<span class="radar-save-spinner"></span>', text: 'Сохранение…' + (s.pending > 1 ? ' (' + s.pending + ')' : '') };
    },
    saved: function (s) {
      return { cls: 'is-saved', icon: '✓', text: 'Сохранено' + (s.at ? ' · ' + timeOf(s.at) : ''), autoHide: 4000 };
    },
    offline: function (s) {
      return { cls: 'is-offline', icon: '⚑', text: 'Нет сети · ждут отправки: ' + s.pending };
    },
    error: function (s) {
      return {
        cls: 'is-error', icon: '✕',
        text: 'Ошибка сохранения' + (s.pending ? ' · не отправлено: ' + s.pending : ''),
        detail: s.error || '',
        retry: true
      };
    }
  };

  var hideTimer = null;

  function render(s) {
    var view = (VIEW[s.state] || VIEW.idle)(s);
    var el = ensureHost();
    clearTimeout(hideTimer);

    if (!view) { el.className = 'radar-save-status'; el.innerHTML = ''; return; }

    el.className = 'radar-save-status is-visible ' + view.cls;
    el.innerHTML =
      '<span class="radar-save-icon">' + view.icon + '</span>' +
      '<span class="radar-save-text">' + view.text + '</span>' +
      (view.detail ? '<span class="radar-save-detail">' + escapeHtml(view.detail) + '</span>' : '') +
      (view.retry ? '<button type="button" class="radar-save-retry">Повторить</button>' : '');

    if (view.retry) {
      el.querySelector('.radar-save-retry').addEventListener('click', function () {
        STORE.flush({ force: true });
      });
    }
    if (view.autoHide) {
      hideTimer = setTimeout(function () { el.className = 'radar-save-status'; }, view.autoHide);
    }
    syncModalBadge(s, view);
  }

  /** Дубль статуса внутри окна заказа — там он нужнее всего. */
  function syncModalBadge(s, view) {
    var badge = document.getElementById('crmSaveBadge');
    if (!badge) return;
    var modal = document.getElementById('crmOrderModal');
    if (!modal || !modal.classList.contains('active')) { badge.className = 'crm-save-badge'; badge.textContent = ''; return; }
    if (!view) { badge.className = 'crm-save-badge'; badge.textContent = ''; return; }
    badge.className = 'crm-save-badge is-visible ' + view.cls;
    badge.textContent = view.text;
    badge.title = view.detail || '';
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  STORE.onStatus(render);

  // Если после перезагрузки в очереди что-то осталось — сразу говорим об этом
  // и пытаемся дослать, не дожидаясь действий пользователя.
  document.addEventListener('DOMContentLoaded', function () {
    if (STORE.pendingCount() > 0) {
      render(STORE.getStatus());
      STORE.flush({ force: true });
    }
  });

  window.RadarStatus = { render: render };
})();
