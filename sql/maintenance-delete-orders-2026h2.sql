-- ============================================================================
-- Radar NR — РАЗОВАЯ ОПЕРАЦИЯ: удаление заказов с 06.06.2026 по 31.12.2026.
--
-- Заказы до 06.06.2026 НЕ ТРОГАЮТСЯ.
-- Отбор идёт по дате выдачи (start_date) — именно по ней заказы живут в CRM
-- и на доске склада.
--
-- ВЫПОЛНЯТЬ ПО ШАГАМ, а не весь файл целиком:
--   ШАГ 1 — посмотреть, что попадёт под удаление (ничего не меняет);
--   ШАГ 2 — резервная копия (после неё удаление можно отменить);
--   ШАГ 3 — само удаление;
--   ШАГ 4 — проверка.
-- Шаг 5 (откат) и шаг 6 (удаление копии) — только если понадобятся.
-- ============================================================================


-- ── ШАГ 1. ЧТО БУДЕТ УДАЛЕНО (только смотрим) ──────────────────────────────
-- Выделите этот блок и нажмите Run.

select count(*)                        as всего_заказов,
       min(start_date)                 as самая_ранняя_выдача,
       max(start_date)                 as самая_поздняя_выдача,
       sum(order_amount)               as сумма_заказов,
       count(*) filter (where status <> 'completed')          as незавершённых,
       count(*) filter (where (wh->>'state') = 'issued')      as на_руках_у_клиентов
  from orders
 where start_date >= date '2026-06-06'
   and start_date <= date '2026-12-31';

-- Разбивка по месяцам — чтобы увидеть масштаб
select to_char(start_date, 'YYYY-MM') as месяц,
       count(*)                       as заказов,
       sum(order_amount)              as сумма
  from orders
 where start_date >= date '2026-06-06'
   and start_date <= date '2026-12-31'
 group by 1 order by 1;

-- Заказы БЕЗ даты выдачи под удаление НЕ попадают. Проверьте, что их нет:
select count(*) as заказов_без_даты from orders where start_date is null;


-- ── ШАГ 2. РЕЗЕРВНАЯ КОПИЯ ─────────────────────────────────────────────────
-- Создаёт таблицу orders_backup_20260730 с полными копиями удаляемых строк.
-- Пока эта таблица существует, удаление обратимо (см. ШАГ 5).

create table if not exists orders_backup_20260730 as
select * from orders
 where start_date >= date '2026-06-06'
   and start_date <= date '2026-12-31';

alter table orders_backup_20260730 enable row level security;   -- снаружи не видна

select count(*) as строк_в_копии from orders_backup_20260730;
-- ⚠ Число должно совпасть с «всего_заказов» из ШАГА 1. Если нет — не продолжайте.


-- ── ШАГ 3. УДАЛЕНИЕ ────────────────────────────────────────────────────────
-- Триггер уведомлений на время операции выключается: иначе каждый удалённый
-- заказ выпустит уведомление «Заказ удалён» — сотни пушей и записей в ленте.

begin;

alter table orders disable trigger orders_notify;

delete from orders
 where start_date >= date '2026-06-06'
   and start_date <= date '2026-12-31';

alter table orders enable trigger orders_notify;

commit;


-- ── ШАГ 4. ПРОВЕРКА ────────────────────────────────────────────────────────

select count(*) as осталось_в_периоде
  from orders
 where start_date >= date '2026-06-06' and start_date <= date '2026-12-31';
-- Должно быть 0.

select count(*)        as заказов_до_06_06,
       min(start_date) as самый_ранний,
       max(start_date) as самый_поздний
  from orders;
-- «самый_поздний» должен быть не позднее 05.06.2026.


-- ── ШАГ 5. ОТКАТ (только если удалили лишнее) ──────────────────────────────
-- Возвращает заказы из резервной копии. Уведомления при этом не выпускаются.

-- begin;
-- alter table orders disable trigger orders_notify;
-- insert into orders select * from orders_backup_20260730
--   on conflict (id) do nothing;
-- alter table orders enable trigger orders_notify;
-- commit;
-- select count(*) as восстановлено from orders
--  where start_date >= date '2026-06-06' and start_date <= date '2026-12-31';


-- ── ШАГ 6. УДАЛИТЬ КОПИЮ (когда убедитесь, что всё верно) ──────────────────
-- Пока не выполните — данные можно вернуть шагом 5. Спешить не нужно.

-- drop table orders_backup_20260730;
