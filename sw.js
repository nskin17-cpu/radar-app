// Пуш-уведомления и отдельная страница просмотра PDF без связи.
'use strict';

const scope = self.registration.scope;
const shellPrefix = 'radar-offline-shell:' + new URL(scope).pathname + ':';
const shellCache = shellPrefix + '20261128-pull-icon';
const offlinePage = new URL('offline.html', scope).href;
const assets = ['radar-config.js?v=20261128-branches', 'radar-offline.js?v=20261128-ios-1',
  'radar-warehouse.js?v=20261128-branches', 'offline-orders.js?v=20261128-pull',
  'radar-pull-refresh.js?v=20261128-pull-icon']
  .map(path => new URL(path, scope).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCache);
    await cache.addAll([offlinePage, ...assets].map(url => new Request(url, {cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(shellPrefix) && key !== shellCache).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data !== 'offline-status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(shellCache);
    const entries = await Promise.all([offlinePage, ...assets].map(url => cache.match(url)));
    event.ports[0].postMessage(entries.every(Boolean));
  })());
});

async function offlineResponse() {
  const cache = await caches.open(shellCache);
  return await cache.match(offlinePage) || new Response(
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><p>Копия Radar недоступна. Откройте приложение с интернетом, чтобы сохранить заказы на этом устройстве.</p>',
    {headers:{'Content-Type':'text/html; charset=utf-8'}}
  );
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Кэшируем только автономную страницу и её версионированные скрипты.
  if (url.origin === self.location.origin && url.pathname === new URL(offlinePage).pathname) {
    event.respondWith(offlineResponse());
    return;
  }
  if (assets.includes(url.href)) {
    event.respondWith(caches.open(shellCache).then(async cache => (await cache.match(request)) || fetch(request)));
    return;
  }
  if ((request.mode !== 'navigate' && request.destination !== 'document') || url.origin !== self.location.origin ||
      ![new URL(scope).pathname, new URL('index.html', scope).pathname].includes(url.pathname)) return;
  event.respondWith((async () => {
    if (self.navigator.onLine === false) return offlineResponse();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(request, {signal: controller.signal, cache:'no-store'});
      if (response.ok && response.status !== 204) {
        // Держим таймер до конца HTML: связь может оборваться после заголовков.
        const body = await response.arrayBuffer();
        if (body.byteLength) {
          const headers = new Headers(response.headers);
          headers.delete('Content-Encoding');
          headers.delete('Content-Length');
          return new Response(body, {status:response.status, headers});
        }
      }
    } catch (error) {
      // Ошибка сети или тайм-аут: открываем локальный список документов.
    } finally { clearTimeout(timer); }
    return offlineResponse();
  })());
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { title: 'Radar NR', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Radar NR', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { link: d.link || null },
    tag: d.tag || undefined
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var link = e.notification.data && e.notification.data.link;
  e.waitUntil((async function () {
    var wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      try { await wins[0].focus(); } catch (err) { }
      if (link) wins[0].postMessage({ radarNotifLink: link });
      return;
    }
    await self.clients.openWindow('./' + (link ? '?nl=' + encodeURIComponent(link) : ''));
  })());
});
