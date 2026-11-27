// Пуш-уведомления и отдельная страница просмотра PDF без связи.
'use strict';

const scope = self.registration.scope;
const shellPrefix = 'radar-offline-shell:' + new URL(scope).pathname + ':';
const shellCache = shellPrefix + '20261128-2';
const offlinePage = new URL('offline.html', scope).href;
const assets = ['radar-config.js?v=20261128-orders', 'radar-offline.js?v=20261128-orders',
  'radar-warehouse.js?v=20261128-orders', 'offline-orders.js?v=20261128-orders']
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

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Кэшируем только автономную страницу и её версионированные скрипты.
  if (url.href === offlinePage || assets.includes(url.href)) {
    event.respondWith(caches.open(shellCache).then(async cache => (await cache.match(request)) || fetch(request)));
    return;
  }
  if (request.mode !== 'navigate' || url.origin !== self.location.origin ||
      ![new URL(scope).pathname, new URL('index.html', scope).pathname].includes(url.pathname)) return;
  event.respondWith((async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(request, {signal: controller.signal});
      if (response.status < 500) return response;
    } catch (error) {
      // Ошибка сети или тайм-аут: открываем локальный список документов.
    } finally { clearTimeout(timer); }
    return (await caches.open(shellCache)).match(offlinePage);
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
