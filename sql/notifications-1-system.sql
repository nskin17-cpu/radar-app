-- ============================================================================
-- Radar NR — СИСТЕМА УВЕДОМЛЕНИЙ (шаг Н1, после security-шагов 1–5).
--
-- Архитектура: у приложения нет своего сервера (GitHub Pages + Supabase),
-- поэтому движок уведомлений живёт в Postgres:
--   • мгновенные события ловят триггеры на таблицах (заказы, пользователи);
--   • периодические правила и дайджесты запускает pg_cron (notif_tick);
--   • Telegram/Email уходят через pg_net прямо из базы;
--   • приложение читает ленту через RPC и показывает колокольчик.
--
-- Сущности (масштабируются добавлением строк, не переписыванием):
--   notif_types     — каталог типов (аудитория, канал, расписание, дедуп)
--   notif_prefs     — личные настройки: тип вкл/выкл, каналы
--   notif_contacts  — контакты каналов: telegram chat_id, email
--   notifications   — лента/история уведомлений пользователя (in-app)
--   notif_queue     — очередь и история внешних доставок (tg/email/…)
--   notif_runs      — когда правило запускалось (расписание/статус)
--   notif_settings  — глобальные настройки (часовой пояс, токены, время)
--
-- БЕЗОПАСНО: идемпотентно, данные не трогает. Выполняйте целиком.
-- После этого файла: в приложении появится колокольчик (нужна сборка
-- 20260730-3+), а в настройках колокольчика — привязка Telegram.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 1. Таблицы ──────────────────────────────────────────────────────────────

create table if not exists notif_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

insert into notif_settings(key, value) values
  ('timezone',        'Europe/Moscow'),
  ('digest_time',     '09:00'),   -- ежедневная сводка
  ('weekly_dow',      '1'),       -- понедельник (1=Пн … 7=Вс, ISO)
  ('clients_period',  '3'),       -- дней между клиентскими дайджестами
  ('enabled',         'true'),    -- общий выключатель
  ('tg_bot_token',    ''),        -- токен бота @BotFather (пусто = Telegram выключен)
  ('tg_bot_name',     ''),        -- @имя бота — показывается пользователям
  ('resend_key',      ''),        -- API-ключ resend.com (пусто = Email выключен)
  ('email_from',      'radar@nandrent.ru')
on conflict (key) do nothing;

create table if not exists notif_types (
  key             text primary key,
  category        text not null,            -- finance|orders|warehouse|clients|team|digest
  title           text not null,            -- человеческое название для настроек
  descr           text not null default '',
  severity        text not null default 'info' check (severity in ('info','warn','critical')),
  audience        jsonb not null,           -- {"admin":true} и/или {"area":"orders","level":"view"}
  schedule        text not null default 'instant' check (schedule in ('instant','hourly','daily','every3days','weekly')),
  dedup_hours     numeric not null default 0,   -- не слать повтор по той же сущности чаще
  digest          boolean not null default false, -- true: одно сводное сообщение, не поштучно
  enabled         boolean not null default true,
  default_channels text[] not null default array['inapp'],
  sort            int not null default 100
);

create table if not exists notif_prefs (
  username  text not null,
  type_key  text not null,
  enabled   boolean not null default true,
  channels  text[],                          -- null = каналы типа по умолчанию
  primary key (username, type_key)
);

create table if not exists notif_contacts (
  username     text primary key,
  tg_chat_id   text,
  tg_link_code text,
  email        text,
  updated_at   timestamptz not null default now()
);

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  username   text not null,
  type_key   text not null,
  entity     text,                           -- id сущности (заказ и т.п.) для дедупа и ссылки
  title      text not null,
  body       text not null default '',
  link       text,                           -- 'page:crm' | 'order:O123…' — куда ведёт клик
  severity   text not null default 'info',
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on notifications (username, created_at desc);
create index if not exists notifications_dedup_idx on notifications (type_key, entity, username, created_at desc);

