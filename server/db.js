"use strict";
const fs = require("fs");
const path = require("path");
const cfg = require("./config");

let sqlite = null;
let pool = null;
const RE_READ = /^\s*(select|with|pragma|explain|show)\b/i;

function driver() { return cfg.db.driver === "mysql" ? "mysql" : "sqlite"; }
function sqlitePath() {
  const p = path.isAbsolute(cfg.db.file) ? cfg.db.file : path.join(cfg.root, cfg.db.file);
  return p;
}
function getSqlite() {
  if (sqlite) return sqlite;
  const { DatabaseSync } = require("node:sqlite");
  const file = sqlitePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  return sqlite;
}
function getPool() {
  if (pool) return pool;
  const mysql = require("mysql2/promise");
  pool = mysql.createPool({
    host: cfg.mysql.host, port: cfg.mysql.port, user: cfg.mysql.user,
    password: cfg.mysql.password, database: cfg.mysql.database,
    connectionLimit: cfg.mysql.connectionLimit, waitForConnections: true,
    charset: "utf8mb4", dateStrings: true, decimalNumbers: true
  });
  return pool;
}
function bind(st, params) {
  const p = params || [];
  return Array.isArray(p) ? st.run(...p) : st.run(p);
}
async function q(sql, params) {
  if (driver() === "mysql") {
    const [rows] = await getPool().execute(sql, params || []);
    return rows;
  }
  const dbh = getSqlite();
  const st = dbh.prepare(sql);
  if (RE_READ.test(sql)) return st.all(...(params || []));
  const r = bind(st, params);
  return { affectedRows: Number(r.changes || 0), insertId: Number(r.lastInsertRowid || 0) };
}
async function one(sql, params) {
  const rows = await q(sql, params);
  return Array.isArray(rows) ? (rows[0] || null) : rows;
}
async function exec(script) {
  if (driver() === "mysql") {
    const stmts = String(script).split(/;\s*(?:\r?\n|$)/).map(s => s.trim())
      .filter(s => s && !/^--/.test(s) && !/^CREATE DATABASE/i.test(s));
    for (const s of stmts) await getPool().query(s);
    return stmts.length;
  }
  getSqlite().exec(String(script));
  return null;
}
async function ping() {
  if (driver() === "mysql") {
    const conn = await getPool().getConnection();
    try { await conn.ping(); } finally { conn.release(); }
    return true;
  }
  getSqlite().prepare("SELECT 1 AS ok").get();
  return true;
}
async function close() {
  if (pool) { try { await pool.end(); } catch (e) {} pool = null; }
  if (sqlite) { try { sqlite.close(); } catch (e) {} sqlite = null; }
}
function nowStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

module.exports = {
  nowStr, driver, q, one, exec, ping, close, getPool, getSqlite, path: sqlitePath };
