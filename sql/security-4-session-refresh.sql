-- ============================================================================
-- Radar NR — ШАГ 4 (дополнительный, после шагов 1–3): вход без пароля навсегда.
--
-- ЧТО ДЕЛАЕТ: добавляет функцию app_session_refresh(). Приложение зовёт её
--             при каждом запуске: живой токен продлевается ещё на 14 дней.
--             Пока приложением пользуются хотя бы раз в две недели, пароль
--             не спросят никогда — только после выхода вручную, смены пароля
--             или 14 дней полного бездействия.
--             Заодно при каждом запуске подтягиваются актуальные права:
--             изменённые допуски применяются при следующем открытии,
--             а не когда сессия истечёт.
-- БЕЗОПАСНО:  ничего не удаляет, повторный запуск не вредит.
--             Без этого файла приложение работает как раньше — просто
--             сессия живёт ровно 14 дней от входа, без продления.
-- ============================================================================

create or replace function app_session_refresh()
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare u users;
begin
  select * into u from app_session_user();
  -- Токена нет, он истёк или его стёрла смена пароля / удаление пользователя.
  -- Приложение по этому ответу показывает экран входа, а не пустые данные.
  if u.username is null then
    return json_build_object('error','Сессия истекла','code','no-session');
  end if;
  update app_sessions
     set expires_at = now() + interval '14 days'
   where token = nullif(current_setting('request.headers', true)::json ->> 'x-radar-token','')::uuid;
  delete from app_sessions where expires_at < now();   -- заодно чистим протухшие
  return json_build_object('ok', true, 'username', u.username, 'role', u.role,
                           'perms', u.perms, 'roleLabel', u.role_label);
end $$;

revoke all on function app_session_refresh() from public;
grant execute on function app_session_refresh() to anon;

-- ── Проверка: должна вернуться одна строка app_session_refresh ─────────────
select proname as создано_функций
  from pg_proc
 where proname = 'app_session_refresh';
