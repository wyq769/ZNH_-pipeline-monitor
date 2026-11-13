"use strict";
const cfg = require("../config");
const H = require("../http");
const db = require("../db");
const { q } = require("../db");

const startedAt = Date.now();

async function health(req, res) {
  let dbOk = false, dbErr = null;
  try { dbOk = await db.ping(); } catch (e) { dbErr = e.code || e.message; }
  H.sendJson(res, dbOk ? 200 : 503, {
    ok: dbOk,
    db: dbOk ? "up" : "down",
    driver: db.driver(),
    dbError: dbErr,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    node: process.version,
    time: new Date().toISOString()
  });
}

function publicConfig(req, res) {
  H.sendJson(res, 200, {
    devLogin: cfg.devLogin,
    brand: cfg.brand,
    sessionTtlH: cfg.sessionTtlH,
    forcePwdChange: cfg.forcePwdChange
  });
}

async function auditList(req, res, url) {
  if (req.admin.role !== "admin") return H.sendJson(res, 403, { error: "没有权限" });
  let limit = Number(url.searchParams.get("limit") || 50);
  if (!isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;
  const rows = await q(
    "SELECT id, admin_id, username, action, target, detail, ip, created_at " +
    "FROM audit_logs ORDER BY id DESC LIMIT " + Math.floor(limit)
  );
  H.sendJson(res, 200, { logs: rows });
}

const SETTING_KEYS = ["uploadMs"];
const ALLOWED_UPLOAD_MS = [1000, 2000, 3000, 5000, 10000, 30000];

async function settingsGet(req, res) {
  var out = {};
  for (var i = 0; i < SETTING_KEYS.length; i++) {
    var k = SETTING_KEYS[i];
    var row = await db.one("SELECT v FROM settings WHERE k = ?", [k]);
    if (row && row.v != null) {
      try { out[k] = JSON.parse(row.v); } catch (e) { out[k] = row.v; }
    }
  }
  H.sendJson(res, 200, { settings: out });
}

async function settingsPatch(req, res) {
  if (req.admin.role !== "admin") return H.sendJson(res, 403, { error: "没有权限" });
  var body = await H.readBody(req);
  if (!body || typeof body !== "object") return H.sendJson(res, 400, { error: "请求体无效" });
  if (body.uploadMs !== undefined) {
    var ms = Number(body.uploadMs);
    if (ALLOWED_UPLOAD_MS.indexOf(ms) < 0) return H.sendJson(res, 400, { error: "上传频率取值不合法" });
    var exists = await db.one("SELECT k FROM settings WHERE k = ?", ["uploadMs"]);
    if (exists) await q("UPDATE settings SET v = ? WHERE k = ?", [JSON.stringify(ms), "uploadMs"]);
    else await q("INSERT INTO settings (k, v) VALUES (?, ?)", ["uploadMs", JSON.stringify(ms)]);
  }
  H.sendJson(res, 200, { ok: true });
}

module.exports = { health, publicConfig, auditList, settingsGet, settingsPatch };