create table if not exists notif_queue (
  id         uuid primary key default gen_random_uuid(),
  username   text not null,
  channel    text not null,                  -- telegram|email|webpush|sms
  title      text not null,
  body       text not null default '',
  status     text not null default 'queued', -- queued|dispatched|error|skipped
  error      text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists notif_queue_status_idx on notif_queue (status, created_at);

create table if not exists notif_runs (
  type_key   text primary key,
  last_run   timestamptz,
  last_count int not null default 0,
  last_error text
);

-- Служебное состояние поллинга Telegram (двухфазный getUpdates через pg_net)
create table if not exists notif_tg_state (
  id             int primary key default 1,
  last_update_id bigint not null default 0,
  pending_req    bigint
);
insert into notif_tg_state(id) values (1) on conflict (id) do nothing;

-- Снаружи таблицы не видны вообще — только RPC
alter table notif_settings enable row level security;
alter table notif_types    enable row level security;
alter table notif_prefs    enable row level security;
alter table notif_contacts enable row level security;
alter table notifications  enable row level security;
alter table notif_queue    enable row level security;
alter table notif_runs     enable row level security;
alter table notif_tg_state enable row level security;
revoke all on table notif_settings, notif_types, notif_prefs, notif_contacts,
                    notifications, notif_queue, notif_runs, notif_tg_state
  from anon, authenticated;

-- ── 2. Каталог типов ────────────────────────────────────────────────────────
-- Аудитория задаётся допусками, а не именами ролей: новые роли (логист,
-- монтажник) подключаются добавлением зоны допуска — без переписывания.

insert into notif_types (key, category, title, descr, severity, audience, schedule, dedup_hours, digest, default_channels, sort) values
  -- Заказы (мгновенные, из триггеров)
  ('order_created',   'orders',  'Новый заказ',
   'Создан новый заказ (кроме ваших собственных)', 'info',
   '{"area":"orders","level":"view"}', 'instant', 0, false, array['inapp','telegram'], 10),
  ('order_cancelled', 'orders',  'Заказ удалён',
   'Заказ удалён из системы — контроль против случайных и тихих удалений', 'critical',
   '{"admin":true}', 'instant', 0, false, array['inapp','telegram'], 11),
  ('order_date_changed', 'orders', 'Перенос дат заказа',
   'У заказа изменилась дата выдачи или возврата — складу пересобрать план', 'warn',
   '{"area":"assembly","level":"view","orArea":"orders"}', 'instant', 2, false, array['inapp','telegram'], 12),
  ('order_amount_changed', 'finance', 'Изменена сумма заказа',
   'Сумма существующего заказа изменена задним числом — контроль руководителя', 'warn',
   '{"admin":true}', 'instant', 2, false, array['inapp','telegram'], 20),
  ('order_paid', 'finance', 'Поступила оплата',
   'Заказ помечен оплаченным или внесена предоплата', 'info',
   '{"admin":true}', 'instant', 0, false, array['inapp'], 21),
  ('wh_issued_unpaid', 'finance', 'Выдан неоплаченный заказ',
   'Склад выдал заказ, по которому нет полной оплаты — деньги под риском', 'critical',
   '{"area":"orders","level":"edit"}', 'instant', 0, false, array['inapp','telegram'], 22),
  ('wh_compensation', 'warehouse', 'Компенсация или недостача',
   'Склад зафиксировал повреждения, недостачу или компенсацию при возврате — менеджеру связаться с клиентом', 'critical',
   '{"area":"orders","level":"edit"}', 'instant', 0, false, array['inapp','telegram'], 30),
  ('stock_conflict', 'warehouse', 'Нехватка товара / двойная бронь',
   'Пересекающиеся заказы требуют больше позиций, чем есть на складе', 'critical',
   '{"area":"orders","level":"edit","orArea":"assembly"}', 'instant', 6, false, array['inapp','telegram'], 31),
  ('team_users', 'team', 'Пользователи и права',
   'Создание пользователей, смена прав и паролей — журнал безопасности', 'warn',
   '{"admin":true}', 'instant', 0, false, array['inapp','telegram'], 40),

  -- Периодические правила (pg_cron, с дедупом по сущности)
  ('pay_overdue', 'finance', 'Не оплачен к выдаче',
   'Выдача сегодня-завтра, а заказ не оплачен и не предоплачен', 'critical',
   '{"area":"orders","level":"edit"}', 'hourly', 20, false, array['inapp','telegram'], 50),
  ('pay_balance_due', 'finance', 'Пора добрать остаток',
   'По предоплаченному заказу остался остаток, выдача в ближайшие 2 дня', 'warn',
   '{"area":"orders","level":"edit"}', 'daily', 20, false, array['inapp'], 51),
  ('deposit_stuck', 'finance', 'Залог/компенсация не закрыты',
   'Возврат принят больше суток назад, а вопрос по залогу или компенсации всё ещё открыт', 'warn',
   '{"area":"orders","level":"edit"}', 'daily', 20, false, array['inapp'], 52),
  ('assembly_overdue', 'warehouse', 'Сборка горит',
   'Выдача сегодня или уже просрочена, а заказ не собран', 'critical',
   '{"area":"assembly","level":"view","orArea":"orders"}', 'hourly', 12, false, array['inapp','telegram'], 53),
  ('return_overdue', 'warehouse', 'Аренда не возвращена',
   'Дата возврата прошла, а заказ так и числится на руках у клиента', 'warn',
   '{"area":"assembly","level":"view","orArea":"orders"}', 'daily', 20, false, array['inapp'], 54),

  -- Дайджесты (одно сводное сообщение)
  ('digest_daily', 'digest', 'Утренняя сводка дня',
   'Каждое утро: выдачи, возвраты, сборка, доставки и монтажи, денежные хвосты на сегодня', 'info',
   '{"area":"orders","level":"view","orArea":"assembly"}', 'daily', 0, true, array['inapp','telegram'], 60),
  ('digest_weekly', 'digest', 'Отчёт руководителю (понедельник)',
   'Неделя в цифрах: заказы, выручка, оплаты, новые клиенты, дебиторка, незакрытые залоги, загрузка', 'info',
   '{"admin":true}', 'weekly', 0, true, array['inapp','telegram','email'], 61),
  ('clients_digest', 'clients', 'Работа с клиентской базой',
   'Раз в 3 дня: уснувшие клиенты (90+ дней без заказов) и клиенты без будущих заказов на месяц', 'info',
   '{"area":"clients","level":"view"}', 'every3days', 0, true, array['inapp'], 62)
on conflict (key) do update set
  category = excluded.category, title = excluded.title, descr = excluded.descr,
  severity = excluded.severity, audience = excluded.audience, schedule = excluded.schedule,
  dedup_hours = excluded.dedup_hours, digest = excluded.digest, sort = excluded.sort;
  -- enabled и default_channels не перетираем: их мог поменять администратор

-- ── 3. Вспомогательные функции ──────────────────────────────────────────────

create or replace function notif_setting(p_key text)
returns text language sql stable security definer set search_path = public, extensions
as $$ select value from notif_settings where key = p_key $$;

-- Локальная дата компании (Ростов-на-Дону = Europe/Moscow)
create or replace function notif_today()
returns date language sql stable security definer set search_path = public, extensions
as $$ select (now() at time zone coalesce(notif_setting('timezone'),'Europe/Moscow'))::date $$;

-- Есть ли у пользователя допуск к зоне (повторяет клиентскую логику perms)
create or replace function notif_user_can(u users, p_area text, p_level text)
returns boolean language plpgsql stable security definer set search_path = public, extensions
as $$
declare lvl text;
begin
  if u.role = 'admin' then return true; end if;
  if u.perms is null then return true; end if;   -- учётка до допусков = полный доступ
  lvl := u.perms ->> p_area;
  if lvl = 'edit' then return true; end if;
  return lvl = 'view' and p_level = 'view';
end $$;

-- Разворачивает audience типа в список логинов
create or replace function notif_audience(p_type text)
returns setof text language plpgsql stable security definer set search_path = public, extensions
as $$
declare t notif_types; u users;
begin
  select * into t from notif_types where key = p_type;
  if t.key is null then return; end if;
  for u in select * from users loop
    if coalesce((t.audience->>'admin')::boolean, false) and u.role = 'admin' then
      return next u.username; continue;
    end if;
    if t.audience ? 'area' then
      if notif_user_can(u, t.audience->>'area', coalesce(t.audience->>'level','view'))
         or (t.audience ? 'orArea' and notif_user_can(u, t.audience->>'orArea', 'view')) then
        return next u.username; continue;
      end if;
    end if;
  end loop;
end $$;

-- Уже слали такое недавно? (антиспам по сущности и получателю)
create or replace function notif_recently_sent(p_type text, p_entity text, p_user text, p_hours numeric)
returns boolean language sql stable security definer set search_path = public, extensions
as $$
  select p_hours > 0 and exists (
    select 1 from notifications
     where type_key = p_type and username = p_user
       and coalesce(entity,'') = coalesce(p_entity,'')
       and created_at > now() - make_interval(hours => p_hours::int)
  );
$$;

-- Каналы пользователя для типа: пересечение настроек типа и личных настроек
create or replace function notif_user_channels(p_user text, p_type text)
returns text[] language plpgsql stable security definer set search_path = public, extensions
as $$
declare t notif_types; p notif_prefs; ch text[];
begin
  select * into t from notif_types where key = p_type;
  if t.key is null or not t.enabled then return array[]::text[]; end if;
  select * into p from notif_prefs where username = p_user and type_key = p_type;
  if p.username is not null and not p.enabled then return array[]::text[]; end if;
  ch := coalesce(p.channels, t.default_channels, array['inapp']);
  if not ('inapp' = any(ch)) then ch := ch || 'inapp'; end if;  -- лента ведётся всегда
  return ch;
end $$;

-- ── 4. Доставка по каналам ──────────────────────────────────────────────────
-- Внешние каналы уходят через pg_net (асинхронный HTTP из базы).
-- Telegram/Email включаются, когда администратор заполнит токены.
-- webpush/sms заведены как каналы-заглушки: строки очереди создаются со
-- статусом skipped — адаптер добавляется без изменения остальной системы.

create or replace function notif_send_telegram(p_user text, p_title text, p_body text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare token text; chat text;
begin
  token := notif_setting('tg_bot_token');
  if coalesce(token,'') = '' then return 'skipped: нет токена бота'; end if;
  select tg_chat_id into chat from notif_contacts where username = p_user;
  if coalesce(chat,'') = '' then return 'skipped: telegram не привязан'; end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || token || '/sendMessage',
    body := jsonb_build_object(
      'chat_id', chat,
      'text', '*' || replace(p_title,'*','') || '*' || E'\n' || p_body,
      'parse_mode', 'Markdown'),
    headers := '{"Content-Type":"application/json"}'::jsonb);
  return null; -- отправлено (pg_net доставляет асинхронно)
exception when others then
  return 'error: ' || sqlerrm;
end $$;

create or replace function notif_send_email(p_user text, p_title text, p_body text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare key text; addr text;
begin
  key := notif_setting('resend_key');
  if coalesce(key,'') = '' then return 'skipped: нет ключа Resend'; end if;
  select email into addr from notif_contacts where username = p_user;
  if coalesce(addr,'') = '' then return 'skipped: email не указан'; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    body := jsonb_build_object(
      'from', coalesce(notif_setting('email_from'),'radar@nandrent.ru'),
      'to', jsonb_build_array(addr),
      'subject', p_title,
      'text', p_body),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || key));
  return null;
