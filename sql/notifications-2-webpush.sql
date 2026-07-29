-- ============================================================================
-- Radar NR — УВЕДОМЛЕНИЯ, шаг Н2: браузерные Push (после шага Н1).
--
-- Пуши прилетают на телефон даже при закрытом приложении (iOS 16.4+ —
-- для приложения, установленного на экран «Домой»; Android/десктоп — везде).
--
-- Как устроено:
--   • подписка устройства хранится в notif_push_subs (устройств у человека
--     может быть несколько — телефон и компьютер);
--   • движок кладёт push-задания в общую очередь notif_queue (канал webpush);
--   • отправляет их Supabase Edge Function «notif-push» (см. файл
--     supabase/functions/notif-push/index.ts) — Postgres не умеет подписывать
--     VAPID, поэтому нужен этот маленький серверный компонент;
--   • база «будит» функцию через pg_net при каждом появлении заданий.
--
-- ПОСЛЕ ЭТОГО ФАЙЛА (по инструкции в приложении):
--   1) задеплойте Edge Function notif-push (вставкой кода в панели Supabase,
--      Verify JWT — выключить);
--   2) в колокольчике → «Система» → «Сгенерировать ключи» и «Проверить функцию»;
--   3) каждый сотрудник включает пуши кнопкой в «Настройках» колокольчика.
--
-- БЕЗОПАСНО: идемпотентно, повторный запуск не вредит.
-- ============================================================================

-- ── 1. Подписки устройств ───────────────────────────────────────────────────

