-- AutoHouse Schema (SQLite)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,           -- sha256(token)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Ein Shop-Konto des Nutzers (z. B. "REWE Lieferservice Hamburg").
CREATE TABLE IF NOT EXISTS shops (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,        -- 'dm' | 'rewe' | 'demo'
  name                TEXT NOT NULL,
  enabled             INTEGER NOT NULL DEFAULT 1,
  postal_code         TEXT,                 -- steuert das REWE-Liefergebiet
  market_id           TEXT,                 -- REWE: gewaehlter Lieferservice-Markt
  credentials_enc     TEXT,                 -- AES-256-GCM, JSON {username,password}
  session_state_enc   TEXT,                 -- AES-256-GCM, Playwright storageState
  session_valid_until TEXT,
  connection_status   TEXT NOT NULL DEFAULT 'unknown', -- unknown|ok|error
  connection_message  TEXT,
  last_checked_at     TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shops_user ON shops(user_id);

-- Produktkatalog pro Shop (gecachte Treffer aus der Produktsuche).
CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  shop_id        TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  external_id    TEXT NOT NULL,
  name           TEXT NOT NULL,
  brand          TEXT,
  grammage       TEXT,                     -- "500 g", "1 l" ...
  price_cents    INTEGER,
  base_price     TEXT,                     -- "3,98 EUR / kg"
  image_url      TEXT,
  product_url    TEXT,
  last_seen_at   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (shop_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);

-- Ein wiederkehrender Bestellplan.
CREATE TABLE IF NOT EXISTS order_plans (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id             TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  enabled             INTEGER NOT NULL DEFAULT 1,
  -- Intervall
  interval_unit       TEXT NOT NULL DEFAULT 'week',   -- day | week | month
  interval_value      INTEGER NOT NULL DEFAULT 1,
  weekday             INTEGER,                        -- 0=So .. 6=Sa (nur bei unit=week)
  day_of_month        INTEGER,                        -- 1..28 (nur bei unit=month)
  time_of_day         TEXT NOT NULL DEFAULT '08:00',  -- HH:MM lokale Zeit
  start_date          TEXT,                           -- YYYY-MM-DD, fruehester Termin
  -- Budget
  max_total_cents     INTEGER NOT NULL DEFAULT 5000,
  min_total_cents     INTEGER NOT NULL DEFAULT 0,     -- Mindestbestellwert des Shops
  budget_strategy     TEXT NOT NULL DEFAULT 'drop_optional', -- drop_optional | reduce_qty | abort
  -- Lieferung
  delivery_preference TEXT NOT NULL DEFAULT 'earliest', -- earliest | cheapest | fixed
  delivery_weekday    INTEGER,
  delivery_from       TEXT,                           -- HH:MM
  delivery_to         TEXT,                           -- HH:MM
  -- Ausfuehrung
  dry_run             INTEGER NOT NULL DEFAULT 1,
  confirm_order       INTEGER NOT NULL DEFAULT 0,     -- nur mit ALLOW_REAL_ORDERS
  notes               TEXT,
  last_run_at         TEXT,
  next_run_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_user ON order_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_next_run ON order_plans(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS order_plan_items (
  id                   TEXT PRIMARY KEY,
  plan_id              TEXT NOT NULL REFERENCES order_plans(id) ON DELETE CASCADE,
  product_id           TEXT REFERENCES products(id) ON DELETE SET NULL,
  external_id          TEXT,                 -- Artikelnummer im Shop
  search_term          TEXT,                 -- Fallback, wenn keine ID bekannt ist
  label                TEXT NOT NULL,        -- Anzeigename
  quantity             INTEGER NOT NULL DEFAULT 1,
  max_unit_price_cents INTEGER,              -- Preisobergrenze pro Stueck
  priority             INTEGER NOT NULL DEFAULT 50,  -- 0..100, hoeher = wichtiger
  optional             INTEGER NOT NULL DEFAULT 0,
  allow_substitute     INTEGER NOT NULL DEFAULT 0,
  position             INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON order_plan_items(plan_id);

CREATE TABLE IF NOT EXISTS order_runs (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES order_plans(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL,        -- queued|running|success|partial|failed|cancelled|needs_action
  trigger             TEXT NOT NULL,        -- schedule|manual
  dry_run             INTEGER NOT NULL,
  planned_total_cents INTEGER,
  cart_total_cents    INTEGER,
  order_reference     TEXT,
  delivery_slot       TEXT,
  error_code          TEXT,
  error_message       TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_plan ON order_runs(plan_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_user ON order_runs(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS order_run_items (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES order_runs(id) ON DELETE CASCADE,
  plan_item_id     TEXT,
  label            TEXT NOT NULL,
  requested_qty    INTEGER NOT NULL,
  ordered_qty      INTEGER NOT NULL DEFAULT 0,
  unit_price_cents INTEGER,
  total_cents      INTEGER,
  status           TEXT NOT NULL,           -- ordered|unavailable|too_expensive|budget_skip|error
  message          TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_items_run ON order_run_items(run_id);

CREATE TABLE IF NOT EXISTS run_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES order_runs(id) ON DELETE CASCADE,
  ts       TEXT NOT NULL,
  level    TEXT NOT NULL,                   -- debug|info|warn|error
  message  TEXT NOT NULL,
  data     TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_logs_run ON run_logs(run_id, id);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id       TEXT PRIMARY KEY,
  run_id   TEXT NOT NULL REFERENCES order_runs(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,                   -- screenshot|html|trace
  path     TEXT NOT NULL,
  label    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_run ON run_artifacts(run_id);
