"use strict";
const crypto = require("crypto");
const cfg = require("./config");
const { q } = require("./db");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

function hashPassword(pwd) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pwd), salt, SCRYPT.keylen, SCRYPT);
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

function verifyPassword(pwd, saltB64, hashB64) {
  try {
    const a = crypto.scryptSync(String(pwd), Buffer.from(saltB64, "base64"), SCRYPT.keylen, SCRYPT);
    const b = Buffer.from(hashB64, "base64");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

async function createSession(adminId, ip, ua) {
  const token = crypto.randomBytes(32).toString("base64url");
  const exp = Date.now() + cfg.sessionTtlH * 3600 * 1000;
  await q("INSERT INTO sessions (token_hash, admin_id, expires_at, ip, ua) VALUES (?,?,?,?,?)",
    [sha256(token), adminId, exp, String(ip || "").slice(0, 64), String(ua || "").slice(0, 255)]);
  return token;
}

async function findSession(token) {
  if (!token) return null;
  const rows = await q(
    "SELECT s.token_hash, s.expires_at, a.id, a.username, a.role, a.status, a.must_change_pwd " +
    "FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? LIMIT 1",
    [sha256(token)]
  );
  const r = rows[0];
  if (!r) return null;
  if (Number(r.expires_at) <= Date.now() || r.status !== "active") {
    await q("DELETE FROM sessions WHERE token_hash = ?", [r.token_hash]);
    return null;
  }
  return { id: r.id, username: r.username, role: r.role, mustChangePwd: !!r.must_change_pwd };
}

async function destroySession(token) {
  if (token) await q("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
}

async function purgeExpired() {
  await q("DELETE FROM sessions WHERE expires_at <= ?", [Date.now()]);
}

/* ---- 登录失败限流（单进程内存） ---- */
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAIL = 5;
const fails = new Map();

function failKey(username, ip) { return String(username || "").toLowerCase() + "|" + (ip || ""); }

function lockedMs(username, ip) {
  const k = failKey(username, ip);
  const r = fails.get(k);
  if (!r) return 0;
  if (r.until && Date.now() < r.until) return r.until - Date.now();
  if (Date.now() > r.expire) { fails.delete(k); return 0; }
  return 0;
}

function noteFail(username, ip) {
  const k = failKey(username, ip);
  const r = fails.get(k) || { n: 0, until: 0, expire: 0 };
  if (Date.now() > r.expire) { r.n = 0; r.until = 0; }
  r.n += 1;
  r.expire = Date.now() + WINDOW_MS;
  if (r.n >= MAX_FAIL) r.until = Date.now() + WINDOW_MS;
  fails.set(k, r);
  return Math.max(0, MAX_FAIL - r.n);
}

function clearFails(username, ip) { fails.delete(failKey(username, ip)); }

async function audit(admin, action, target, detail, ip, ua) {
  try {
    await q(
      "INSERT INTO audit_logs (admin_id, username, action, target, detail, ip, ua) VALUES (?,?,?,?,?,?,?)",
      [admin ? admin.id : null, admin ? admin.username : (detail && detail.username) || null,
       action, target || null, detail ? JSON.stringify(detail) : null,
       String(ip || "").slice(0, 64), String(ua || "").slice(0, 255)]
    );
  } catch (e) {
    console.warn("[audit] 写入失败:", e.message);
  }
}

module.exports = {
  hashPassword, verifyPassword, sha256,
  createSession, findSession, destroySession, purgeExpired,
  lockedMs, noteFail, clearFails, audit,
  MAX_FAIL
};
