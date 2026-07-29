-- ============================================================================
-- Radar NR — ШАГ 1 из 3: подготовка защиты
--
-- ЧТО ДЕЛАЕТ: создаёт таблицу сессий, функции входа и проверки прав,
--             колонки допусков. Доступ к данным НЕ меняет — после этого
--             файла приложение работает ровно как сейчас.
-- БЕЗОПАСНО:  ничего не удаляет, повторный запуск не вредит.
--
-- Выполните целиком, затем переходите к файлу security-2-admin.sql
-- ============================================================================

-- ── ШАГ 1. Расширения и таблицы ────────────────────────────────────────────
create extension if not exists pgcrypto;

alter table users add column if not exists perms      jsonb;
alter table users add column if not exists role_label text;

create table if not exists app_sessions (
  token      uuid primary key default gen_random_uuid(),
  username   text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);
create index if not exists app_sessions_username_idx on app_sessions (username);
create index if not exists app_sessions_expires_idx  on app_sessions (expires_at);

-- ── ШАГ 2. Кто спрашивает и что ему можно ──────────────────────────────────

-- Пользователь текущего запроса: по токену из заголовка. NULL — не вошёл.
create or replace function app_session_user()
returns users
language sql stable security definer set search_path = public
as $$
  select u.*
    from app_sessions s
    join users u on u.username = s.username
   where s.token = nullif(current_setting('request.headers', true)::json ->> 'x-radar-token','')::uuid
     and s.expires_at > now()
   limit 1;
$$;

create or replace function app_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role from app_session_user()) = 'admin', false); $$;

-- Допуск на раздел: area = orders|clients|stock|dashboards|competitors,
-- need = 'view' | 'edit'. Админ может всё. perms = NULL — полный доступ
-- (учётка заведена до появления допусков; поведение прежнее).
create or replace function app_can(area text, need text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare u users; lvl text;
begin
  select * into u from app_session_user();
  if u.username is null then return false; end if;
  if u.role = 'admin' then return true; end if;
  if u.perms is null then return true; end if;
  lvl := u.perms ->> area;
  if lvl = 'edit' then return true; end if;
  if lvl = 'view' and need = 'view' then return true; end if;
  return false;
end $$;

-- ── ШАГ 3. Вход, выход, управление пользователями ──────────────────────────

-- Первый администратор. Работает ТОЛЬКО пока таблица пользователей пуста —
-- поэтому её нельзя использовать как чёрный ход.
create or replace function app_bootstrap_admin(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from users) then
    return json_build_object('error','Пользователи уже есть — используйте app_create_user');
  end if;
  if length(coalesce(p_password,'')) < 8 then
    return json_build_object('error','Пароль должен быть не короче 8 символов');
  end if;
  insert into users (username, password_hash, role, role_label)
  values (p_username, crypt(p_password, gen_salt('bf', 10)), 'admin', 'Администратор');
  return json_build_object('ok', true, 'username', p_username);
end $$;

create or replace function app_login(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public
as $$
declare u users; t uuid;
begin
  select * into u from users where username = p_username;
  -- Логина ещё нет: это НЕ «неверный пароль». Приложение по такому ответу
  -- уходит на прежний путь входа, поэтому между шагами 1 и 2 никто не заперт.
  if u.username is null then
    return json_build_object('error','Пользователь не найден', 'code', 'not-found');
  end if;
  if u.password_hash is null or crypt(p_password, u.password_hash) <> u.password_hash then
    return json_build_object('error','Неверный логин или пароль', 'code', 'bad-password');
  end if;
  delete from app_sessions where expires_at < now();          -- чистим протухшие
  insert into app_sessions (username) values (u.username) returning token into t;
  return json_build_object('token', t, 'username', u.username,
                           'role', u.role, 'perms', u.perms, 'roleLabel', u.role_label);
end $$;

create or replace function app_logout()
returns void
language sql security definer set search_path = public
as $$
  delete from app_sessions
   where token = nullif(current_setting('request.headers', true)::json ->> 'x-radar-token','')::uuid;
$$;

create or replace function app_list_users()
returns table (id uuid, username text, role text, perms jsonb, role_label text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select u.id, u.username, u.role, u.perms, u.role_label, u.created_at
    from users u where app_is_admin() order by u.username;
$$;

create or replace function app_create_user(p_username text, p_password text,
                                           p_role text, p_perms jsonb, p_role_label text)
returns json
language plpgsql security definer set search_path = public
as $$
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  if length(coalesce(p_password,'')) < 8 then
    return json_build_object('error','Пароль должен быть не короче 8 символов');
  end if;
  insert into users (username, password_hash, role, perms, role_label)
  values (p_username, crypt(p_password, gen_salt('bf', 10)),
          case when p_role = 'admin' then 'admin' else 'user' end, p_perms, p_role_label)
  on conflict (username) do update
     set password_hash = excluded.password_hash, role = excluded.role,
         perms = excluded.perms, role_label = excluded.role_label;
  return json_build_object('ok', true);
end $$;

create or replace function app_set_password(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public
as $$
begin
  -- свой пароль может менять каждый, чужой — только администратор
  if not app_is_admin() and p_username is distinct from (select username from app_session_user()) then
    return json_build_object('error','Только администратор');
  end if;
  if length(coalesce(p_password,'')) < 8 then
    return json_build_object('error','Пароль должен быть не короче 8 символов');
  end if;
  update users set password_hash = crypt(p_password, gen_salt('bf', 10)) where username = p_username;
  if not found then return json_build_object('error','Пользователь не найден'); end if;
  delete from app_sessions where username = p_username;   -- разлогинить везде
  return json_build_object('ok', true);
end $$;

create or replace function app_set_perms(p_username text, p_role text, p_perms jsonb, p_role_label text)
returns json
language plpgsql security definer set search_path = public
as $$
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  update users set role = case when p_role = 'admin' then 'admin' else 'user' end,
                    perms = p_perms, role_label = p_role_label
   where username = p_username;
  if not found then return json_build_object('error','Пользователь не найден'); end if;
  return json_build_object('ok', true);
end $$;

create or replace function app_delete_user(p_username text)
returns json
language plpgsql security definer set search_path = public
as $$
begin
  if not app_is_admin() then return json_build_object('error','Только администратор'); end if;
  if p_username = (select username from app_session_user()) then
    return json_build_object('error','Нельзя удалить самого себя');
  end if;
  delete from app_sessions where username = p_username;
  delete from users where username = p_username;
  return json_build_object('ok', true);
end $$;

-- ── ШАГ 4. Права на выполнение ─────────────────────────────────────────────
-- Аноним может только позвать функции; сами таблицы — через политики ниже.
revoke all on function app_session_user, app_is_admin, app_can from public, anon;
grant execute on function app_login(text,text), app_bootstrap_admin(text,text) to anon;
grant execute on function app_logout(), app_list_users(),
                          app_create_user(text,text,text,jsonb,text),
                          app_set_password(text,text),
                          app_set_perms(text,text,jsonb,text),
                          app_delete_user(text) to anon;
grant execute on function app_can(text,text) to anon;   -- нужен политикам

-- Таблицы сессий и пользователей снаружи не видны вообще
alter table app_sessions enable row level security;
revoke all on table app_sessions from anon, authenticated;
revoke all on table users        from anon, authenticated;

-- ── Проверка: должно вернуть 8 строк с именами функций app_* ───────────────
select proname as создано_функций
  from pg_proc
 where proname like 'app\_%'
 order by proname;