exception when others then
  return 'error: ' || sqlerrm;
end $$;

create or replace function notif_dispatch_queue()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare q notif_queue; res text; n int := 0;
begin
  -- skip locked: параллельный тик и триггер не отправят одно письмо дважды
  for q in select * from notif_queue where status = 'queued'
            order by created_at limit 100 for update skip locked loop
    if q.channel = 'telegram' then res := notif_send_telegram(q.username, q.title, q.body);
    elsif q.channel = 'email' then res := notif_send_email(q.username, q.title, q.body);
    else res := 'skipped: канал ещё не подключён'; end if;
    update notif_queue
       set status = case when res is null then 'dispatched'
                         when res like 'error%' then 'error' else 'skipped' end,
           error = res, sent_at = now()
     where id = q.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── 5. Единая точка выпуска уведомления ─────────────────────────────────────

create or replace function notif_emit(
  p_type text, p_entity text, p_title text, p_body text, p_link text,
  p_exclude_user text default null,     -- автор действия не получает своё же событие
  p_only_user text default null         -- дайджест: конкретному получателю
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
      insert into notif_queue (username, channel, title, body) values (rcpt, 'telegram', p_title, p_body);
    end if;
    if 'email' = any(ch) then
      insert into notif_queue (username, channel, title, body) values (rcpt, 'email', p_title, p_body);
    end if;
    n := n + 1;
  end loop;
  -- Мгновенные события не ждут 10-минутного тика: отправляем сразу
  if n > 0 then perform notif_dispatch_queue(); end if;
  return n;
end $$;

-- ── 6. Мгновенные события: триггеры на заказах и пользователях ──────────────

create or replace function notif_fmt_money(n numeric)
returns text language sql immutable
as $$ select replace(to_char(coalesce(n,0), 'FM999G999G999'), ',', ' ') $$;

create or replace function notif_order_label(o orders)
returns text language sql stable
as $$ select coalesce(nullif(o.order_number,''), o.id) $$;

-- Проверка нехватки по позициям одного заказа (или всем ближайшим).
-- Смотрит окно [сегодня; +30 дней]: по каждому дню суммирует потребность
-- пересекающихся незавершённых заказов и сравнивает с qty на складе.
create or replace function notif_stock_conflicts(p_order_id text default null)
returns table (item_name text, category text, day date, need numeric, have numeric, orders_cnt bigint)
language sql stable security definer set search_path = public, extensions
as $$
  with days as (
    select d::date as day from generate_series(notif_today(), notif_today() + 30, interval '1 day') d
  ),
  demand as (
    select lower(trim(i->>'name')) as iname,
           coalesce(nullif(trim(i->>'category'),''), '') as icat,
           o.id as order_id, o.start_date, o.end_date,
           coalesce((i->>'qty')::numeric, 0) as qty
      from orders o, jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) i
     where o.status <> 'completed'
       and o.start_date is not null and o.end_date is not null
       and o.end_date >= notif_today() and o.start_date <= notif_today() + 30
  ),
  focus as (   -- позиции, которые нас интересуют (все или только заказа-виновника)
    select distinct iname, icat from demand
     where p_order_id is null or order_id = p_order_id
  ),
  per_day as (
    select d.iname, d.icat, days.day, sum(d.qty) as need, count(distinct d.order_id) as orders_cnt
      from demand d join days on days.day between d.start_date and d.end_date
      join focus f on f.iname = d.iname and f.icat = d.icat
     group by d.iname, d.icat, days.day
  )
  select s.name, s.category, p.day, p.need, s.qty, p.orders_cnt
    from per_day p
    join stock s on lower(trim(s.name)) = p.iname
                and (p.icat = '' or lower(trim(s.category)) = lower(p.icat))
   where s.qty > 0 and p.need > s.qty
   order by p.day, s.name;
