-- ============================================================================
-- Radar NR — УВЕДОМЛЕНИЯ, шаг Н4: напоминания о работе с клиентом.
--
-- ЗАЧЕМ: два действия перед выдачей до сих пор держались в голове менеджера,
--        и именно поэтому иногда не делались:
--
--   1. За 3 дня до выдачи — напомнить клиенту об оплате.
--      Заказ ещё не оплачен полностью, а деньги нужны до выдачи. Три дня —
--      это последний момент, когда клиент успевает спокойно заплатить, а мы
--      успеваем среагировать, если он передумал.
--
--   2. За сутки до выдачи — связаться с клиентом и узнать время доставки.
--      Точное время нужно складу, чтобы собрать и отправить машину вовремя.
--
-- КОМУ ПРИХОДИТ: сотруднику с правом менять заказы (area orders, level edit),
--        а не клиенту — своего канала до клиента у системы нет. Уведомление
--        говорит «пора позвонить», звонит человек.
--
-- КАК ПРИХОДИТ: в ленту колокольчика и браузерным пушем на телефон — оба типа
--        сразу создаются с каналом webpush. Чтобы пуш дошёл, у сотрудника
--        должны быть включены уведомления на устройстве (колокольчик →
--        Настройки → Push) и применён шаг Н2.
--
-- КОГДА СЧИТАЕТСЯ: раз в сутки, вместе с остальными ежедневными правилами —
--        в то же время, что и утренняя сводка (notif_settings.digest_time).
--
-- СРОКИ МЕНЯЮТСЯ БЕЗ ПРАВКИ КОДА: notif_settings.pay_reminder_days и
--        notif_settings.delivery_time_days (см. ниже).
--
-- БЕЗОПАСНО: ничего не удаляет и не переписывает, повторный запуск не вредит.
--        Выполняется ПОСЛЕ шагов Н1–Н3.
-- ============================================================================

-- ── 1. Сроки напоминаний ───────────────────────────────────────────────────
-- За сколько дней до выдачи напоминать. Меняются здесь же, одним update:
--   update notif_settings set value = '5' where key = 'pay_reminder_days';
insert into notif_settings(key, value) values
  ('pay_reminder_days',   '3'),   -- напомнить клиенту об оплате
  ('delivery_time_days',  '1')    -- уточнить время доставки
on conflict (key) do nothing;

-- ── 2. Каталог: два новых типа ─────────────────────────────────────────────
-- Каналы по умолчанию — лента и Push (Telegram и Email выключены шагом Н3).
insert into notif_types (key, category, title, descr, severity, audience,
                         schedule, dedup_hours, digest, default_channels, sort) values
  ('client_pay_reminder', 'finance', 'Напомнить клиенту об оплате',
   'За 3 дня до выдачи: заказ оплачен не полностью — связаться с клиентом и напомнить',
   'warn', '{"area":"orders","level":"edit"}',
   'daily', 20, false, array['inapp','webpush'], 55),

  ('client_delivery_time', 'orders', 'Уточнить время доставки',
   'За сутки до выдачи: позвонить клиенту и согласовать время — складу нужно к нему готовиться',
   'warn', '{"area":"orders","level":"edit"}',
   'daily', 20, false, array['inapp','webpush'], 56)
on conflict (key) do update set
  category = excluded.category, title = excluded.title, descr = excluded.descr,
  severity = excluded.severity, audience = excluded.audience, schedule = excluded.schedule,
  dedup_hours = excluded.dedup_hours, digest = excluded.digest, sort = excluded.sort;
  -- enabled и default_channels не перетираем: их мог поменять администратор

-- Если тип уже был создан прошлым запуском без пуша — добавим канал.
update notif_types
   set default_channels = default_channels || array['webpush']
 where key in ('client_pay_reminder','client_delivery_time')
   and not ('webpush' = any(default_channels));

-- ── 3. Правило: напомнить клиенту об оплате ────────────────────────────────
--
-- Берём заказы, у которых выдача ровно через N дней и остались неоплаченные
-- деньги. Полностью оплаченные (paid, paid_cash) и уже завершённые не трогаем.
--
-- Почему сравнение на равенство, а не «в ближайшие N дней»: иначе напоминание
-- повторялось бы каждый день до самой выдачи. Про горящие заказы есть
-- отдельные типы pay_overdue и pay_balance_due — этот именно про «пора
-- позвонить заранее».
create or replace function notif_rule_client_pay_reminder()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare o record; n int := 0; days int;
begin
  days := coalesce(nullif(notif_setting('pay_reminder_days'),'')::int, 3);
  for o in
    select * from orders
     where status <> 'completed'
       and payment_status not in ('paid','paid_cash')
       and start_date = notif_today() + days
       and coalesce(order_amount,0) > 0
  loop
    n := n + notif_emit('client_pay_reminder', o.id,
      'Напомнить об оплате: ' || notif_order_label(o),
      'Выдача ' || to_char(o.start_date,'DD.MM') || ' (через ' || days || ' дн.)' ||
      ', клиент ' || coalesce(o.client_name,'—') ||
      coalesce(', тел. ' || nullif(o.client_phone,''), '') ||
      '. К оплате ' || notif_fmt_money(
          case when coalesce(o.remaining_amount,0) > 0
               then o.remaining_amount else o.order_amount end) || ' ₽' ||
      case o.payment_status
        when 'prepaid' then ' (остаток после предоплаты)'
        when 'confirmed' then ' (заказ подтверждён, оплаты нет)'
        else ' (оплаты нет)' end,
      'order:' || o.id);
  end loop;
  return n;
