-- 管道智能化检测系统 · 数据库结构 (MySQL 8.0+ / utf8mb4)
CREATE DATABASE IF NOT EXISTS pipeline_monitor
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username        VARCHAR(64)  NOT NULL,
  pwd_salt        CHAR(24)     NOT NULL,
  pwd_hash        CHAR(88)     NOT NULL,
  role            ENUM('admin','viewer') NOT NULL DEFAULT 'admin',
  status          ENUM('active','disabled') NOT NULL DEFAULT 'active',
  must_change_pwd TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at   DATETIME     NULL,
  last_login_ip   VARCHAR(64)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)     NOT NULL,
  admin_id   INT UNSIGNED NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at BIGINT       NOT NULL,
  ip         VARCHAR(64)  NULL,
  ua         VARCHAR(255) NULL,
  PRIMARY KEY (token_hash),
  KEY idx_expires (expires_at),
  CONSTRAINT fk_sess_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nodes (
  id          VARCHAR(16)  NOT NULL,
  seq         INT          NOT NULL,
  label       VARCHAR(64)  NULL,
  x           DOUBLE       NOT NULL COMMENT '真实安装坐标 X(米)',
  y           DOUBLE       NOT NULL COMMENT '真实安装坐标 Y(米)',
  dn_mm       SMALLINT UNSIGNED NOT NULL COMMENT '管径 DN(mm)',
  parent_id   VARCHAR(16)  NULL COMMENT '上游节点',
  edge_km     DECIMAL(6,2) NULL COMMENT '与上游节点间距(km)',
  branch_dir  TINYINT      NOT NULL DEFAULT 0 COMMENT '-1下 0主干 1上',
  branch_kind ENUM('trunk','branch','lateral') NOT NULL DEFAULT 'trunk',
  device_sn   VARCHAR(64)  NULL,
  installed_on DATE        NULL,
  area        VARCHAR(64)  NULL COMMENT '片区/村组',
  owner       VARCHAR(32)  NULL COMMENT '负责人/班组',
  note        VARCHAR(255) NULL,
  t_on        DECIMAL(5,1) NULL COMMENT 'NULL=按管径默认',
  t_off       DECIMAL(5,1) NULL,
  flow_lo     DECIMAL(5,2) NULL,
  flow_hi     DECIMAL(5,2) NULL,
  enabled     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_seq (seq),
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id   INT UNSIGNED NULL,
  username   VARCHAR(64)  NULL,
  action     VARCHAR(32)  NOT NULL,
  target     VARCHAR(64)  NULL,
  detail     JSON         NULL,
  ip         VARCHAR(64)  NULL,
  ua         VARCHAR(255) NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_time (created_at),
  KEY idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  k          VARCHAR(64) NOT NULL,
  v          JSON        NOT NULL,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