$$;

create or replace function notif_on_order_change()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare actor text; lbl text; c record; conflict_txt text;
begin
  actor := coalesce((select username from app_session_user()), 'система');

  if tg_op = 'DELETE' then
    perform notif_emit('order_cancelled', old.id,
      'Удалён заказ ' || notif_order_label(old),
      'Клиент: ' || coalesce(old.client_name,'—') || ', сумма ' || notif_fmt_money(old.order_amount) ||
      ' ₽, выдача ' || coalesce(to_char(old.start_date,'DD.MM'),'—') || '. Удалил: ' || actor,
      'page:crm', actor);
    return old;
  end if;

  lbl := notif_order_label(new);

  if tg_op = 'INSERT' then
    perform notif_emit('order_created', new.id,
      'Новый заказ ' || lbl,
      'Выдача ' || coalesce(to_char(new.start_date,'DD.MM'),'—') ||
      ', позиций: ' || coalesce(jsonb_array_length(new.items),0) ||
      ', сумма ' || notif_fmt_money(new.order_amount) || ' ₽. Создал: ' || actor,
      'order:' || new.id, actor);
  end if;

  if tg_op = 'UPDATE' then
    -- Перенос дат: складу и менеджерам
    if new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
      perform notif_emit('order_date_changed', new.id,
        'Перенос дат: заказ ' || lbl,
        'Было ' || coalesce(to_char(old.start_date,'DD.MM'),'—') || '–' || coalesce(to_char(old.end_date,'DD.MM'),'—') ||
        ', стало ' || coalesce(to_char(new.start_date,'DD.MM'),'—') || '–' || coalesce(to_char(new.end_date,'DD.MM'),'—') ||
        '. Изменил: ' || actor,
        'order:' || new.id, actor);
    end if;
    -- Изменение суммы существующего заказа (контроль)
    if new.order_amount is distinct from old.order_amount and coalesce(old.order_amount,0) > 0 then
      perform notif_emit('order_amount_changed', new.id,
        'Сумма заказа ' || lbl || ' изменена',
        notif_fmt_money(old.order_amount) || ' ₽ → ' || notif_fmt_money(new.order_amount) ||
        ' ₽. Изменил: ' || actor,
        'order:' || new.id, actor);
    end if;
    -- Оплата поступила
    if new.payment_status in ('prepaid','paid','paid_cash') and new.payment_status is distinct from old.payment_status then
      perform notif_emit('order_paid', new.id,
        case when new.payment_status = 'prepaid' then 'Предоплата по заказу ' else 'Оплачен заказ ' end || lbl,
        'Статус: ' || case new.payment_status when 'prepaid' then 'Предоплата'
                                              when 'paid' then 'Оплачен' else 'Оплачен наличными' end ||
        ', сумма ' || notif_fmt_money(new.order_amount) || ' ₽. Отметил: ' || actor,
        'order:' || new.id, actor);
    end if;
    -- Склад выдал неоплаченный заказ
    if (new.wh->>'state') = 'issued' and coalesce(old.wh->>'state','') is distinct from 'issued'
       and (new.payment_status not in ('paid','paid_cash')) then
      perform notif_emit('wh_issued_unpaid', new.id,
        'Выдан заказ без полной оплаты: ' || lbl,
        'Статус оплаты: ' || case new.payment_status when 'prepaid' then 'предоплата'
                                                     when 'confirmed' then 'подтверждён, не оплачен'
                                                     else 'не подтверждён' end ||
        ', остаток ' || notif_fmt_money(new.remaining_amount) || ' ₽. Выдал: ' || actor,
        'order:' || new.id);
    end if;
    -- Склад зафиксировал компенсацию/недостачу
    if coalesce(new.compensation_amount,0) > coalesce(old.compensation_amount,0)
       or ( (new.wh->'ret'->>'damage') is not null and (new.wh->'ret'->>'damage') <> ''
            and coalesce(old.wh->'ret'->>'damage','') = '' )
       or ( jsonb_array_length(coalesce(new.wh->'ret'->'missing','[]'::jsonb)) > 0
            and jsonb_array_length(coalesce(old.wh->'ret'->'missing','[]'::jsonb)) = 0 ) then
      perform notif_emit('wh_compensation', new.id,
        'Проблемы при возврате: заказ ' || lbl,
        trim(both '; ' from
          case when coalesce(new.compensation_amount,0) > 0
               then 'компенсация ' || notif_fmt_money(new.compensation_amount) || ' ₽ (' || coalesce(new.compensation_note,'без причины') || '); ' else '' end ||
          case when coalesce(new.wh->'ret'->>'damage','') <> '' then 'повреждения: ' || (new.wh->'ret'->>'damage') || '; ' else '' end ||
          case when jsonb_array_length(coalesce(new.wh->'ret'->'missing','[]'::jsonb)) > 0
               then 'недостача: ' || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(new.wh->'ret'->'missing') x) else '' end
        ) || '. Принял: ' || actor,
        'order:' || new.id);
    end if;
  end if;

  -- Нехватка/двойная бронь по позициям этого заказа (INSERT и UPDATE состава/дат)
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and
     (new.items is distinct from old.items or new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date or new.status is distinct from old.status)) then
    conflict_txt := '';
    for c in select * from notif_stock_conflicts(new.id) limit 5 loop
      conflict_txt := conflict_txt || '• ' || c.item_name || ': нужно ' || notif_fmt_money(c.need) ||
                      ', на складе ' || notif_fmt_money(c.have) || ' (' || to_char(c.day,'DD.MM') ||
                      ', заказов: ' || c.orders_cnt || ')' || E'\n';
    end loop;
    if conflict_txt <> '' then
      perform notif_emit('stock_conflict', new.id,
        'Нехватка товара: заказ ' || lbl,
        conflict_txt || 'Проверьте пересекающиеся заказы.',
        'order:' || new.id);
    end if;
  end if;

  return new;
exception when others then
  return case when tg_op = 'DELETE' then old else new end;  -- уведомления не должны ломать сохранение
end $$;

