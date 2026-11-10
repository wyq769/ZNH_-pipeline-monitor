"use strict";
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const cfg = require("../server/config");
const A = require("../server/auth");

const RESET = process.argv.includes("--reset");
const FORCE_PWD = process.argv.includes("--force-pwd");

function pad2(n) { return String(n).padStart(2, "0"); }
function pad3(n) { return String(n).padStart(3, "0"); }

const TRUNK_DN = [400, 315, 500, 630, 400, 315, 500, 400, 315, 500, 400, 630];
const TRUNK_KM = [1, 2, 2, 3, 3, 3, 1, 3, 3, 3, 3];
const BR_AT = [1, 3, 5, 8, 10];
const BR_KM = [[3, 1, 5], [5, 3, 1], [1, 5, 3], [3, 5, 1], [5, 1, 3]];
const BR_DN = [315, 250, 200, 315, 250];
const BR_DIR = [-1, 1, -1, 1, -1];
const LAT_KM = [1, 3, 5];

function buildNodes() {
  const out = [];
  let seq = 0, x = 0;
  for (let i = 0; i < 12; i++) {
    if (i > 0) x += TRUNK_KM[i - 1] * 1000;
    out.push({
      id: "N" + pad2(i + 1), seq: ++seq, label: i === 0 ? "起点" : (i === 11 ? "终点" : null),
      x: x, y: 0, dn_mm: TRUNK_DN[i],
      parent_id: i === 0 ? null : "N" + pad2(i),
      edge_km: i === 0 ? null : TRUNK_KM[i - 1],
      branch_dir: 0, branch_kind: "trunk"
    });
  }
  let idn = 13;
  for (let b = 0; b < BR_AT.length; b++) {
    const base = out[BR_AT[b]];
    let cy = base.y, parent = base.id;
    for (let s = 0; s < 3; s++) {
      const km = BR_KM[b][s];
      cy += BR_DIR[b] * km * 1000;
      const id = "N" + pad2(idn);
      out.push({
        id: id, seq: ++seq, label: null, x: base.x, y: cy, dn_mm: BR_DN[b],
        parent_id: parent, edge_km: km, branch_dir: BR_DIR[b], branch_kind: "branch"
      });
      parent = id; idn++;
    }
  }
  const tip = out[14];
  let lx = tip.x, lparent = tip.id;
  for (let s = 0; s < LAT_KM.length; s++) {
    lx += LAT_KM[s] * 1000;
    const id = "N" + pad2(idn);
    out.push({
      id: id, seq: ++seq, label: null, x: lx, y: tip.y, dn_mm: 200,
      parent_id: lparent, edge_km: LAT_KM[s], branch_dir: 0, branch_kind: "lateral"
    });
    lparent = id; idn++;
  }
  return out.map(function (n) {
    return Object.assign(n, {
      device_sn: "JT-2026-" + pad3(n.seq),
      installed_on: "2026-08-15",
      area: null,
      owner: n.seq % 2 ? "运维一组" : "运维二组",
      note: null, t_on: null, t_off: null, flow_lo: null, flow_hi: null, enabled: 1
    });
  });
}

async function main() {
  const db = require("../server/db");
  const driver = db.driver();
  console.log("数据库驱动：" + (driver === "sqlite"
    ? "SQLite（" + db.path() + "）"
    : "MySQL " + cfg.mysql.user + "@" + cfg.mysql.host + ":" + cfg.mysql.port));

  if (driver === "mysql") {
    const mysql = require("mysql2/promise");
    const root = await mysql.createConnection({
      host: cfg.mysql.host, port: cfg.mysql.port, user: cfg.mysql.user, password: cfg.mysql.password
    });
    await root.query("CREATE DATABASE IF NOT EXISTS `" + cfg.mysql.database + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    await root.end();
  }

  const schemaFile = driver === "sqlite" ? "schema.sqlite.sql" : "schema.sql";
  const n = await db.exec(fs.readFileSync(path.join(cfg.root, "sql", schemaFile), "utf8"));
  console.log("表结构就绪" + (n ? "（" + n + " 条语句）" : ""));

  const adm = await db.one("SELECT id FROM admins WHERE username = ?", ["123456"]);
  if (!adm) {
    const h = A.hashPassword("123456");
    await db.q("INSERT INTO admins (username, pwd_salt, pwd_hash, role, must_change_pwd) VALUES (?,?,?,?,0)",
      ["123456", h.salt, h.hash, "admin"]);
    console.log("管理员已创建：账号 123456 / 密码 123456");
  } else if (FORCE_PWD) {
    const h = A.hashPassword("123456");
    await db.q("UPDATE admins SET pwd_salt=?, pwd_hash=?, status='active' WHERE username='123456'", [h.salt, h.hash]);
    console.log("管理员密码已重置为 123456");
  } else {
    console.log("管理员已存在：123456（如需重置密码加 --force-pwd）");
  }

  const cnt = await db.one("SELECT COUNT(*) AS n FROM nodes");
  if (RESET) await db.q("DELETE FROM nodes");
  if (RESET || Number(cnt.n) === 0) {
    const nodes = buildNodes();
    const cols = ["id", "seq", "label", "x", "y", "dn_mm", "parent_id", "edge_km", "branch_dir",
      "branch_kind", "device_sn", "installed_on", "area", "owner", "note", "t_on", "t_off",
      "flow_lo", "flow_hi", "enabled"];
    const sql = "INSERT INTO nodes (" + cols.join(",") + ") VALUES (" + cols.map(function () { return "?"; }).join(",") + ")";
    for (const nd of nodes) {
      await db.q(sql, cols.map(function (c) { return nd[c] === undefined ? null : nd[c]; }));
    }
    console.log("节点已写入：" + nodes.length + " 个（N01-N30：主干 12 · 分支 15 · 横向 3）");
  } else {
    console.log("节点已存在 " + cnt.n + " 个（加 --reset 可重建）");
  }

  const settings = [["devLogin", "true"], ["heatW", "25"], ["tickMs", "2000"], ["telemetryKeepDays", "7"]];
  for (const s of settings) {
    await db.q("DELETE FROM settings WHERE k = ?", [s[0]]);
    await db.q("INSERT INTO settings (k, v) VALUES (?, ?)", [s[0], s[1]]);
  }

  const sum = await db.one(
    "SELECT (SELECT COUNT(*) FROM admins) AS admins, (SELECT COUNT(*) FROM nodes) AS nodes, " +
    "(SELECT COUNT(*) FROM nodes WHERE branch_kind='trunk') AS trunk, " +
    "(SELECT COUNT(*) FROM nodes WHERE branch_kind='branch') AS branch, " +
    "(SELECT COUNT(*) FROM nodes WHERE branch_kind='lateral') AS laterals"
  );
  console.log("完成：", sum);
  await db.close();
}

main().catch(function (e) {
  console.error("seed 失败：", e && e.message || e);
  process.exit(1);
});
