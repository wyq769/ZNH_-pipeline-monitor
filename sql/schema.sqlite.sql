-- 管道智能化检测系统 · SQLite 结构（node:sqlite / 本机零安装模式）
CREATE TABLE IF NOT EXISTS admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  pwd_salt        TEXT NOT NULL,
  pwd_hash        TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'admin',
  status          TEXT NOT NULL DEFAULT 'active',
  must_change_pwd INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT,
  last_login_ip   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sess_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL,
  label       TEXT,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  dn_mm       INTEGER NOT NULL,
  parent_id   TEXT,
  edge_km     REAL,
  branch_dir  INTEGER NOT NULL DEFAULT 0,
  branch_kind TEXT NOT NULL DEFAULT 'trunk',
  device_sn   TEXT,
  installed_on TEXT,
  area        TEXT,
  owner       TEXT,
  note        TEXT,
  t_on        REAL,
  t_off       REAL,
  flow_lo     REAL,
  flow_hi     REAL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_seq ON nodes(seq);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER,
  username   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  ua         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS settings (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