drop trigger if exists orders_notify on orders;
create trigger orders_notify
  after insert or update or delete on orders
  for each row execute function notif_on_order_change();

-- Журнал безопасности: пользователи/права/пароли
create or replace function notif_on_user_change()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare actor text;
begin
  actor := coalesce((select username from app_session_user()), 'система');
  if tg_op = 'INSERT' then
    perform notif_emit('team_users', new.username, 'Создан пользователь «' || new.username || '»',
      'Роль: ' || coalesce(new.role,'user') || '. Создал: ' || actor, null, actor);
  elsif tg_op = 'DELETE' then
    perform notif_emit('team_users', old.username, 'Удалён пользователь «' || old.username || '»',
      'Удалил: ' || actor, null, actor);
  elsif tg_op = 'UPDATE' then
    if new.password_hash is distinct from old.password_hash then
      perform notif_emit('team_users', new.username, 'Сменён пароль «' || new.username || '»',
        'Изменил: ' || actor, null, actor);
    end if;
    if new.role is distinct from old.role or new.perms is distinct from old.perms then
      perform notif_emit('team_users', new.username, 'Изменены права «' || new.username || '»',
        'Роль: ' || coalesce(new.role,'user') || '. Изменил: ' || actor, null, actor);
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
exception when others then
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists users_notify on users;
create trigger users_notify
  after insert or update or delete on users
  for each row execute function notif_on_user_change();

-- ── 7. Периодические правила ────────────────────────────────────────────────

-- Не оплачен к выдаче (сегодня/завтра)
create or replace function notif_rule_pay_overdue()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare o record; n int := 0;
begin
  for o in
    select * from orders
     where status <> 'completed'
       and payment_status in ('pending_confirmation','confirmed')
       and start_date between notif_today() - 7 and notif_today() + 1
  loop
    n := n + notif_emit('pay_overdue', o.id,
      case when o.start_date < notif_today() then 'Просрочена оплата: заказ ' else 'Не оплачен к выдаче: заказ ' end
        || notif_order_label(o),
      'Выдача ' || to_char(o.start_date,'DD.MM') || ', клиент ' || coalesce(o.client_name,'—') ||
      ', сумма ' || notif_fmt_money(o.order_amount) || ' ₽, статус «' ||
      case o.payment_status when 'confirmed' then 'Подтверждён' else 'На подтверждении' end || '»',
      'order:' || o.id);
  end loop;
  return n;
end $$;

-- Остаток по предоплаченному заказу
create or replace function notif_rule_pay_balance_due()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare o record; n int := 0;
begin
  for o in
    select * from orders
     where status <> 'completed' and payment_status = 'prepaid'
       and coalesce(remaining_amount,0) > 0
       and start_date between notif_today() and notif_today() + 2
  loop
    n := n + notif_emit('pay_balance_due', o.id,
      'Добрать остаток: заказ ' || notif_order_label(o),
      'Выдача ' || to_char(o.start_date,'DD.MM') || ', остаток ' || notif_fmt_money(o.remaining_amount) ||
      ' ₽ из ' || notif_fmt_money(o.order_amount) || ' ₽ (' || coalesce(o.client_name,'—') || ')',
      'order:' || o.id);
  end loop;
  return n;
end $$;

-- Возврат принят, а залог/компенсация не закрыты сутки+
create or replace function notif_rule_deposit_stuck()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare o record; n int := 0;
begin
  for o in
    select * from orders
     where (wh->>'state') = 'returned'
       and coalesce(wh->>'resolvedAt','') = ''
       and ((wh->>'returnedAt')::timestamptz) < now() - interval '24 hours'
       and ( deposit_status = 'deposited'
             or (coalesce(compensation_amount,0) > 0 and deposit_status = 'pending') )
  loop
    n := n + notif_emit('deposit_stuck', o.id,
      'Не закрыт вопрос по залогу: заказ ' || notif_order_label(o),
      trim(both ', ' from
        case when o.deposit_status = 'deposited' then 'залог «Внесён» — верните или удержите, ' else '' end ||
        case when coalesce(o.compensation_amount,0) > 0
             then 'компенсация ' || notif_fmt_money(o.compensation_amount) || ' ₽ не закрыта' else '' end) ||
      '. Карточка ждёт в колонке «Залог / Компенсация»',
      'order:' || o.id);
  end loop;
  return n;
end $$;

-- Сборка горит: выдача сегодня/просрочена, а не собрано
create or replace function notif_rule_assembly_overdue()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare o record; n int := 0;
begin
  for o in
    select * from orders
     where status <> 'completed'
       and payment_status in ('prepaid','paid','paid_cash')
       and coalesce(wh->>'state','todo') = 'todo'
       and start_date <= notif_today()
       and start_date >= notif_today() - 7
  loop
    n := n + notif_emit('assembly_overdue', o.id,
      case when o.start_date < notif_today() then 'Сборка просрочена: заказ ' else 'Собрать сегодня: заказ ' end
        || notif_order_label(o),
      'Выдача ' || to_char(o.start_date,'DD.MM') || ', позиций: ' || coalesce(jsonb_array_length(o.items),0) ||
      case when o.delivery_type = 'delivery' then ', доставка' else ', самовывоз' end,
      'order:' || o.id);
  end loop;
  return n;
end $$;

-- Аренда не возвращена
create or replace function notif_rule_return_overdue()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare o record; n int := 0;
begin
  for o in
    select * from orders
     where (wh->>'state') = 'issued'
       and end_date < notif_today()
       and end_date >= notif_today() - 14
  loop
    n := n + notif_emit('return_overdue', o.id,
      'Не возвращена аренда: заказ ' || notif_order_label(o),
      'Возврат ожидался ' || to_char(o.end_date,'DD.MM') || ' (' ||
      (notif_today() - o.end_date) || ' дн назад), клиент ' || coalesce(o.client_name,'—'),
      'order:' || o.id);
  end loop;
  return n;
end $$;

-- Утренняя сводка: каждому получателю — блоки по его допускам
create or replace function notif_rule_digest_daily()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare
  rcpt text; u users; body text; n int := 0; today date := notif_today();
  v_issue int; v_return int; v_assembly int; v_delivery int; v_setup int;
  v_unpaid int; v_deposit int; v_conflict int;
