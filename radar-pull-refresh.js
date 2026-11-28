// Обновление страницы жестом от края списка, включая запуск с домашнего экрана iOS.
(() => {
  'use strict';

  const threshold = 88;
  const hint = document.createElement('div');
  hint.id = 'radar-pull-hint';
  hint.setAttribute('role', 'status');
  hint.hidden = true;
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '↻';
  const caption = document.createElement('span');
  hint.append(icon, caption);
  document.body.append(hint);

  const style = document.createElement('style');
  style.textContent = `
    #radar-pull-hint:not([hidden]) {display:flex;align-items:center;gap:8px}
    #radar-pull-hint {position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;transform:translateX(-50%);z-index:170;pointer-events:none;white-space:nowrap;padding:7px 14px;border-radius:20px;background:#242428;color:white;font:500 13px/1.4 system-ui,sans-serif}
    #radar-pull-hint[data-edge="bottom"] {top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 12px)}
    #radar-pull-hint [aria-hidden] {display:inline-grid;place-items:center;width:22px;height:22px;font:22px/1 system-ui,sans-serif}
    @media (prefers-reduced-motion:no-preference) {
      #radar-pull-hint [aria-hidden] {transform:rotate(var(--pull-angle,0deg))}
      #radar-pull-hint[data-loading] [aria-hidden] {animation:radar-pull-spin .65s linear infinite}
    }
    @keyframes radar-pull-spin {from {transform:rotate(var(--pull-angle))} to {transform:rotate(calc(var(--pull-angle) + 360deg))}}
  `;
  document.head.append(style);
  if (navigator.maxTouchPoints || matchMedia('(pointer:coarse)').matches) {
    document.documentElement.style.overscrollBehaviorY = 'none';
  }

  let start = null;
  let ready = false;
  function cancel() {
    start = null;
    ready = false;
    hint.hidden = true;
    delete hint.dataset.loading;
  }
  function blocked() {
    return document.querySelector('.modal-overlay.active, .sidebar.open, #notifPanel.open');
  }
  document.addEventListener('touchstart', event => {
    if (hint.hasAttribute('data-loading')) return;
    cancel();
    if (event.touches.length !== 1 || blocked()) return;
    const target = event.target;
    if (!target.closest('.main, .mobile-header, main, .login-screen') ||
        target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    const root = document.scrollingElement;
    let atTop = window.scrollY <= 1;
    let atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 1;
    for (let el = target; el && el !== root && (atTop || atBottom); el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 1 || !/^(auto|scroll)$/.test(getComputedStyle(el).overflowY)) continue;
      atTop = atTop && el.scrollTop <= 1;
      atBottom = atBottom && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    }
    if (atTop || atBottom) start = {x:event.touches[0].clientX, y:event.touches[0].clientY, atTop, atBottom};
  }, {passive:true});

  document.addEventListener('touchmove', event => {
    if (!start) return;
    if (event.touches.length !== 1 || !event.cancelable || blocked()) return cancel();
    const finger = event.touches[0];
    const dy = finger.clientY - start.y;
    const distance = Math.abs(dy);
    const dx = Math.abs(finger.clientX - start.x);
    if (dx > Math.max(5, distance) || (dy > 0 && !start.atTop) || (dy < 0 && !start.atBottom)) return cancel();
    if (distance) event.preventDefault();
    ready = distance >= threshold;
    hint.hidden = distance < 14;
    hint.dataset.edge = dy < 0 ? 'bottom' : 'top';
    hint.style.setProperty('--pull-angle', Math.round(Math.min(distance / threshold, 1) * 270) + 'deg');
    const message = ready ? 'Отпустите, чтобы обновить' : dy < 0 ? 'Потяните вверх для обновления' : 'Потяните вниз для обновления';
    if (caption.textContent !== message) caption.textContent = message;
  }, {passive:false});

  document.addEventListener('touchcancel', () => { if (start) cancel(); });
  document.addEventListener('touchend', event => {
    if (!start) return;
    if (!ready || event.touches.length || blocked()) return cancel();
    start = null;
    hint.dataset.loading = '';
    caption.textContent = 'Обновляем…';
    const page = document.querySelector('#app.active .page.active');
    if (page && window.currentUser) {
      window.history.replaceState({...window.history.state, radarPullPage:{
        page:page.id.slice('page-'.length), user:window.currentUser.username
      }}, '');
    }
    setTimeout(() => {
      location.reload();
      // Если пользователь отменил перезагрузку в системном диалоге.
      setTimeout(cancel, 1500);
    }, 260);
  });
  window.addEventListener('pageshow', cancel);
})();
