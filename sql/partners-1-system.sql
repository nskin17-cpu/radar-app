-- ============================================================================
-- Radar NR — подсистема партнёрских (комиссионных) товаров, шаг 1.
--
-- ЗАЧЕМ:
--   Часть позиций на складе принадлежит не NANDRENT, а внешнему партнёру
--   (первый — Анастасия Аникианова / Anikanova Flowers). По таким позициям
--   прибыль делится, ведётся отдельный баланс и своя аналитика.
--
-- ЧТО ДЕЛАЕТ:
--   1. partners               — партнёры и их индивидуальные условия
--                               (сервисный сбор, доля в прибыли).
--   2. stock.owner_type / partner_id — тип собственности позиции склада.
--   3. partner_settlements    — расчёт по паре «заказ × партнёр».
--   4. partner_expense_types  — справочник типов доп. расходов (мойка, ремонт…).
--   5. partner_expenses       — сами расходы: сумма вводится вручную.
--   6. partner_payouts        — выплаты партнёру, из них считается баланс.
--   7. Зона допуска «partners» и RLS на все новые таблицы.
--
-- БЕЗОПАСНО: ничего не удаляет и не переписывает, повторный запуск не вредит.
--            До применения приложение работает как раньше: слой данных
--            отбрасывает неизвестные колонки (см. filterToExistingColumns).
--
-- ВАЖНО ПРО КЛИЕНТА: ни одно поле отсюда не попадает в смету, акт и КП —
--            документы печатают только name/qty/price позиции заказа.
-- ============================================================================

