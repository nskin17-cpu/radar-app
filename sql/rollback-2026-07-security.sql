-- ============================================================================
-- Radar NR — ОТКАТ защиты базы.
--
-- Выполните, если после закрытия дверей приложение перестало работать
-- и нужно срочно вернуть доступ. Данные не трогает — только политики.
--
-- ВНИМАНИЕ: после отката база снова открыта всему интернету.
-- Это аварийная мера, а не рабочее состояние.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['orders','clients','stock','categories','pricing_config',
                           'competitors','my_company','history','history_log']
  loop
    execute format('drop policy if exists radar_read on %I', t);
    execute format('drop policy if exists radar_write on %I', t);
    execute format('drop policy if exists "Allow all for anon" on %I', t);
    execute format('create policy "Allow all for anon" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- Вернуть доступ к таблицам пользователей и сессий (для отладки)
grant all on table users        to anon;
grant all on table app_sessions to anon;

select tablename, policyname from pg_policies
 where schemaname = 'public' order by tablename;
