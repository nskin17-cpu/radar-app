-- ============================================================================
-- Radar NR — УВЕДОМЛЕНИЯ, шаг Н3: оставляем только Push и ленту.
--
-- ЗАЧЕМ: Telegram и Email на практике не используются и только путают
--        сотрудников в настройках. Каналы остаются в архитектуре (движок
--        их поддерживает), но выключены: заданий на них больше не создаётся,
--        в интерфейсе они не показываются.
--
-- Что делает файл:
--   1. убирает telegram/email из каналов по умолчанию у всех типов;
--   2. чистит личные настройки сотрудников от этих каналов;
--   3. удаляет зависшие задания по ним из очереди;
--   4. пробное уведомление проверяет только ленту и Push.
--
-- БЕЗОПАСНО: идемпотентно, ленту и подписки на Push не трогает.
-- ============================================================================

-- ── 1. Каналы по умолчанию: лента + Push ────────────────────────────────────
update notif_types
   set default_channels = (
     select coalesce(array_agg(c), array['inapp'])
       from unnest(default_channels) c
      where c not in ('telegram','email')
   );

-- У важных типов Push должен быть включён по умолчанию
update notif_types
   set default_channels = default_channels || array['webpush']
 where severity in ('warn','critical')
   and not ('webpush' = any(default_channels));

-- Сводки тоже приходят пушем
update notif_types
   set default_channels = default_channels || array['webpush']
 where category = 'digest'
   and not ('webpush' = any(default_channels));

-- ── 2. Личные настройки: убрать выбранные ранее telegram/email ──────────────
update notif_prefs
   set channels = (
     select coalesce(array_agg(c), array['inapp'])
       from unnest(channels) c
      where c not in ('telegram','email')
   )
 where channels is not null
   and (('telegram' = any(channels)) or ('email' = any(channels)));

-- ── 3. Очередь: снять зависшие задания недоступных каналов ──────────────────
update notif_queue
   set status = 'skipped', error = 'канал отключён', sent_at = now()
 where channel in ('telegram','email') and status = 'queued';

-- ── 4. Пробное уведомление: только лента и Push ─────────────────────────────
create or replace function app_notif_test()
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users; devices int; res text;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  insert into notifications (username, type_key, title, body, severity)
  values (me.username, 'digest_daily', 'Проверка уведомлений',
          'Если вы это видите — лента работает. Время: ' ||
          to_char(now() at time zone coalesce(notif_setting('timezone'),'Europe/Moscow'), 'DD.MM HH24:MI'), 'info');
  select count(*) into devices from notif_push_subs where username = me.username;
  if devices > 0 then
    insert into notif_queue (username, channel, title, body, link)
    values (me.username, 'webpush', 'Проверка уведомлений Radar',
            'Push подключён и работает.', 'page:crm');
    res := coalesce(notif_push_wake(), 'отправлено на устройств: ' || devices);
  else
    res := 'нет подключённых устройств';
  end if;
  return json_build_object('ok', true, 'push', res, 'devices', devices);
end $$;

grant execute on function app_notif_test() to anon;

-- ── Проверка: у всех типов только inapp/webpush ─────────────────────────────
select count(*) filter (where 'webpush' = any(default_channels)) as типов_с_push,
       count(*) filter (where ('telegram' = any(default_channels))
                           or ('email' = any(default_channels))) as осталось_лишних
  from notif_types;