end $$;

-- ── 4. Правило: уточнить время доставки ────────────────────────────────────
--
-- Только заказы с доставкой: у самовывоза время согласуют иначе. Чтобы
-- включить и самовывоз, уберите условие по delivery_type.
create or replace function notif_rule_client_delivery_time()
returns int language plpgsql security definer set search_path = public, extensions
as $$
declare o record; n int := 0; days int;
begin
  days := coalesce(nullif(notif_setting('delivery_time_days'),'')::int, 1);
  for o in
    select * from orders
     where status <> 'completed'
       and coalesce(delivery_type,'') = 'delivery'
       and start_date = notif_today() + days
  loop
    n := n + notif_emit('client_delivery_time', o.id,
      'Уточнить время доставки: ' || notif_order_label(o),
      'Выдача ' || to_char(o.start_date,'DD.MM') ||
      case when days = 1 then ' (завтра)' else ' (через ' || days || ' дн.)' end ||
      ', клиент ' || coalesce(o.client_name,'—') ||
      coalesce(', тел. ' || nullif(o.client_phone,''), '') ||
      '. Адрес: ' || coalesce(nullif(o.delivery_address,''), 'не указан') ||
      '. Позвонить и согласовать время — складу нужно к нему готовиться.',
      'order:' || o.id);
  end loop;
  return n;
end $$;

-- ── 5. Планировщик: подключаем новые правила ───────────────────────────────
-- notif_tick перечисляет правила явным списком, поэтому пересоздаём её
-- целиком с двумя добавленными ветками. Остальное — без изменений.
create or replace function notif_tick()
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare t record; cnt int; total int := 0; report text := '';
begin
  if coalesce(notif_setting('enabled'),'true') <> 'true' then return 'выключено'; end if;
  for t in select * from notif_types where schedule <> 'instant' and enabled order by sort loop
    if not notif_should_run(t.key) then continue; end if;
    begin
      cnt := case t.key
        when 'pay_overdue'           then notif_rule_pay_overdue()
        when 'pay_balance_due'       then notif_rule_pay_balance_due()
        when 'deposit_stuck'         then notif_rule_deposit_stuck()
        when 'assembly_overdue'      then notif_rule_assembly_overdue()
        when 'return_overdue'        then notif_rule_return_overdue()
        when 'client_pay_reminder'   then notif_rule_client_pay_reminder()
        when 'client_delivery_time'  then notif_rule_client_delivery_time()
        when 'digest_daily'          then notif_rule_digest_daily()
        when 'digest_weekly'         then notif_rule_digest_weekly()
        when 'clients_digest'        then notif_rule_clients_digest()
        else 0 end;
      insert into notif_runs (type_key, last_run, last_count, last_error)
      values (t.key, now(), cnt, null)
      on conflict (type_key) do update set last_run = now(), last_count = excluded.last_count, last_error = null;
      total := total + cnt;
      report := report || t.key || ':' || cnt || ' ';
    exception when others then
      insert into notif_runs (type_key, last_run, last_count, last_error)
      values (t.key, now(), 0, sqlerrm)
      on conflict (type_key) do update set last_run = now(), last_error = sqlerrm;
    end;
  end loop;
  perform notif_dispatch_queue();
  return coalesce(nullif(report,''), 'тихо') || '→ ' || total;
end $$;

-- ── 6. Проверка ────────────────────────────────────────────────────────────
-- Оба типа должны быть в каталоге, с каналом webpush.
select key, title, schedule, default_channels, enabled
  from notif_types
 where key in ('client_pay_reminder','client_delivery_time');

-- Сколько заказов попало бы под напоминания прямо сейчас (ничего не шлёт).
select 'напомнить об оплате' as правило,
       count(*) as заказов,
       string_agg(coalesce(client_name,'—') || ' · ' || to_char(start_date,'DD.MM'), ', ') as какие
  from orders
 where status <> 'completed'
   and payment_status not in ('paid','paid_cash')
   and start_date = notif_today() + coalesce(nullif(notif_setting('pay_reminder_days'),'')::int, 3)
   and coalesce(order_amount,0) > 0
union all
select 'уточнить время доставки',
       count(*),
       string_agg(coalesce(client_name,'—') || ' · ' || to_char(start_date,'DD.MM'), ', ')
  from orders
 where status <> 'completed'
   and coalesce(delivery_type,'') = 'delivery'
   and start_date = notif_today() + coalesce(nullif(notif_setting('delivery_time_days'),'')::int, 1);

-- ============================================================================
-- ПОСЛЕ ВЫПОЛНЕНИЯ:
--   • оба напоминания появятся в колокольчике → Настройки, разделы
--     «Финансы» и «Заказы» — там их можно выключить лично для себя;
--   • первый расчёт пройдёт в ближайший тик после времени утренней сводки;
--   • проверить вручную, не дожидаясь утра:  select notif_tick();
-- ============================================================================
