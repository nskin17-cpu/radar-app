-- Существующее поле qty хранит остаток основного склада.
-- У дополнительных филиалов отсутствующая запись означает нулевой остаток.
begin;
alter table public.stock add column if not exists branch_quantities jsonb not null default '{}'::jsonb
  check (jsonb_typeof(branch_quantities) = 'object' and not (branch_quantities ? 'rostov')
    and not jsonb_path_exists(branch_quantities, '$.* ? (@.type() != "number" || @ < 0)'));
alter table public.orders add column if not exists warehouse_branch text not null default 'rostov';
-- Если уведомления подключены, пересчитываем дефицит каждого склада отдельно.
do $migration$
begin
  if to_regprocedure('public.notif_stock_conflicts(text)') is not null then
    execute $definition$
create or replace function public.notif_stock_conflicts(p_order_id text default null)
returns table (item_name text, category text, day date, need numeric, have numeric, orders_cnt bigint)
language sql stable security definer set search_path = public, extensions
as $$
  with days as (
    select d::date as day from generate_series(notif_today(), notif_today() + 30, interval '1 day') d
  ),
  demand as (
    select lower(trim(i->>'name')) as iname,
           coalesce(nullif(trim(i->>'category'),''), '') as icat,
           coalesce(to_jsonb(o)->>'warehouse_branch', 'rostov') as branch,
           o.id as order_id, o.start_date, o.end_date,
           coalesce((i->>'qty')::numeric, 0) as qty
      from orders o, jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) i
     where o.status <> 'completed'
       and o.start_date is not null and o.end_date is not null
       and o.end_date >= notif_today() and o.start_date <= notif_today() + 30
  ),
  focus as (   -- позиции, которые нас интересуют (все или только заказа-виновника)
    select distinct branch, iname, icat from demand
     where p_order_id is null or order_id = p_order_id
  ),
  per_day as (
    select d.branch, d.iname, d.icat, days.day, sum(d.qty) as need, count(distinct d.order_id) as orders_cnt
      from demand d join days on days.day between d.start_date and d.end_date
      join focus f on f.branch = d.branch and f.iname = d.iname and f.icat = d.icat
     group by d.branch, d.iname, d.icat, days.day
  )
  select s.name, s.category, p.day, p.need, available.qty, p.orders_cnt
    from per_day p
    join stock s on lower(trim(s.name)) = p.iname
                and (p.icat = '' or lower(trim(s.category)) = lower(p.icat))
    cross join lateral (select case when p.branch = 'rostov' then coalesce(s.qty,0)
      else coalesce((to_jsonb(s)->'branch_quantities'->>p.branch)::numeric,0) end as qty) available
   where p.need > available.qty
   order by p.day, s.name;
$$;
    $definition$;
  end if;
end
$migration$;
notify pgrst, 'reload schema';
commit;