begin
  select count(*) into v_issue from orders where start_date = today and status <> 'completed';
  select count(*) into v_return from orders where end_date = today and (wh->>'state') = 'issued';
  select count(*) into v_assembly from orders
    where status <> 'completed' and payment_status in ('prepaid','paid','paid_cash')
      and coalesce(wh->>'state','todo') = 'todo' and start_date between today and today + 3;
  select count(*) into v_delivery from orders
    where start_date = today and delivery_type = 'delivery' and status <> 'completed';
  select count(*) into v_setup from orders
    where start_date = today and coalesce(setup_required,'no') <> 'no' and status <> 'completed';
  select count(*) into v_unpaid from orders
    where status <> 'completed' and payment_status in ('pending_confirmation','confirmed')
      and start_date between today - 7 and today + 1;
  select count(*) into v_deposit from orders
    where (wh->>'state') = 'returned' and coalesce(wh->>'resolvedAt','') = ''
      and (deposit_status = 'deposited' or coalesce(compensation_amount,0) > 0);
  select count(distinct item_name) into v_conflict from notif_stock_conflicts(null);

  for rcpt in select a from notif_audience('digest_daily') a loop
    select * into u from users where username = rcpt;
    body := '';
    if notif_user_can(u, 'orders', 'view') or notif_user_can(u, 'assembly', 'view') then
      body := body || 'Выдач: ' || v_issue || ', возвратов: ' || v_return ||
              ', в сборке на 3 дня: ' || v_assembly || E'\n';
      if v_delivery > 0 or v_setup > 0 then
        body := body || 'Доставок: ' || v_delivery || ', с монтажом: ' || v_setup || E'\n';
      end if;
    end if;
    if notif_user_can(u, 'orders', 'edit') then
      if v_unpaid > 0 then body := body || '⚠ Неоплаченных к выдаче: ' || v_unpaid || E'\n'; end if;
      if v_deposit > 0 then body := body || '⚠ Открытых залогов/компенсаций: ' || v_deposit || E'\n'; end if;
    end if;
    if v_conflict > 0 and (notif_user_can(u, 'orders', 'edit') or notif_user_can(u, 'assembly', 'view')) then
      body := body || '‼ Позиций с нехваткой на складе: ' || v_conflict || E'\n';
    end if;
    if trim(body) = '' then continue; end if;
    n := n + notif_emit('digest_daily', to_char(today,'YYYY-MM-DD'),
      'Сводка на ' || to_char(today,'DD.MM'), trim(trailing E'\n' from body),
      'page:warehouse', null, rcpt);
  end loop;
  return n;
end $$;

-- Понедельничный отчёт руководителю
create or replace function notif_rule_digest_weekly()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare
  rcpt text; n int := 0; d0 date := notif_today() - 7; d1 date := notif_today() - 1; body text;
  v_orders int; v_sum numeric; v_paid numeric; v_new_clients int; v_debt numeric;
  v_deposits int; v_comp numeric; v_next int;
begin
  select count(*), coalesce(sum(order_amount),0) into v_orders, v_sum
    from orders where created_at::date between d0 and d1;
  select coalesce(sum(order_amount),0) into v_paid
    from orders where payment_status in ('paid','paid_cash') and updated_at::date between d0 and d1;
  select count(*) into v_new_clients from clients where created_at::date between d0 and d1;
  select coalesce(sum(remaining_amount),0) into v_debt
    from orders where status <> 'completed' and payment_status not in ('paid','paid_cash');
  select count(*) into v_deposits
    from orders where (wh->>'state') = 'returned' and coalesce(wh->>'resolvedAt','') = ''
      and (deposit_status = 'deposited' or coalesce(compensation_amount,0) > 0);
  select coalesce(sum(compensation_amount),0) into v_comp
    from orders where coalesce(compensation_amount,0) > 0 and updated_at::date between d0 and d1;
  select count(*) into v_next
    from orders where status <> 'completed' and start_date between notif_today() and notif_today() + 7;

  body := 'Неделя ' || to_char(d0,'DD.MM') || '–' || to_char(d1,'DD.MM') || E':\n' ||
    'Новых заказов: ' || v_orders || ' на ' || notif_fmt_money(v_sum) || E' ₽\n' ||
    'Оплачено заказов на: ' || notif_fmt_money(v_paid) || E' ₽\n' ||
    'Новых клиентов: ' || v_new_clients || E'\n' ||
    'Дебиторка (не оплачено по активным): ' || notif_fmt_money(v_debt) || E' ₽\n' ||
    'Открытых залогов/компенсаций: ' || v_deposits ||
      case when v_comp > 0 then ' (компенсаций за неделю на ' || notif_fmt_money(v_comp) || ' ₽)' else '' end || E'\n' ||
    'Выдач на ближайшие 7 дней: ' || v_next;

  for rcpt in select a from notif_audience('digest_weekly') a loop
    n := n + notif_emit('digest_weekly', to_char(notif_today(),'IYYY-IW'),
      'Отчёт за неделю', body, 'page:crmdash', null, rcpt);
  end loop;
  return n;
end $$;

-- Клиентская база: уснувшие и без будущих заказов
create or replace function notif_rule_clients_digest()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare rcpt text; n int := 0; body text; part text;
begin
  -- Уснувшие: были заказы, но последний — 90+ дней назад (топ по обороту)
  select string_agg('• ' || c.name || coalesce(' (' || c.phone || ')','') ||
                    ' — последний заказ ' || to_char(c.last_d,'DD.MM.YY'), E'\n')
    into part
    from (
      select cl.name, cl.phone, max(o.start_date) as last_d,
             coalesce(sum(o.order_amount),0) as turnover
        from clients cl
        join orders o on o.client_id = cl.id or (o.client_name = cl.name and coalesce(o.client_phone,'') = coalesce(cl.phone,''))
       group by cl.id, cl.name, cl.phone
      having max(o.start_date) < notif_today() - 90
       order by turnover desc
       limit 10
    ) c;
  body := coalesce('Уснувшие клиенты (90+ дней без заказов):' || E'\n' || part || E'\n\n', '');

  -- Активные за полгода, но без будущих заказов на месяц
  select string_agg('• ' || c.name || coalesce(' (' || c.phone || ')',''), E'\n')
    into part
    from (
      select cl.name, cl.phone
        from clients cl
        join orders o on o.client_id = cl.id or (o.client_name = cl.name and coalesce(o.client_phone,'') = coalesce(cl.phone,''))
       group by cl.id, cl.name, cl.phone
      having max(o.start_date) between notif_today() - 180 and notif_today()
         and not bool_or(o.start_date > notif_today())
       order by max(o.start_date) desc
       limit 10
    ) c;
  if part is not null then
    body := body || 'Недавние клиенты без будущих заказов — повод написать:' || E'\n' || part;
  end if;

  if trim(body) = '' then return 0; end if;
  for rcpt in select a from notif_audience('clients_digest') a loop
    n := n + notif_emit('clients_digest', to_char(notif_today(),'YYYY-MM-DD'),
      'Работа с базой: кому напомнить о себе', trim(body), 'page:clients', null, rcpt);
  end loop;
  return n;
