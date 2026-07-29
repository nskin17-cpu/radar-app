-- ============================================================================
-- Radar NR — ИСПРАВЛЕНИЕ + ПЕРВЫЙ АДМИНИСТРАТОР
--
-- ПОЧЕМУ: в Supabase расширение pgcrypto живёт в схеме extensions, а функции
-- были ограничены схемой public — поэтому gen_salt() не нашёлся и админ
-- не создался. Здесь функции пересозданы с правильным search_path.
--
-- ЧТО ДЕЛАТЬ:
--   1. Замените 'admin' и 'ПРИДУМАЙТЕ_ПАРОЛЬ' в САМОЙ ПОСЛЕДНЕЙ строке файла.
--      Пароль — не короче 8 символов, запишите его.
--   2. Выполните файл целиком.
--   3. Ждём ответ {"ok": true, ...} — после этого сразу зайдите в приложение.
--
-- Ничего не удаляет, повторный запуск безопасен.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

create or replace function app_bootstrap_admin(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions
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
language plpgsql security definer set search_path = public, extensions
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

create or replace function app_create_user(p_username text, p_password text,
                                           p_role text, p_perms jsonb, p_role_label text)
returns json
language plpgsql security definer set search_path = public, extensions
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
language plpgsql security definer set search_path = public, extensions
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

-- ============================================================================
-- ЗАМЕНИТЕ ЛОГИН И ПАРОЛЬ В СТРОКЕ НИЖЕ
-- ============================================================================
select app_bootstrap_admin('admin', 'ПРИДУМАЙТЕ_ПАРОЛЬ');
