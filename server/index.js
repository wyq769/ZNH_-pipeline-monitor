"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const cfg = require("./config");
const H = require("./http");
const db = require("./db");
const A = require("./auth");
const rAuth = require("./routes/auth");
const rNodes = require("./routes/nodes");
const rSystem = require("./routes/system");

const PUBLIC_API = new Set([
  "/api/health",
  "/api/config",
  "/api/auth/login",
  "/api/auth/dev-login"
]);

const ROUTES = [
  ["POST", /^\/api\/auth\/login$/, (req, res) => rAuth.login(req, res)],
  ["POST", /^\/api\/auth\/dev-login$/, (req, res) => rAuth.devLogin(req, res)],
  ["POST", /^\/api\/auth\/logout$/, (req, res) => rAuth.logout(req, res)],
  ["POST", /^\/api\/auth\/password$/, (req, res) => rAuth.changePassword(req, res)],
  ["GET", /^\/api\/auth\/me$/, (req, res) => rAuth.me(req, res)],
  ["GET", /^\/api\/health$/, (req, res) => rSystem.health(req, res)],
  ["GET", /^\/api\/config$/, (req, res) => rSystem.publicConfig(req, res)],
  ["GET", /^\/api\/audit$/, (req, res, m, url) => rSystem.auditList(req, res, url)],
  ["GET", /^\/api\/settings$/, (req, res) => rSystem.settingsGet(req, res)],
  ["PATCH", /^\/api\/settings$/, (req, res) => rSystem.settingsPatch(req, res)],
  ["GET", /^\/api\/nodes$/, (req, res) => rNodes.list(req, res)],
  ["POST", /^\/api\/nodes$/, (req, res) => rNodes.create(req, res)],
  ["GET", /^\/api\/nodes\/meta$/, (req, res) => rNodes.meta(req, res)],
  ["GET", /^\/api\/nodes\/([A-Za-z0-9_-]{1,16})$/, (req, res, m, url, p1) => rNodes.detail(req, res, p1)],
  ["PATCH", /^\/api\/nodes\/([A-Za-z0-9_-]{1,16})$/, (req, res, m, url, p1) => rNodes.update(req, res, p1)],
  ["DELETE", /^\/api\/nodes\/([A-Za-z0-9_-]{1,16})$/, (req, res, m, url, p1) => rNodes.remove(req, res, p1)]
];

function ipOf(req) { return String(req.socket.remoteAddress || "").replace(/^::ffff:/, ""); }

function redirect(res, to) {
  res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

function serveFile(res, absPath) {
  try {
    const body = fs.readFileSync(absPath);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": body.length,
      "Cache-Control": "no-cache"
    });
    res.end(body);
    return true;
  } catch (e) {
    return false;
  }
}

async function handlePage(req, res, p) {
  const token = H.parseCookies(req)[cfg.cookieName];
  const admin = await A.findSession(token);

  if (p === "/") {
    redirect(res, admin ? "/dashboard" : "/login");
    return true;
  }
  if (p === "/login") {
    if (admin) { redirect(res, "/dashboard"); return true; }
    return serveFile(res, path.join(cfg.publicDir, "login.html"));
  }
  if (p === "/dashboard") {
    if (!admin) { redirect(res, "/login"); return true; }
    const dash = path.join(cfg.publicDir, "dashboard.html");
    if (fs.existsSync(dash)) return serveFile(res, dash);
    return serveFile(res, path.join(cfg.root, "pipeline-preview.html"));
  }
  if (p === "/logout") {
    await A.destroySession(token);
    H.clearCookie(res, cfg.cookieName);
    redirect(res, "/login");
    return true;
  }
  return false;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const p = url.pathname;
  const m = req.method;

  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");

  if ((m === "GET" || m === "HEAD") && !p.startsWith("/api/")) {
    if (await handlePage(req, res, p)) return;
  }

  if (p.startsWith("/api/")) {
    if (m !== "GET" && m !== "HEAD") {
      const origin = req.headers.origin;
      if (origin) {
        let host = null;
        try { host = new URL(origin).host; } catch (e) { host = null; }
        if (!host || host !== req.headers.host) {
          return H.sendJson(res, 403, { error: "跨站请求被拒绝" });
        }
      }
    }

    if (!PUBLIC_API.has(p)) {
      const token = H.parseCookies(req)[cfg.cookieName];
      const admin = await A.findSession(token);
      if (!admin) return H.sendJson(res, 401, { error: "未登录或会话已过期", code: "NO_SESSION" });
      req.admin = admin;
    } else if (p === "/api/auth/me" || p === "/api/audit") {
      /* 已在上面的分支处理 */
    }

    for (let i = 0; i < ROUTES.length; i++) {
      const r = ROUTES[i];
      if (r[0] !== m) continue;
      const mm = r[1].exec(p);
      if (!mm) continue;
      return r[2](req, res, m, url, mm[1]);
    }
    return H.sendJson(res, 404, { error: "接口不存在: " + m + " " + p });
  }

  if ((m === "GET" || m === "HEAD") && H.serveStatic(req, res, cfg.publicDir, p)) return;

  H.sendText(res, 404, "404 Not Found");
}

const server = http.createServer(function (req, res) {
  Promise.resolve()
    .then(() => handleRequest(req, res))
    .catch(function (err) {
      const status = err.status || 500;
      if (status >= 500) console.error("[500]", req.method, req.url, err.stack || err.message);
      if (!res.headersSent) {
        H.sendJson(res, status, { error: status >= 500 ? "服务器内部错误" : err.message });
      } else {
        try { res.end(); } catch (e) { /* ignore */ }
      }
    });
});

const HOST = cfg.host || "127.0.0.1";

server.listen(cfg.port, HOST, function () {
  console.log("管道智能化检测系统 · 服务已启动");
  console.log("  地址   http://" + (HOST === "0.0.0.0" ? "localhost" : HOST) + ":" + cfg.port + "/");
  console.log("  数据库  " + (db.driver() === "sqlite" ? "SQLite · data/app.db" : "MySQL · " + cfg.mysql.user + "@" + cfg.mysql.host + ":" + cfg.mysql.port + "/" + cfg.mysql.database));
  console.log("  调试登录 " + (cfg.devLogin ? "已启用（任何人可免密进入）" : "已关闭"));
});

db.ping().then(function () {
  return A.purgeExpired();
}).catch(function (e) {
  console.error("  MySQL 连接失败: " + e.code + " - " + e.message);
  console.error("  请先启动 MySQL 并执行 npm run seed（详见 README）");
});

setInterval(function () {
  A.purgeExpired().catch(function () { /* ignore */ });
}, 30 * 60 * 1000);

["SIGINT", "SIGTERM"].forEach(function (sig) {
  process.on(sig, function () {
    console.log("\n收到 " + sig + "，正在关闭...");
    server.close(function () {
      db.close().finally(function () { process.exit(0); });
    });
    setTimeout(function () { process.exit(0); }, 3000);
  });
});
