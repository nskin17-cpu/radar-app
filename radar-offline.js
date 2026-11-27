// Последняя сформированная версия каждого PDF хранится в браузере сотрудника.
(function () {
  'use strict';
  const scope = new URL('./', location.href);
  const prefix = 'radar-pdf-v1:' + scope.pathname + ':';

  function owner(name) {
    const user = RadarConfig.readSession();
    if (!user || !user.username) return null;
    if (user.role !== 'admin' && user.perms) {
      const canView = area => ['view', 'edit'].includes(user.perms[area]);
      const allowAct = (!name || name.startsWith('Акт_')) && canView('assembly');
      if (!canView('orders') && !allowAct) return null;
    }
    return user.username;
  }

  // Захватываем пользователя до асинхронной генерации документа.
  function capture(name, orderId) {
    const user = owner(name);
    const time = Date.now();
    const key = new URL('local-pdf', scope);
    key.searchParams.set('name', name);
    key.searchParams.set('order', orderId && orderId !== 'NEW' ? orderId : String(time));
    return async function (blob) {
      if (!user || owner(name) !== user) return;
      try {
        const cache = await caches.open(prefix + user);
        if (owner(name) !== user) return;
        await cache.put(key, new Response(blob, { headers: {
          'Content-Type': 'application/pdf', 'X-Radar-Saved': String(time)
        }}));
      } catch (error) {
        if (window.showToast) showToast('Не удалось сохранить копию PDF для просмотра без связи', 'error');
      }
    };
  }

  function forget(user) {
    try {
      const key = RadarConfig.cache.ordersKey;
      if (user && JSON.parse(localStorage.getItem(key))?.owner === user) localStorage.removeItem(key);
    } catch (error) { /* Хранилище недоступно. */ }
    if (user && window.caches) caches.delete(prefix + user).catch(() => {});
  }

  window.RadarOffline = { capture, forget };

  const indicators = document.querySelectorAll('[data-offline-ready]');
  if (indicators.length) {
    let shellReady = false;
    function updateIndicator() {
      let snapshot;
      try { snapshot = JSON.parse(localStorage.getItem(RadarConfig.cache.ordersKey)); } catch (error) {}
      const available = snapshot && snapshot.owner === owner() && snapshot.at && Array.isArray(snapshot.orders);
      const text = !shellReady ? 'Офлайн-страницы ещё не готовы' :
        available ? 'Доступно без связи' : 'Ожидаем загрузки заказов';
      indicators.forEach(el => { if (el.textContent !== text) el.textContent = text; });
    }
    function checkWorker() {
      const worker = navigator.serviceWorker?.controller;
      if (!worker) { shellReady = false; updateIndicator(); return; }
      const channel = new MessageChannel();
      const timer = setTimeout(() => channel.port1.close(), 5000);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        channel.port1.close();
        if (navigator.serviceWorker.controller !== worker) return;
        shellReady = event.data === true;
        updateIndicator();
      };
      worker.postMessage('offline-status', [channel.port2]);
    }
    navigator.serviceWorker?.addEventListener('controllerchange', checkWorker);
    window.addEventListener('pageshow', checkWorker);
    window.addEventListener('radar-orders-cache', updateIndicator);
    window.addEventListener('storage', updateIndicator);
    checkWorker();
    updateIndicator();
  }

  const list = document.getElementById('offlineList');
  if (!list) return;
  const status = document.getElementById('offlineStatus');
  let generation = 0;
  async function render() {
    const token = ++generation;
    list.replaceChildren();
    const user = owner();
    if (!user) {
      status.textContent = 'Для просмотра нужен действующий вход в Radar с доступом к заказам или их выдаче.';
      return;
    }
    try {
      const cache = await caches.open(prefix + user);
      const files = await Promise.all((await cache.keys()).map(async request => {
        const response = await cache.match(request);
        if (!response) return null;
        return { request, name: new URL(request.url).searchParams.get('name'),
          time: Number(response.headers.get('X-Radar-Saved')) };
      }));
      if (token !== generation || user !== owner()) return;
      for (const file of files.filter(Boolean).sort((a, b) => b.time - a.time)) {
        if (owner(file.name) !== user) continue;
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.textContent = file.name;
        button.onclick = async () => {
          if (owner(file.name) !== user) return render();
          try {
            const response = await cache.match(file.request);
            if (!response) return render();
            const blob = await response.blob();
            if (owner(file.name) !== user) return render();
            location.assign(URL.createObjectURL(blob));
          } catch (error) { status.textContent = 'Не удалось открыть сохранённый файл.'; }
        };
        const date = document.createElement('small');
        date.textContent = new Date(file.time).toLocaleString('ru-RU');
        item.append(button, date);
        list.append(item);
      }
      status.textContent = list.children.length ? 'Последние копии на этом устройстве' :
        'Здесь пока нет файлов. Сформируйте смету или акт в заказе на этом устройстве.';
    } catch (error) {
      if (token === generation) status.textContent = 'Браузер не разрешил доступ к сохранённым файлам.';
    }
  }

  window.addEventListener('pageshow', render);
  window.addEventListener('storage', event => {
    if (!event.key || event.key === RadarConfig.cache.sessionKey) render();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
})();
