-- ============================================================================
-- Radar NR — ШАГ 5 (после шагов 1–4): доска склада «Сборка → Выдача → Возврат».
--
-- ЧТО ДЕЛАЕТ:
--   1. Колонка orders.wh — складское состояние заказа (чек-лист сборки,
--      кто и когда собрал/выдал/принял возврат, залог при выдаче,
--      компенсации, комментарии кладовщика).
--   2. Новая зона допуска «assembly» (Выдача заказов): сотрудник склада
--      с этим допуском видит заказы и цены (для печати акта), но менять
--      может ТОЛЬКО складские поля — это следит серверный триггер,
--      обойти его из браузера нельзя.
--
-- БЕЗОПАСНО: ничего не удаляет, повторный запуск не вредит.
--            Для пользователей без допуска «assembly» ничего не меняется.
-- ============================================================================

-- ── 1. Складское состояние заказа ──────────────────────────────────────────
alter table orders add column if not exists wh jsonb;

-- ── 2. Чтение: заказы и цены видны и складскому допуску ────────────────────
-- (цены нужны, чтобы акт печатался с суммами; сами таблицы клиентов,
--  аналитики и т.п. складскому по-прежнему закрыты)
drop policy if exists radar_read on orders;
create policy radar_read on orders for select
  using (app_can('orders','view') or app_can('assembly','view'));

drop policy if exists radar_read on pricing_config;
create policy radar_read on pricing_config for select
  using (app_can('stock','view') or app_can('orders','view') or app_can('assembly','view'));

-- ── 3. Запись: складскому допуску — только UPDATE заказов ──────────────────
-- Создавать и удалять заказы склад не может (radar_write остаётся как есть
-- и требует допуск «orders: edit»).
drop policy if exists radar_wh_update on orders;
create policy radar_wh_update on orders for update
  using (app_can('assembly','edit'))
  with check (app_can('assembly','edit'));

-- ── 4. Серверный предохранитель: какие поля может менять склад ─────────────
-- Даже если из браузера пришлют «отредактированный» запрос, база отклонит
-- изменение любых полей, кроме складских: wh, статус работы, залог,
-- компенсация и журнал изменений.
create or replace function app_orders_wh_guard()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  allowed text[] := array['wh','status','deposit_status','deposit_amount',
                          'compensation_amount','compensation_note',
                          'change_log','updated_at'];
  a jsonb; b jsonb; k text;
begin
  -- Прямая работа с базой (SQL Editor, миграции) — без ограничений:
  -- предохранитель нужен только против запросов из браузера через API.
  if current_setting('request.headers', true) is null then return new; end if;
  -- Полный допуск к заказам — ограничений нет
  if app_can('orders','edit') then return new; end if;
  a := to_jsonb(old); b := to_jsonb(new);
  for k in select distinct key from (
    select jsonb_object_keys(a) as key union all select jsonb_object_keys(b)
  ) keys loop
    if not (k = any(allowed)) and (a -> k) is distinct from (b -> k) then
      raise exception 'Складской допуск не позволяет менять поле «%»', k;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists orders_wh_guard on orders;
create trigger orders_wh_guard
  before update on orders
  for each row execute function app_orders_wh_guard();

-- ── Проверка: у orders должны быть политики radar_read/radar_write/radar_wh_update,
--    у pricing_config — radar_read/radar_write ───────────────────────────────
select tablename, policyname
  from pg_policies
 where schemaname = 'public' and tablename in ('orders','pricing_config')
 order by tablename, policyname;