end $$;

-- ── 8. Планировщик: один тик решает, чьё время пришло ───────────────────────

create or replace function notif_should_run(p_type text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare
  t notif_types; r notif_runs; tz text; loc timestamp; today date;
  dt time; period int;
begin
  select * into t from notif_types where key = p_type;
  if t.key is null or not t.enabled then return false; end if;
  select * into r from notif_runs where type_key = p_type;
  tz := coalesce(notif_setting('timezone'),'Europe/Moscow');
  loc := now() at time zone tz;         -- локальное время (timestamp БЕЗ зоны — важно)
  today := loc::date;
  dt := coalesce(nullif(notif_setting('digest_time'),'')::time, '09:00'::time);

  if t.schedule = 'hourly' then
    return r.last_run is null or r.last_run < now() - interval '55 minutes';
  elsif t.schedule = 'daily' then
    return loc::time >= dt and (r.last_run is null or (r.last_run at time zone tz)::date < today);
  elsif t.schedule = 'every3days' then
    period := coalesce(nullif(notif_setting('clients_period'),'')::int, 3);
    return loc::time >= dt
       and (r.last_run is null or (r.last_run at time zone tz)::date <= today - period);
  elsif t.schedule = 'weekly' then
    return extract(isodow from loc) = coalesce(nullif(notif_setting('weekly_dow'),'')::int, 1)
       and loc::time >= dt and (r.last_run is null or (r.last_run at time zone tz)::date < today);
  end if;
  return false;  -- instant запускают триггеры
end $$;

create or replace function notif_tick()
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare t record; cnt int; total int := 0; report text := '';
begin
  if coalesce(notif_setting('enabled'),'true') <> 'true' then return 'выключено'; end if;
  for t in select * from notif_types where schedule <> 'instant' and enabled order by sort loop
    if not notif_should_run(t.key) then continue; end if;
    begin
      cnt := case t.key
        when 'pay_overdue'      then notif_rule_pay_overdue()
        when 'pay_balance_due'  then notif_rule_pay_balance_due()
        when 'deposit_stuck'    then notif_rule_deposit_stuck()
        when 'assembly_overdue' then notif_rule_assembly_overdue()
        when 'return_overdue'   then notif_rule_return_overdue()
        when 'digest_daily'     then notif_rule_digest_daily()
        when 'digest_weekly'    then notif_rule_digest_weekly()
        when 'clients_digest'   then notif_rule_clients_digest()
        else 0 end;
      insert into notif_runs (type_key, last_run, last_count, last_error)
      values (t.key, now(), cnt, null)
      on conflict (type_key) do update set last_run = now(), last_count = excluded.last_count, last_error = null;
      total := total + cnt;
      report := report || t.key || ':' || cnt || ' ';
    exception when others then
      insert into notif_runs (type_key, last_run, last_count, last_error)
      values (t.key, now(), 0, sqlerrm)
      on conflict (type_key) do update set last_run = now(), last_error = sqlerrm;
    end;
  end loop;
  perform notif_dispatch_queue();
  return coalesce(nullif(report,''), 'тихо') || '→ ' || total;
end $$;

-- Поллинг Telegram: привязка аккаунтов по коду (двухфазно из-за асинхронного pg_net)
create or replace function notif_tg_poll()
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare
  st notif_tg_state; token text; resp record; upd jsonb; u jsonb;
  chat text; msg text; code text; uname text; req bigint;
begin
  token := notif_setting('tg_bot_token');
  if coalesce(token,'') = '' then return 'нет токена'; end if;
  select * into st from notif_tg_state where id = 1;

  -- Фаза 2: пришёл ли ответ на прошлый запрос
  if st.pending_req is not null then
    select * into resp from net._http_response where id = st.pending_req;
    -- Ответа нет (ещё в пути или pg_net его уже почистил) — не зависаем:
    -- сбрасываем ожидание, новый запрос уйдёт ниже. Дубль безвреден (offset).
    update notif_tg_state set pending_req = null where id = 1;
    if resp.id is null then return 'ответа нет — перезапрошу'; end if;
    if resp.status_code = 200 and (resp.content::jsonb->>'ok') = 'true' then
      for upd in select * from jsonb_array_elements(resp.content::jsonb->'result') loop
        update notif_tg_state set last_update_id = greatest(last_update_id, (upd->>'update_id')::bigint) where id = 1;
        u := upd->'message';
        chat := u->'chat'->>'id';
        msg := coalesce(u->>'text','');
        code := upper(trim(replace(replace(msg,'/start',''),' ','')));
        if chat is null or code = '' then continue; end if;
        select username into uname from notif_contacts where upper(coalesce(tg_link_code,'')) = code and coalesce(tg_chat_id,'') = '';
        if uname is not null then
          update notif_contacts set tg_chat_id = chat, tg_link_code = null, updated_at = now() where username = uname;
          perform net.http_post(
            url := 'https://api.telegram.org/bot' || token || '/sendMessage',
            body := jsonb_build_object('chat_id', chat, 'text', 'Готово! Уведомления Radar для «' || uname || '» подключены.'),
            headers := '{"Content-Type":"application/json"}'::jsonb);
        end if;
      end loop;
    end if;
  end if;

  -- Фаза 1: спросить новые сообщения
  select * into st from notif_tg_state where id = 1;
  select net.http_get('https://api.telegram.org/bot' || token || '/getUpdates?timeout=0&offset=' || (st.last_update_id + 1))
    into req;
  update notif_tg_state set pending_req = req where id = 1;
  return 'ok';
exception when others then
  return 'error: ' || sqlerrm;
end $$;

-- Задания pg_cron (идемпотентно: старые снимаем, ставим заново)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('radar_notif_tick','radar_notif_tg');
  perform cron.schedule('radar_notif_tick', '*/10 * * * *', 'select notif_tick()');
  perform cron.schedule('radar_notif_tg',   '* * * * *',    'select notif_tg_poll()');
end $$;

-- ── 9. RPC для приложения (доступ только по токену сессии) ──────────────────

create or replace function app_notif_feed(p_limit int default 50)
returns json language plpgsql stable security definer set search_path = public, extensions
as $$
declare me users; items json;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  select coalesce(json_agg(row_to_json(x)), '[]'::json) into items from (
    select id, type_key, entity, title, body, link, severity, created_at, read_at
      from notifications where username = me.username
     order by created_at desc limit least(greatest(coalesce(p_limit,50),1),200)
  ) x;
  return json_build_object('items', items,
    'unread', (select count(*) from notifications where username = me.username and read_at is null));
end $$;

create or replace function app_notif_mark_read(p_ids uuid[] default null)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users; n int;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  update notifications set read_at = now()
   where username = me.username and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'marked', n);
