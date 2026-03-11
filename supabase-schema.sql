-- Radar NR: схема для Supabase (миграция из Google Таблиц)
-- Выполните в SQL Editor в панели Supabase

-- Пользователи (для логина)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Конкуренты (поля как в приложении: STR + NUM)
CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  website TEXT,
  instagram TEXT,
  phone TEXT,
  notes TEXT,
  nepal NUMERIC DEFAULT 0,
  loren NUMERIC DEFAULT 0,
  modern NUMERIC DEFAULT 0,
  plastic_chair NUMERIC DEFAULT 0,
  wood_chair NUMERIC DEFAULT 0,
  metal_chair NUMERIC DEFAULT 0,
  plate_snack NUMERIC DEFAULT 0,
  plate_dinner NUMERIC DEFAULT 0,
  plate_sub NUMERIC DEFAULT 0,
  glass_wine NUMERIC DEFAULT 0,
  glass_flute NUMERIC DEFAULT 0,
  glass_martini NUMERIC DEFAULT 0,
  glass_rocks NUMERIC DEFAULT 0,
  cutlery_set NUMERIC DEFAULT 0,
  delivery NUMERIC DEFAULT 0,
  delivery_km NUMERIC DEFAULT 0,
  setup_plates NUMERIC DEFAULT 0,
  setup_glasses NUMERIC DEFAULT 0,
  setup_cutlery NUMERIC DEFAULT 0,
  setup_metal_chair NUMERIC DEFAULT 0,
  setup_plastic_chair NUMERIC DEFAULT 0,
  setup_cushion_chair NUMERIC DEFAULT 0,
  pro_discount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Моя компания (одна запись, id = 'MY')
CREATE TABLE IF NOT EXISTS my_company (
  id TEXT PRIMARY KEY DEFAULT 'MY',
  name TEXT,
  city TEXT,
  website TEXT,
  instagram TEXT,
  phone TEXT,
  notes TEXT,
  nepal NUMERIC DEFAULT 0,
  loren NUMERIC DEFAULT 0,
  modern NUMERIC DEFAULT 0,
  plastic_chair NUMERIC DEFAULT 0,
  wood_chair NUMERIC DEFAULT 0,
  metal_chair NUMERIC DEFAULT 0,
  plate_snack NUMERIC DEFAULT 0,
  plate_dinner NUMERIC DEFAULT 0,
  plate_sub NUMERIC DEFAULT 0,
  glass_wine NUMERIC DEFAULT 0,
  glass_flute NUMERIC DEFAULT 0,
  glass_martini NUMERIC DEFAULT 0,
  glass_rocks NUMERIC DEFAULT 0,
  cutlery_set NUMERIC DEFAULT 0,
  delivery NUMERIC DEFAULT 0,
  delivery_km NUMERIC DEFAULT 0,
  setup_plates NUMERIC DEFAULT 0,
  setup_glasses NUMERIC DEFAULT 0,
  setup_cutlery NUMERIC DEFAULT 0,
  setup_metal_chair NUMERIC DEFAULT 0,
  setup_plastic_chair NUMERIC DEFAULT 0,
  setup_cushion_chair NUMERIC DEFAULT 0,
  pro_discount NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- История цен по месяцам
CREATE TABLE IF NOT EXISTS history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month TEXT NOT NULL,
  company_id TEXT NOT NULL,
  company_name TEXT,
  nepal NUMERIC,
  loren NUMERIC,
  modern NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, company_id)
);

-- Заказы CRM
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  company_name TEXT,
  start_date DATE,
  end_date DATE,
  order_amount NUMERIC DEFAULT 0,
  budget_amount NUMERIC DEFAULT 0,
  deposit_amount NUMERIC DEFAULT 0,
  delivery_cost NUMERIC DEFAULT 0,
  setup_cost NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  remaining_amount NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'assembly', 'in_progress', 'completed')),
  payment_status TEXT NOT NULL DEFAULT 'pending_confirmation',
  delivery_type TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_type IN ('pickup', 'delivery')),
  delivery_address TEXT,
  setup_required TEXT DEFAULT 'no',
  carry_floor TEXT DEFAULT 'no',
  deposit_status TEXT DEFAULT 'pending',
  compensation_amount NUMERIC DEFAULT 0,
  compensation_note TEXT,
  items JSONB DEFAULT '[]',
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Клиенты CRM
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  pro_discount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Склад (каталог изделий)
CREATE TABLE IF NOT EXISTS stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  qty NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'шт',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, category)
);

-- Настройки цен CRM (key-value)
CREATE TABLE IF NOT EXISTS pricing_config (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: разрешить анонимный доступ для миграции; потом можно включить auth
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_company ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON competitors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON my_company FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON stock FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON pricing_config FOR ALL USING (true) WITH CHECK (true);
