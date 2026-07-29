/**
 * Radar NR — Edge Function «notif-push»: рассылка браузерных push-уведомлений.
 *
 * Зачем она нужна: Web Push требует VAPID-подпись (ES256), которую Postgres
 * сделать не может. Это единственный серверный компонент системы уведомлений.
 *
 * Как работает:
 *   1. База (pg_cron/триггеры) будит функцию POST-запросом с заголовком
 *      x-push-secret (значение лежит в notif_settings.push_fn_secret).
 *   2. Функция сервисным ключом забирает из notif_queue задания канала
 *      webpush, шлёт их на все устройства получателя и записывает статусы.
 *   3. Протухшие подписки (410/404 от push-сервиса) удаляются сами.
 *
 * КАК ЗАДЕПЛОИТЬ (без командной строки):
 *   Supabase Dashboard → Edge Functions → Deploy a new function →
 *   «Via Editor» → имя: notif-push → вставьте весь этот файл → Deploy.
 *   Затем в настройках функции ВЫКЛЮЧИТЕ «Verify JWT» (защита — наш секрет).
 */
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-push-secret, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: st, error: stErr } = await supa
    .from('notif_settings').select('key,value')
    .in('key', ['push_fn_secret', 'vapid_public', 'vapid_private', 'email_from']);
  if (stErr) return json({ error: 'настройки не читаются: ' + stErr.message }, 500);
  const cfg = Object.fromEntries((st ?? []).map((r) => [r.key, r.value ?? '']));

  if (!cfg.push_fn_secret || (req.headers.get('x-push-secret') ?? '') !== cfg.push_fn_secret) {
    return json({ error: 'неверный секрет (x-push-secret)' }, 401);
  }
  if (!cfg.vapid_public || !cfg.vapid_private) {
    return json({ error: 'VAPID-ключи не сгенерированы (колокольчик → Система)' }, 400);
  }
  webpush.setVapidDetails(
    'mailto:' + (cfg.email_from || 'radar@nandrent.ru'),
    cfg.vapid_public,
    cfg.vapid_private,
  );

  const { data: queue, error: qErr } = await supa
    .from('notif_queue').select('*')
    .eq('channel', 'webpush').eq('status', 'queued')
    .order('created_at').limit(200);
  if (qErr) return json({ error: 'очередь не читается: ' + qErr.message }, 500);

  let sent = 0, errors = 0, removedSubs = 0;
  const subsCache = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();

  for (const row of queue ?? []) {
    if (!subsCache.has(row.username)) {
      const { data: subs } = await supa
        .from('notif_push_subs').select('endpoint,p256dh,auth')
        .eq('username', row.username);
      subsCache.set(row.username, subs ?? []);
    }
    const subs = subsCache.get(row.username)!;
    if (!subs.length) {
      await supa.from('notif_queue')
        .update({ status: 'skipped', error: 'нет подписанных устройств', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      continue;
    }
    let ok = false, lastErr = '';
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: row.title, body: row.body, link: row.link ?? null }),
          { TTL: 3600 },
        );
        ok = true;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode ?? 0;
        lastErr = 'push ' + (code || String(e));
        if (code === 404 || code === 410) {
          await supa.from('notif_push_subs').delete().eq('endpoint', s.endpoint);
          subsCache.set(row.username, subs.filter((x) => x.endpoint !== s.endpoint));
          removedSubs++;
        }
      }
    }
    await supa.from('notif_queue')
      .update({ status: ok ? 'dispatched' : 'error', error: ok ? null : lastErr, sent_at: new Date().toISOString() })
      .eq('id', row.id);
    ok ? sent++ : errors++;
  }

  return json({ ok: true, processed: (queue ?? []).length, sent, errors, removed_subs: removedSubs });
});
