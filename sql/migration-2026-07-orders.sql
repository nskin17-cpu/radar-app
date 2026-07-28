-- ============================================================================
-- Radar NR — миграция под единую модель заказа (июль 2026)
--
-- Выполнить один раз в SQL Editor панели Supabase.
-- Все операции идемпотентны: повторный запуск безопасен.
--
-- Приложение работает и БЕЗ этой миграции — слой данных сам определяет,
-- каких колонок нет, и не пытается их писать. Но поля «зона доставки»,
-- «км за город», «доп. услуга», «история изменений» и «номер заказа»
-- сохраняться не будут, пока миграция не применена.
-- ============================================================================

-- ── 1. Недостающие колонки заказов ─────────────────────────────────────────
-- Эти поля приложение отправляло, а таблица их не имела: PostgREST молча
-- отбрасывал их при upsert. Отсюда «сохранилось частично».
alter table orders add column if not exists order_number          text;
alter table orders add column if not exists delivery_zone         text    default 'city';
alter table orders add column if not exists delivery_km           numeric default 0;
alter table orders add column if not exists extra_charge_amount   numeric default 0;
alter table orders add column if not exists extra_charge_note     text;
alter table orders add column if not exists items_total           numeric default 0;
alter table orders add column if not exists client_id             text;
alter table orders add column if not exists change_log            jsonb   default '[]'::jsonb;

-- ── 2. Недостающие колонки клиентов ────────────────────────────────────────
-- Город и комментарий появились в интерфейсе, но не в таблице.
alter table clients add column if not exists city    text default 'Ростов-на-Дону';
alter table clients add column if not exists comment text;

-- ── 3. Номер заказа для всех существующих записей ───────────────────────────
-- Формат NR-ГГГГММ-XXXX выводится из даты создания и последних цифр id,
-- поэтому исторические 470+ заказов получают номера без ручной работы.
update orders
   set order_number = 'NR-'
                    || to_char(coalesce(created_at, (start_date::timestamptz), now()), 'YYYYMM')
                    || '-'
                    || lpad(right(regexp_replace(id, '\D', '', 'g'), 4), 4, '0')
 where order_number is null or order_number = '';

-- ── 4. updated_at обновляется автоматически ────────────────────────────────
-- Раньше значение приходило только с клиента: любая запись мимо приложения
-- (SQL Editor, импорт) оставляла устаревшую метку времени.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

drop trigger if exists clients_set_updated_at on clients;
create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

-- ── 5. Индексы ─────────────────────────────────────────────────────────────
-- Все выборки в приложении идут по дате начала, статусу, оплате и клиенту.
-- На 472 строках это не критично, но таблица растёт ~200 заказов в год,
-- а seq scan на каждый фильтр — лишняя нагрузка и задержка на мобильном.
create index if not exists orders_start_date_idx     on orders (start_date desc);
create index if not exists orders_status_idx         on orders (status);
create index if not exists orders_payment_status_idx on orders (payment_status);
create index if not exists orders_updated_at_idx     on orders (updated_at desc);
create index if not exists orders_client_name_idx    on orders (lower(client_name));
create index if not exists orders_order_number_idx   on orders (order_number);

create index if not exists clients_name_idx  on clients (lower(name));
create index if not exists stock_category_idx on stock (category);

-- ── 6. Защита от мусорных значений ─────────────────────────────────────────
-- Статусы приходят из выпадающих списков, но при импорте/ручной правке
-- туда попадало что угодно. Проверки ставим как NOT VALID, чтобы миграция
-- не упала на исторических данных, — новые строки уже под контролем.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_chk') then
    alter table orders add constraint orders_payment_status_chk
      check (payment_status in ('pending_confirmation','confirmed','prepaid','paid','paid_cash'))
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_deposit_status_chk') then
    alter table orders add constraint orders_deposit_status_chk
      check (deposit_status in ('pending','deposited','returned','returned_comp'))
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_amounts_chk') then
    alter table orders add constraint orders_amounts_chk
      check (order_amount >= 0 and paid_amount >= 0 and remaining_amount >= 0)
      not valid;
  end if;
end $$;

-- ── 7. Проверка результата ─────────────────────────────────────────────────
select
  count(*)                                              as всего_заказов,
  count(*) filter (where order_number is not null)      as с_номером,
  count(*) filter (where delivery_zone is not null)     as с_зоной_доставки,
  count(*) filter (where change_log is not null)        as с_историей
from orders;