end $$;

-- Настройки пользователя: типы, доступные его допускам + личные предпочтения
create or replace function app_notif_prefs_get()
returns json language plpgsql stable security definer set search_path = public, extensions
as $$
declare me users; types json; contacts json;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  select coalesce(json_agg(row_to_json(x) order by x.sort), '[]'::json) into types from (
    select t.key, t.category, t.title, t.descr, t.severity, t.schedule, t.digest,
           t.default_channels, t.sort, t.enabled as global_enabled,
           coalesce(p.enabled, true) as enabled, coalesce(p.channels, t.default_channels) as channels
      from notif_types t
      left join notif_prefs p on p.type_key = t.key and p.username = me.username
     where exists (select 1 from notif_audience(t.key) a where a = me.username)
  ) x;
  select row_to_json(c) into contacts from (
    select coalesce(tg_chat_id,'') <> '' as tg_linked, tg_link_code, coalesce(email,'') as email
      from notif_contacts where username = me.username
  ) c;
  return json_build_object('types', types, 'contacts', coalesce(contacts, '{}'::json),
    'tg_bot', coalesce(notif_setting('tg_bot_name'),''),
    'tg_ready', coalesce(notif_setting('tg_bot_token'),'') <> '');
end $$;

create or replace function app_notif_prefs_set(p_type text, p_enabled boolean, p_channels text[] default null)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  insert into notif_prefs (username, type_key, enabled, channels)
  values (me.username, p_type, coalesce(p_enabled,true), p_channels)
  on conflict (username, type_key) do update set enabled = excluded.enabled, channels = excluded.channels;
  return json_build_object('ok', true);
end $$;

create or replace function app_notif_contacts_set(p_email text default null)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  insert into notif_contacts (username, email) values (me.username, nullif(trim(p_email),''))
  on conflict (username) do update set email = nullif(trim(p_email),''), updated_at = now();
  return json_build_object('ok', true);
end $$;

-- Код привязки Telegram: пользователь шлёт его боту, notif_tg_poll связывает
create or replace function app_notif_tg_code()
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users; code text;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  code := upper(substr(md5(random()::text), 1, 6));
  insert into notif_contacts (username, tg_link_code) values (me.username, code)
  on conflict (username) do update set tg_link_code = excluded.tg_link_code, tg_chat_id = null, updated_at = now();
  return json_build_object('ok', true, 'code', code,
    'bot', coalesce(notif_setting('tg_bot_name'),''),
    'ready', coalesce(notif_setting('tg_bot_token'),'') <> '');
end $$;

-- Администратор: глобальные настройки и здоровье системы
create or replace function app_notif_admin_get()
returns json language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  return json_build_object(
    'settings', (select json_object_agg(key, case when key in ('tg_bot_token','resend_key')
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
              where jobname in ('radar_notif_tick','radar_notif_tg')));
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
               'tg_bot_token','tg_bot_name','resend_key','email_from') then
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

-- Тест: отправить себе пробное уведомление по всем настроенным каналам
create or replace function app_notif_test()
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare me users; r1 text; r2 text;
begin
  select * into me from app_session_user();
  if me.username is null then return json_build_object('error','Нет сессии'); end if;
  insert into notifications (username, type_key, title, body, severity)
  values (me.username, 'digest_daily', 'Проверка уведомлений',
          'Если вы это видите — лента работает. Время: ' ||
          to_char(now() at time zone coalesce(notif_setting('timezone'),'Europe/Moscow'), 'DD.MM HH24:MI'), 'info');
  r1 := notif_send_telegram(me.username, 'Проверка уведомлений Radar', 'Telegram подключён и работает.');
  r2 := notif_send_email(me.username, 'Проверка уведомлений Radar', 'Email подключён и работает.');
  return json_build_object('ok', true, 'telegram', coalesce(r1,'отправлено'), 'email', coalesce(r2,'отправлено'));
end $$;

-- Запустить обработку немедленно (кнопка администратора)
create or replace function app_notif_run_now()
returns json language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  return json_build_object('ok', true, 'result', notif_tick());
end $$;

-- Права: анониму — только вход в RPC (внутри всё проверяет сессия)
revoke all on function notif_setting, notif_today, notif_user_can, notif_audience,
  notif_recently_sent, notif_user_channels, notif_send_telegram, notif_send_email,
  notif_dispatch_queue, notif_emit, notif_stock_conflicts, notif_tick, notif_tg_poll,
  notif_should_run, notif_rule_pay_overdue, notif_rule_pay_balance_due,
  notif_rule_deposit_stuck, notif_rule_assembly_overdue, notif_rule_return_overdue,
  notif_rule_digest_daily, notif_rule_digest_weekly, notif_rule_clients_digest
  from public, anon;
grant execute on function app_notif_feed(int), app_notif_mark_read(uuid[]),
  app_notif_prefs_get(), app_notif_prefs_set(text,boolean,text[]),
  app_notif_contacts_set(text), app_notif_tg_code(),
  app_notif_admin_get(), app_notif_admin_set(jsonb,jsonb),
  app_notif_test(), app_notif_run_now() to anon;

-- ── Проверка: 17 типов, 2 cron-задания ──────────────────────────────────────
select (select count(*) from notif_types) as типов_уведомлений,
       (select count(*) from cron.job where jobname like 'radar_notif%') as cron_заданий;
