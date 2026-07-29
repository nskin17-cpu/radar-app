-- ============================================================================
-- Radar NR — права доступа по разделам (июль 2026)
--
-- Выполнить один раз в SQL Editor панели Supabase. Повторный запуск безопасен.
--
-- Модель как в Эвентусе: у каждого пользователя допуск на раздел —
-- none (не видит) / view (только смотрит) / edit (может менять).
-- Разделы: orders, clients, stock, dashboards, competitors.
-- До применения миграции приложение работает по-старому: admin — всё,
-- обычный пользователь — всё, кроме раздела «Пользователи».
-- ============================================================================

alter table users add column if not exists perms      jsonb;
alter table users add column if not exists role_label text;

comment on column users.perms is
  'Допуски по разделам: {"orders":"edit","clients":"view","stock":"none","dashboards":"view","competitors":"none"}. NULL = по роли (admin: всё, user: всё кроме пользователей).';
comment on column users.role_label is
  'Название пресета прав («Менеджер заказов», «Склад»…) — только для отображения.';

select username, role, role_label, perms from users order by username;
