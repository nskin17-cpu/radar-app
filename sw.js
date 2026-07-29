/**
 * Radar NR — сервис-воркер ТОЛЬКО для push-уведомлений.
 *
 * Здесь сознательно нет обработчика fetch и никакого кэширования:
 * приложение обновляется через ?v= в index.html, и кэширующий воркер
 * ломал бы этот механизм (страница «залипала» бы на старой версии).
 *
 * Пуш приходит из Supabase Edge Function notif-push (см. supabase/functions),
 * payload: { title, body, link } — link вида 'order:O123' или 'page:crm'.
 */
'use strict';

self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

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
