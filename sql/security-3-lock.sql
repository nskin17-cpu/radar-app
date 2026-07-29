-- ============================================================================
-- Radar NR — ШАГ 3 из 3: ЗАКРЫТЬ ДВЕРИ
--
-- ВЫПОЛНЯТЬ ТОЛЬКО ПОСЛЕ ТОГО, как вы вошли в приложение под администратором,
-- созданным в security-2-admin.sql. Иначе останетесь без доступа к данным.
--
-- ЧТО ДЕЛАЕТ: убирает политику "Allow all for anon" со всех таблиц и ставит
--             проверку по токену сессии и допускам пользователя.
--             После этого публичный ключ сам по себе не даёт ничего.
--
-- ЕСЛИ ЧТО-ТО ПОШЛО НЕ ТАК: выполните security-rollback.sql — вернёт как было.
-- ============================================================================

do $$
declare t text; areas jsonb := '{
  "orders":       {"read":"orders",      "write":"orders"},
  "clients":      {"read":"clients",     "write":"clients"},
  "stock":        {"read":"stock",       "write":"stock"},
  "categories":   {"read":"stock",       "write":"stock"},
  "pricing_config":{"read":"stock",      "write":"stock"},
  "competitors":  {"read":"competitors", "write":"competitors"},
  "my_company":   {"read":"competitors", "write":"competitors"},
  "history":      {"read":"competitors", "write":"competitors"},
  "history_log":  {"read":"competitors", "write":"competitors"}
}'::jsonb;
begin
  for t in select jsonb_object_keys(areas) loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Allow all for anon" on %I', t);
    execute format('drop policy if exists radar_read on %I', t);
    execute format('drop policy if exists radar_write on %I', t);
    -- Склад, категории, цены и клиентов должен читать и тот, кто ведёт заказы:
    -- без справочников форма заказа не соберётся.
    execute format(
      'create policy radar_read on %I for select using (app_can(%L,''view'') or (%L and app_can(''orders'',''view'')))',
      t, areas -> t ->> 'read',
      (areas -> t ->> 'read') in ('stock','clients'));
    execute format(
      'create policy radar_write on %I for all using (app_can(%L,''edit'')) with check (app_can(%L,''edit''))',
      t, areas -> t ->> 'write', areas -> t ->> 'write');
  end loop;
end $$;

-- ── Проверка ───────────────────────────────────────────────────────────────
select tablename,
       count(*) filter (where policyname = 'radar_read')  as политика_чтения,
       count(*) filter (where policyname = 'radar_write') as политика_записи,
       count(*) filter (where policyname = 'Allow all for anon') as осталось_открытых
  from pg_policies
 where schemaname = 'public'
 group by tablename
 order by tablename;

-- ── Проверка ───────────────────────────────────────────────────────────────
-- В колонке «осталось_открытых» везде должен быть 0.
select tablename,
       count(*) filter (where policyname = 'radar_read')  as политика_чтения,
       count(*) filter (where policyname = 'radar_write') as политика_записи,
       count(*) filter (where policyname = 'Allow all for anon') as осталось_открытых
  from pg_policies
 where schemaname = 'public'
 group by tablename
 order by tablename;
