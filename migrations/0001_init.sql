-- EcoLimit: D1 (SQLite) sxemasi

CREATE TABLE IF NOT EXISTS factories (
  id          TEXT PRIMARY KEY,              -- masalan ZAV-001
  name        TEXT NOT NULL,
  sector      TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL DEFAULT 'O''rta', -- Kichik / O'rta / Katta
  demand      REAL NOT NULL DEFAULT 0,       -- mahsulotga oylik talab (birlik)
  hour_start  INTEGER NOT NULL DEFAULT 8,    -- ajratilgan ish vaqti boshlanishi
  hour_end    INTEGER NOT NULL DEFAULT 20,   -- tugashi
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  login       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash   TEXT NOT NULL,
  salt        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','factory')),
  factory_id  TEXT REFERENCES factories(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  login       TEXT PRIMARY KEY COLLATE NOCASE,
  fails       INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- Oylik CO2 hisobotlari (tonna). Joriy oy uchun — oy boshidan hozirgacha.
CREATE TABLE IF NOT EXISTS reports (
  factory_id  TEXT NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,                 -- YYYY-MM
  co2         REAL NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (factory_id, month)
);

-- Tasdiqlangan oylik limitlar (admin oyni "tasdiqlaganda" yoziladi)
CREATE TABLE IF NOT EXISTS allocations (
  factory_id  TEXT NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  base_limit  REAL NOT NULL,
  demand      REAL NOT NULL,
  util        REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (factory_id, month)
);

CREATE TABLE IF NOT EXISTS extra_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_id  TEXT NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  tons        REAL NOT NULL,
  cost        REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_id  TEXT REFERENCES factories(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  text        TEXT NOT NULL,
  contact     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'Yangi',
  admin_note  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('total_cap', '300000'),
  ('tiers', '[{"upto":5,"price":18},{"upto":10,"price":27},{"upto":20,"price":45}]'),
  ('telegram', 'saidalokhonn');

CREATE INDEX IF NOT EXISTS idx_reports_month ON reports(month);
CREATE INDEX IF NOT EXISTS idx_extra_factory ON extra_requests(factory_id, month);
CREATE INDEX IF NOT EXISTS idx_issues_factory ON issues(factory_id);
