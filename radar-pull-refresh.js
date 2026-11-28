// Обновление страницы жестом, в том числе при запуске с домашнего экрана iOS.
(() => {
  'use strict';

  const threshold = 88; // расстояние в CSS-пикселях до обновления
  const hint = document.createElement('div');
  hint.setAttribute('role', 'status');
  hint.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;transform:translateX(-50%);z-index:170;pointer-events:none;white-space:nowrap;padding:8px 14px;border-radius:18px;background:#242428;color:white;font:500 13px/1.4 system-ui,sans-serif';
  hint.hidden = true;
  document.body.append(hint);
  // В обычной вкладке браузер может иначе обработать тот же жест второй раз.
  if (navigator.maxTouchPoints || matchMedia('(pointer:coarse)').matches) {
    document.documentElement.style.overscrollBehaviorY = 'none';
  }

  let start = null;
  let ready = false;
  function cancel() {
    start = null;
    ready = false;
    hint.hidden = true;
  }
  function blocked() {
    return document.querySelector('.modal-overlay.active, .sidebar.open, #notifPanel.open');
  }
  document.addEventListener('touchstart', event => {
    cancel();
    if (event.touches.length !== 1 || blocked() || window.scrollY > 1) return;
    const target = event.target;
    if (!target.closest('.main, .mobile-header, main, .login-screen') ||
        target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    for (let el = target; el; el = el.parentElement) {
      if (el.scrollTop > 1) return;
    }
    start = event.touches[0];
  }, {passive:true});

  document.addEventListener('touchmove', event => {
    if (!start) return;
    const finger = event.touches[0];
    if (event.touches.length !== 1 || !event.cancelable || blocked()) return cancel();
    const dy = finger.clientY - start.clientY;
    const dx = Math.abs(finger.clientX - start.clientX);
    if (dy < 0 || dx > Math.max(5, dy)) return cancel();
    if (dy <= 0) return;
    event.preventDefault();
    ready = dy >= threshold;
    hint.hidden = dy < 14;
    const message = ready ? 'Отпустите, чтобы обновить' : 'Потяните вниз для обновления';
    if (hint.textContent !== message) hint.textContent = message;
  }, {passive:false});

  document.addEventListener('touchcancel', cancel);
  document.addEventListener('touchend', event => {
    const reload = ready && !event.touches.length && !blocked();
    cancel();
    if (!reload) return;
    const page = document.querySelector('#app.active .page.active');
    if (page && window.currentUser) {
      window.history.replaceState({...window.history.state, radarPullPage:{
        page:page.id.slice('page-'.length), user:window.currentUser.username
      }}, '');
    }
    location.reload();
  });
})();