create table if not exists notif_push_subs (
  endpoint   text primary key,
  username   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists notif_push_subs_user_idx on notif_push_subs (username);

alter table notif_push_subs enable row level security;
revoke all on table notif_push_subs from anon, authenticated;

-- Ссылка нужна пушу для перехода к заказу по тапу
alter table notif_queue add column if not exists link text;

-- ── 2. Настройки канала ─────────────────────────────────────────────────────
-- vapid_public/vapid_private генерируются кнопкой в админ-экране колокольчика.
-- push_fn_secret защищает функцию от чужих вызовов (создаётся здесь).

-- push_fn_apikey — публичный ключ проекта: шлюз Supabase требует его на любой
-- вызов Edge Function, помимо нашего секрета. Ключ и так открыт в приложении.
insert into notif_settings(key, value) values
  ('vapid_public',  ''),
  ('vapid_private', ''),
  ('push_fn_url',   'https://tqmzpktshlolqbydolpf.supabase.co/functions/v1/notif-push'),
  ('push_fn_apikey','sb_publishable_KADg_QBYffF_knlLGQHaqw_v4FMKzhX'),
  ('push_fn_secret', upper(substr(md5(random()::text) || md5(random()::text), 1, 32)))
on conflict (key) do nothing;

-- Если файл выполняется повторно, а ключ ещё пустой — заполним
update notif_settings set value = 'sb_publishable_KADg_QBYffF_knlLGQHaqw_v4FMKzhX'
 where key = 'push_fn_apikey' and coalesce(value,'') = '';

-- Пуш по умолчанию включаем там же, где Telegram (важные и сводки)
update notif_types
   set default_channels = default_channels || array['webpush']
 where 'telegram' = any(default_channels)
   and not ('webpush' = any(default_channels));

-- ── 3. Выпуск и доставка: канал webpush в общем конвейере ───────────────────

create or replace function notif_emit(
  p_type text, p_entity text, p_title text, p_body text, p_link text,
  p_exclude_user text default null,
  p_only_user text default null
) returns int language plpgsql security definer set search_path = public, extensions
as $$
declare t notif_types; rcpt text; ch text[]; n int := 0;
begin
  if coalesce(notif_setting('enabled'),'true') <> 'true' then return 0; end if;
  select * into t from notif_types where key = p_type;
  if t.key is null or not t.enabled then return 0; end if;
  for rcpt in
    select a from notif_audience(p_type) a
     where (p_only_user is null or a = p_only_user)
       and (p_exclude_user is null or a <> p_exclude_user)
  loop
    if notif_recently_sent(p_type, p_entity, rcpt, t.dedup_hours) then continue; end if;
    ch := notif_user_channels(rcpt, p_type);
    if array_length(ch,1) is null then continue; end if;
    insert into notifications (username, type_key, entity, title, body, link, severity)
    values (rcpt, p_type, p_entity, p_title, p_body, p_link, t.severity);
    if 'telegram' = any(ch) then
      insert into notif_queue (username, channel, title, body, link) values (rcpt, 'telegram', p_title, p_body, p_link);
    end if;
    if 'email' = any(ch) then
      insert into notif_queue (username, channel, title, body, link) values (rcpt, 'email', p_title, p_body, p_link);
    end if;
    if 'webpush' = any(ch) and exists (select 1 from notif_push_subs where username = rcpt) then
      insert into notif_queue (username, channel, title, body, link) values (rcpt, 'webpush', p_title, p_body, p_link);
    end if;
    n := n + 1;
  end loop;
  -- Мгновенные события не ждут 10-минутного тика: отправляем сразу
  if n > 0 then perform notif_dispatch_queue(); end if;
  return n;
end $$;

-- Разбудить Edge Function: она сама заберёт задания из очереди
create or replace function notif_push_wake()
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare url text; secret text; apikey text;
begin
  url := notif_setting('push_fn_url');
  secret := notif_setting('push_fn_secret');
  apikey := notif_setting('push_fn_apikey');
  if coalesce(url,'') = '' or coalesce(secret,'') = '' then return 'skipped: функция не настроена'; end if;
  perform net.http_post(
    url := url,
    body := '{"drain":true}'::jsonb,
    -- apikey обязателен: шлюз Supabase отклоняет вызовы без ключа проекта
    headers := jsonb_build_object('Content-Type','application/json',
                                  'x-push-secret', secret,
                                  'apikey', coalesce(apikey,'')));
  return null;
exception when others then
  return 'error: ' || sqlerrm;
end $$;

create or replace function notif_dispatch_queue()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare q notif_queue; res text; n int := 0; wake boolean := false;
begin
  -- skip locked: параллельный тик и триггер не отправят одно письмо дважды
  for q in select * from notif_queue where status = 'queued'
            order by created_at limit 100 for update skip locked loop
    if q.channel = 'telegram' then res := notif_send_telegram(q.username, q.title, q.body);
    elsif q.channel = 'email' then res := notif_send_email(q.username, q.title, q.body);
    elsif q.channel = 'webpush' then
      -- Отправляет Edge Function: строку не трогаем, только будим её
      wake := true; continue;
    else res := 'skipped: канал ещё не подключён'; end if;
    update notif_queue
       set status = case when res is null then 'dispatched'
                         when res like 'error%' then 'error' else 'skipped' end,
           error = res, sent_at = now()
     where id = q.id;
    n := n + 1;
  end loop;
  if wake then perform notif_push_wake(); end if;
  -- Гигиена: очередь старше 30 дней и прочитанная лента старше 90 дней не нужны
  delete from notif_queue where created_at < now() - interval '30 days';
  delete from notifications where created_at < now() - interval '90 days';
  return n;
end $$;

-- ── 4. RPC для приложения ───────────────────────────────────────────────────

-- Публичный VAPID-ключ и статус канала (зовётся из настроек колокольчика)
create or replace function app_notif_push_info()
returns json language plpgsql stable security definer set search_path = public, extensions
as $$
declare me users;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  return json_build_object(
    'vapid_public', coalesce(notif_setting('vapid_public'),''),
    'configured', coalesce(notif_setting('vapid_public'),'') <> '',
    'my_devices', (select count(*) from notif_push_subs where username = me.username));
end $$;

create or replace function app_notif_push_subscribe(p_sub jsonb)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users; ep text;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  ep := p_sub->>'endpoint';
  if coalesce(ep,'') = '' or (p_sub->'keys'->>'p256dh') is null or (p_sub->'keys'->>'auth') is null then
    return json_build_object('error','Неполная подписка');
  end if;
  insert into notif_push_subs (endpoint, username, p256dh, auth)
  values (ep, me.username, p_sub->'keys'->>'p256dh', p_sub->'keys'->>'auth')
  on conflict (endpoint) do update
     set username = excluded.username, p256dh = excluded.p256dh, auth = excluded.auth;
  return json_build_object('ok', true,
    'my_devices', (select count(*) from notif_push_subs where username = me.username));
end $$;

create or replace function app_notif_push_unsubscribe(p_endpoint text)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  delete from notif_push_subs where endpoint = p_endpoint and username = me.username;
  return json_build_object('ok', true);
end $$;

-- Администратор: сохранить ключи, диагностика для кнопки «Проверить функцию»
create or replace function app_notif_push_setkeys(p_public text, p_private text)
returns json language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  if coalesce(p_public,'') = '' or coalesce(p_private,'') = '' then
    return json_build_object('error','Пустые ключи');
  end if;
  insert into notif_settings (key, value) values ('vapid_public', p_public)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into notif_settings (key, value) values ('vapid_private', p_private)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return json_build_object('ok', true);
end $$;

create or replace function app_notif_push_diag()
returns json language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  return json_build_object(
    'url', coalesce(notif_setting('push_fn_url'),''),
    'secret', coalesce(notif_setting('push_fn_secret'),''),
    'apikey', coalesce(notif_setting('push_fn_apikey'),''),
    'keys_ready', coalesce(notif_setting('vapid_public'),'') <> '' and coalesce(notif_setting('vapid_private'),'') <> '',
    'subs_total', (select count(*) from notif_push_subs),
    'queued', (select count(*) from notif_queue where channel = 'webpush' and status = 'queued'));
end $$;

-- Обновлённый админ-доступ к настройкам: новые ключи в маскировке и записи
create or replace function app_notif_admin_get()
returns json language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  return json_build_object(
    'settings', (select json_object_agg(key, case when key in ('tg_bot_token','resend_key','vapid_private','push_fn_secret')
                        then case when coalesce(value,'') = '' then '' else '••••••' end
                        else value end) from notif_settings),
    'types', (select json_agg(json_build_object('key', key, 'title', title, 'category', category,
                     'enabled', enabled, 'schedule', schedule, 'sort', sort) order by sort) from notif_types),
    'runs', (select coalesce(json_agg(row_to_json(r) order by r.last_run desc), '[]'::json)
               from (select type_key, last_run, last_count, last_error from notif_runs) r),
    'queue_errors', (select coalesce(json_agg(row_to_json(q)), '[]'::json) from (
        select channel, title, error, created_at from notif_queue
         where status = 'error' order by created_at desc limit 10) q),
    'cron', (select coalesce(json_agg(jobname), '[]'::json) from cron.job
              where jobname in ('radar_notif_tick','radar_notif_tg')),
    'push', json_build_object(
      'keys_ready', coalesce(notif_setting('vapid_public'),'') <> '',
      'subs_total', (select count(*) from notif_push_subs)));
end $$;

create or replace function app_notif_admin_set(p_settings jsonb default null, p_types jsonb default null)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare k text; v text; t jsonb;
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  if p_settings is not null then
    for k, v in select * from jsonb_each_text(p_settings) loop
      if k in ('timezone','digest_time','weekly_dow','clients_period','enabled',
               'tg_bot_token','tg_bot_name','resend_key','email_from',
               'push_fn_url','push_fn_apikey') then
        if k in ('tg_bot_token','resend_key') and v = '••••••' then continue; end if;
        insert into notif_settings (key, value) values (k, v)
        on conflict (key) do update set value = excluded.value, updated_at = now();
      end if;
    end loop;
  end if;
  if p_types is not null then
    for t in select * from jsonb_array_elements(p_types) loop
      update notif_types set enabled = coalesce((t->>'enabled')::boolean, enabled)
       where key = t->>'key';
    end loop;
  end if;
  return json_build_object('ok', true);
end $$;

-- Пробное уведомление теперь проверяет и push: кладёт задание в очередь
-- и будит функцию — через пару секунд пуш должен прийти на устройство
create or replace function app_notif_test()
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users; r1 text; r2 text; r3 text; devices int;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  insert into notifications (username, type_key, title, body, severity)
  values (me.username, 'digest_daily', 'Проверка уведомлений',
          'Если вы это видите — лента работает. Время: ' ||
          to_char(now() at time zone coalesce(notif_setting('timezone'),'Europe/Moscow'), 'DD.MM HH24:MI'), 'info');
  r1 := notif_send_telegram(me.username, 'Проверка уведомлений Radar', 'Telegram подключён и работает.');
  r2 := notif_send_email(me.username, 'Проверка уведомлений Radar', 'Email подключён и работает.');
  select count(*) into devices from notif_push_subs where username = me.username;
  if devices > 0 then
    insert into notif_queue (username, channel, title, body, link)
    values (me.username, 'webpush', 'Проверка уведомлений Radar', 'Push подключён и работает.', 'page:crm');
    r3 := coalesce(notif_push_wake(), 'отправлено на ' || devices || ' устр.');
  else
    r3 := 'skipped: нет подписанных устройств';
  end if;
  return json_build_object('ok', true, 'telegram', coalesce(r1,'отправлено'),
                           'email', coalesce(r2,'отправлено'), 'push', r3);
end $$;

-- Права
revoke all on function notif_push_wake from public, anon;
grant execute on function app_notif_push_info(), app_notif_push_subscribe(jsonb),
  app_notif_push_unsubscribe(text), app_notif_push_setkeys(text,text),
  app_notif_push_diag() to anon;

-- ── Проверка: канал webpush в типах, секрет создан ──────────────────────────
select (select count(*) from notif_types where 'webpush' = any(default_channels)) as типов_с_пушем,
       (select case when coalesce(value,'')<>'' then 'создан' else 'НЕТ' end
          from notif_settings where key='push_fn_secret') as секрет_функции;
