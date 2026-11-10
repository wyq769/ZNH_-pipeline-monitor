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

module.exports = { health, publicConfig, auditList };
