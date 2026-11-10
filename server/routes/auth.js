"use strict";
const cfg = require("../config");
const A = require("../auth");
const H = require("../http");
const db = require("../db");
const { q, one } = db;

function ipOf(req) { return String(req.socket.remoteAddress || "").replace(/^::ffff:/, ""); }
function ua(req) { return req.headers["user-agent"] || ""; }

async function login(req, res) {
  const body = await H.readBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const ip = ipOf(req);

  if (!username || !password) return H.sendJson(res, 400, { error: "请输入账号和密码" });

  const lock = A.lockedMs(username, ip);
  if (lock > 0) {
    const sec = Math.ceil(lock / 1000);
    return H.sendJson(res, 429, { error: "尝试次数过多，请 " + sec + " 秒后再试", retryAfter: sec }, { "Retry-After": String(sec) });
  }

  const adm = await one("SELECT * FROM admins WHERE username = ? LIMIT 1", [username]);
  const ok = !!adm && adm.status === "active" && A.verifyPassword(password, adm.pwd_salt, adm.pwd_hash);
  if (!ok) {
    A.noteFail(username, ip);
    await A.audit(null, "login_fail", username, { username: username, reason: adm ? "bad_password" : "no_user" }, ip, ua(req));
    return H.sendJson(res, 401, { error: "账号或密码错误" });
  }

  A.clearFails(username, ip);
  const token = await A.createSession(adm.id, ip, ua(req));
  await q("UPDATE admins SET last_login_at = ?, last_login_ip = ? WHERE id = ?", [db.nowStr(), ip, adm.id]);
  await A.audit({ id: adm.id, username: adm.username }, "login", null, null, ip, ua(req));
  H.setCookie(res, cfg.cookieName, token, { maxAge: cfg.sessionTtlH * 3600 });
  H.sendJson(res, 200, { admin: { username: adm.username, role: adm.role, mustChangePwd: !!adm.must_change_pwd } });
}

async function devLogin(req, res) {
  if (!cfg.devLogin) return H.sendJson(res, 404, { error: "Not Found" });
  const adm = await one("SELECT * FROM admins WHERE username = ? LIMIT 1", ["123456"]);
  if (!adm) return H.sendJson(res, 503, { error: "调试账号未初始化，请先运行 npm run seed" });
  const ip = ipOf(req);
  const token = await A.createSession(adm.id, ip, ua(req));
  await q("UPDATE admins SET last_login_at = ?, last_login_ip = ? WHERE id = ?", [db.nowStr(), ip, adm.id]);
  await A.audit({ id: adm.id, username: adm.username }, "dev_login", null, { bypass: true }, ip, ua(req));
  H.setCookie(res, cfg.cookieName, token, { maxAge: cfg.sessionTtlH * 3600 });
  H.sendJson(res, 200, { admin: { username: adm.username, role: adm.role, dev: true } });
}

async function logout(req, res) {
  const token = H.parseCookies(req)[cfg.cookieName];
  const admin = req.admin;
  await A.destroySession(token);
  H.clearCookie(res, cfg.cookieName);
  if (admin) await A.audit(admin, "logout", null, null, ipOf(req), ua(req));
  H.sendJson(res, 200, { ok: true });
}

async function me(req, res) {
  H.sendJson(res, 200, { admin: req.admin });
}

async function changePassword(req, res) {
  const body = await H.readBody(req);
  const oldPwd = String(body.oldPassword || "");
  const newPwd = String(body.newPassword || "");
  if (newPwd.length < 6) return H.sendJson(res, 400, { error: "新密码至少 6 位" });
  if (oldPwd === newPwd) return H.sendJson(res, 400, { error: "新密码不能与原密码相同" });
  const adm = await one("SELECT * FROM admins WHERE id = ? LIMIT 1", [req.admin.id]);
  if (!adm || !A.verifyPassword(oldPwd, adm.pwd_salt, adm.pwd_hash)) {
    return H.sendJson(res, 400, { error: "原密码不正确" });
  }
  const h = A.hashPassword(newPwd);
  await q("UPDATE admins SET pwd_salt = ?, pwd_hash = ?, must_change_pwd = 0 WHERE id = ?", [h.salt, h.hash, adm.id]);
  const token = H.parseCookies(req)[cfg.cookieName] || "";
  await q("DELETE FROM sessions WHERE admin_id = ? AND token_hash <> ?", [adm.id, A.sha256(token)]);
  await A.audit(req.admin, "password_change", adm.username, null, ipOf(req), ua(req));
  H.sendJson(res, 200, { ok: true });
}

module.exports = { login, devLogin, logout, me, changePassword };