-- ── 1. Партнёры ─────────────────────────────────────────────────────────────
-- Условия хранятся у партнёра, а не в коде: чтобы поменять процент, править
-- приложение не нужно. Схема по умолчанию выбирается автоматически (см. ниже),
-- но её можно зафиксировать принудительно через settlement_scheme.
create table if not exists partners (
  id                text primary key,
  name              text not null,
  company           text,
  phone             text,
  -- Связь с карточкой клиента: по ней заказ опознаётся как «партнёр
  -- оформляет сам себе» (алгоритм №1). Может быть пустой.
  client_id         text,
  client_name       text,
  -- Условия сотрудничества
  service_fee_pct   numeric not null default 5,   -- алгоритм №1: сбор с полной стоимости ДО скидок
  partner_share_pct numeric not null default 50,  -- алгоритм №2: доля партнёра ПОСЛЕ скидок
  -- 'auto' — выбирать алгоритм по клиенту заказа (по умолчанию),
  -- 'service_fee' / 'revenue_share' — всегда один и тот же.
  settlement_scheme text not null default 'auto'
                    check (settlement_scheme in ('auto','service_fee','revenue_share')),
  -- Внутренняя маркировка: нейтральный код и цвет бейджа.
  -- Код специально короткий и безликий — если сотрудник случайно покажет
  -- экран клиенту, «AF» ни о чём не скажет.
  code              text,
  color             text default '#7C5CFF',
  active            boolean not null default true,
  note              text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists partners_active_idx on partners (active);

-- ── 2. Собственность позиции склада ─────────────────────────────────────────
-- owner_type сознательно текстовый, а не boolean: завтра появится
-- 'consignment', 'leased' и т.п. без миграции типа.
alter table stock add column if not exists owner_type text not null default 'own';
alter table stock add column if not exists partner_id text;

do $$ begin
  alter table stock add constraint stock_owner_type_chk check (owner_type in ('own','partner'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table stock add constraint stock_partner_fk
    foreign key (partner_id) references partners(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Партнёрская позиция обязана иметь партнёра, своя — не может его иметь.
do $$ begin
  alter table stock add constraint stock_owner_consistency_chk
    check ((owner_type = 'partner' and partner_id is not null)
        or (owner_type <> 'partner' and partner_id is null));
exception when duplicate_object then null; end $$;

create index if not exists stock_partner_idx on stock (partner_id) where partner_id is not null;

-- ── 3. Взаиморасчёт по заказу ───────────────────────────────────────────────
-- Одна строка на пару «заказ × партнёр»: в заказе могут быть товары
-- сразу нескольких партнёров, и каждый считается по своим условиям.
--
-- Все суммы — снапшот на момент расчёта. Пересчёт заказа их обновит,
-- но выплаченные (status='paid') строки не трогаются: иначе история
-- расчётов поехала бы задним числом.
create table if not exists partner_settlements (
  id                  text primary key,
  order_id            text not null references orders(id) on delete cascade,
  partner_id          text not null references partners(id) on delete restrict,

  -- 'service_fee'   — алгоритм №1: заказ оформил сам партнёр.
  -- 'revenue_share' — алгоритм №2: партнёрские товары арендует сторонний клиент.
  scheme              text not null check (scheme in ('service_fee','revenue_share')),

  partner_gross       numeric not null default 0,  -- стоимость партнёрских товаров ДО скидок
  partner_net         numeric not null default 0,  -- она же ПОСЛЕ скидки
  discount_pct        numeric not null default 0,

  service_fee_pct     numeric not null default 0,
  service_fee_amount  numeric not null default 0,
  partner_share_pct   numeric not null default 0,

  partner_income      numeric not null default 0,  -- начислено партнёру
  company_income      numeric not null default 0,  -- доход NANDRENT по партнёрским товарам
  own_items_total     numeric not null default 0,  -- наши товары в этом же заказе (для аналитики)

  status              text not null default 'accrued'
                      check (status in ('draft','accrued','paid','cancelled')),
  comment             text,

  -- Детализация позиций на момент расчёта: qty/price/имя.
  -- Нужна, чтобы отчёт за прошлый период не менялся после правки склада.
  items               jsonb not null default '[]',

  calculated_at       timestamptz default now(),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (order_id, partner_id)
);

create index if not exists partner_settlements_partner_idx on partner_settlements (partner_id);
create index if not exists partner_settlements_order_idx on partner_settlements (order_id);

-- ── 4. Типы дополнительных расходов ─────────────────────────────────────────
-- Отдельная сущность, а не колонка «мойка»: новые типы добавляются строкой
-- в справочник, без правки кода и без миграций.
create table if not exists partner_expense_types (
  id         text primary key,
  name       text not null,
  sort       numeric not null default 100,
  active     boolean not null default true,
  created_at timestamptz default now()
);

insert into partner_expense_types (id, name, sort) values
  ('washing',   'Мойка',                  10),
  ('cleaning',  'Химчистка',              20),
  ('repair',    'Ремонт',                 30),
  ('restore',   'Восстановление изделий', 40),
  ('packing',   'Упаковка',               50),
  ('transport', 'Транспортные расходы',   60),
  ('other',     'Прочее',                 900)
on conflict (id) do nothing;

-- ── 5. Дополнительные расходы ───────────────────────────────────────────────
-- Сумма ВСЕГДА вводится вручную: стоимость мойки каждый раз разная
-- (часть изделий приехала с нашим заказом, часть вообще не пачкалась).
-- Автоматический расчёт здесь дал бы стабильно неверную цифру.
create table if not exists partner_expenses (
  id          text primary key,
  partner_id  text not null references partners(id) on delete cascade,
  order_id    text references orders(id) on delete set null,
  type_id     text not null default 'other' references partner_expense_types(id),
  amount      numeric not null default 0,
  comment     text,
  employee    text,
  spent_at    date not null default current_date,
  -- Кто в итоге несёт расход: удерживаем с партнёра или списываем на себя.
  billable_to text not null default 'partner' check (billable_to in ('partner','company')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists partner_expenses_partner_idx on partner_expenses (partner_id, spent_at);
create index if not exists partner_expenses_order_idx on partner_expenses (order_id);

-- ── 6. Выплаты партнёру ─────────────────────────────────────────────────────
create table if not exists partner_payouts (
  id         text primary key,
  partner_id text not null references partners(id) on delete cascade,
  amount     numeric not null default 0,
  paid_at    date not null default current_date,
  method     text,
  comment    text,
  employee   text,
  created_at timestamptz default now()
);

create index if not exists partner_payouts_partner_idx on partner_payouts (partner_id, paid_at);

-- ── 7. Баланс партнёра ──────────────────────────────────────────────────────
-- Считается в базе, а не в браузере: журнал взаиморасчётов и акт сверки
-- должны показывать одну и ту же цифру независимо от того, что закэшировано.
create or replace view partner_balances as
select
  p.id                                                as partner_id,
  p.name,
  p.company,
  coalesce(a.accrued, 0)                              as accrued,
  coalesce(e.expenses, 0)                             as expenses,
  coalesce(o.paid, 0)                                 as paid,
  coalesce(a.accrued, 0) - coalesce(e.expenses, 0) - coalesce(o.paid, 0) as balance
from partners p
left join (
  select partner_id, sum(partner_income) as accrued
  from partner_settlements where status in ('accrued','paid') group by partner_id
) a on a.partner_id = p.id
left join (
  select partner_id, sum(amount) as expenses
  from partner_expenses where billable_to = 'partner' group by partner_id
) e on e.partner_id = p.id
left join (
  select partner_id, sum(amount) as paid
  from partner_payouts group by partner_id
) o on o.partner_id = p.id;

-- ── 8. updated_at ───────────────────────────────────────────────────────────
-- set_updated_at() создана в migration-2026-07-orders.sql.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists partners_updated_at on partners;
    create trigger partners_updated_at before update on partners
      for each row execute function set_updated_at();

    drop trigger if exists partner_settlements_updated_at on partner_settlements;
    create trigger partner_settlements_updated_at before update on partner_settlements
      for each row execute function set_updated_at();

    drop trigger if exists partner_expenses_updated_at on partner_expenses;
    create trigger partner_expenses_updated_at before update on partner_expenses
      for each row execute function set_updated_at();
  end if;
end $$;

-- ── 9. Допуски и RLS ────────────────────────────────────────────────────────
-- Новая зона «partners». Пользователи без явных perms (созданные до миграции
-- прав) сохраняют полный доступ — это уже заложено в app_can().
alter table partners              enable row level security;
alter table partner_settlements   enable row level security;
alter table partner_expense_types enable row level security;
alter table partner_expenses      enable row level security;
alter table partner_payouts       enable row level security;

do $$
declare t text;
begin
  -- Если app_can() ещё нет (security-1-setup.sql не применяли) — оставляем
  -- открытый доступ, как у остальных таблиц в supabase-schema.sql.
  if not exists (select 1 from pg_proc where proname = 'app_can') then
    foreach t in array array['partners','partner_settlements','partner_expense_types',
                             'partner_expenses','partner_payouts'] loop
      execute format('drop policy if exists radar_open on %I', t);
      execute format('create policy radar_open on %I for all using (true) with check (true)', t);
    end loop;
    return;
  end if;

  foreach t in array array['partners','partner_settlements','partner_expense_types',
                           'partner_expenses','partner_payouts'] loop
    execute format('drop policy if exists radar_read on %I', t);
    execute format('drop policy if exists radar_write on %I', t);
    execute format($f$create policy radar_read on %I for select using (app_can('partners','view'))$f$, t);
    execute format($f$create policy radar_write on %I for all
                        using (app_can('partners','edit'))
                        with check (app_can('partners','edit'))$f$, t);
  end loop;
end $$;

-- Склад видит собственность позиции вместе с самой позицией: отдельная
-- политика не нужна, owner_type/partner_id лежат в той же строке stock.

-- ── 10. Первый партнёр ──────────────────────────────────────────────────────
-- Условия ровно те, что действуют сейчас: 5% сервисный сбор и 50/50.
-- Меняются из интерфейса, править этот файл для этого не нужно.
insert into partners (id, name, company, code, color, service_fee_pct, partner_share_pct, note)
values ('anikanova', 'Анастасия Аникианова', 'Anikanova Flowers', 'AF', '#C2185B', 5, 50,
        'Первый партнёр. Сервисный сбор 5% при собственных заказах, 50/50 при заказах сторонних клиентов.')
on conflict (id) do nothing;
