const fs = require("fs");
const path = require("path");

const SRC = "public";
const OUT = "demo-dist";

// 1. 清空输出目录
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });

// 2. 复制静态资源
for (const f of ["login.css", "login.js", "dashboard.css", "dashboard.js", "nodes.json"]) {
  fs.copyFileSync(path.join(SRC, "assets", f), path.join(OUT, "assets", f));
}

// 3. 生成演示用 fetch 垫片
const shim = `(function () {
  "use strict";
  if (!window.__STATIC_DEMO__) return;
  var KEY = "pipe-demo-session";
  var realFetch = window.fetch.bind(window);
  var cache = null;

  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    }));
  }
  function session() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function setSession(u) { localStorage.setItem(KEY, JSON.stringify(u)); }
  function clearSession() { localStorage.removeItem(KEY); }
  var ADMIN = { username: "123456", role: "admin", mustChangePwd: false };

  function nodes() {
    if (cache) return Promise.resolve(cache);
    return realFetch("/assets/nodes.json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) { cache = j.nodes || []; return cache; });
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api/") !== 0) return realFetch(input, init);
    var p = url.split("?")[0];
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var body = {};
    try { if (init && init.body) body = JSON.parse(init.body); } catch (e) {}

    if (p === "/api/config") return json({ devLogin: true, sessionTtlH: 8, forcePwdChange: false, brand: { project: "管道智能化检测系统" }, driver: "demo" });
    if (p === "/api/health") return json({ ok: true, db: "demo", driver: "demo" });

    if (p === "/api/auth/login" && method === "POST") {
      if (body.username === "123456" && body.password === "123456") { setSession(ADMIN); return json({ ok: true, admin: ADMIN }); }
      return json({ error: "账号或密码错误" }, 401);
    }
    if (p === "/api/auth/dev-login") { setSession(ADMIN); return json({ ok: true, admin: ADMIN }); }
    if (p === "/api/auth/logout") { clearSession(); return json({ ok: true }); }
    if (p === "/api/auth/me") { var s = session(); return s ? json({ admin: s }) : json({ error: "未登录或会话已过期", code: "NO_SESSION" }, 401); }
    if (p === "/api/nodes") {
      if (!session()) return json({ error: "未登录或会话已过期", code: "NO_SESSION" }, 401);
      return nodes().then(function (list) { return json({ nodes: list }); });
    }
    var m = /^\\/api\\/nodes\\/([A-Za-z0-9_-]+)$/.exec(p);
    if (m) return nodes().then(function (list) {
      var hit = list.filter(function (n) { return n.id === m[1]; })[0];
      return hit ? json(hit) : json({ error: "节点不存在" }, 404);
    });
    return json({ error: "演示模式未实现该接口" }, 501);
  };
})();
`;
fs.writeFileSync(path.join(OUT, "assets", "demo-api.js"), shim, "utf8");

// 4. 生成带演示垫片的 HTML
function buildPage(file, outName, scriptName) {
  let s = fs.readFileSync(path.join(SRC, file), "utf8");
  s = s.replace("<html", '<html data-demo="1"');
  const verMatch = s.match(new RegExp('<script src="/assets/' + scriptName + '(\\?v=[\\w-]+)?"'));
  const ver = verMatch && verMatch[1] ? verMatch[1] : "";
  const inject = '<script>window.__STATIC_DEMO__ = true;</script>\n  <script src="/assets/demo-api.js"></script>\n  <script src="/assets/' + scriptName + ver + '"></script>';
  s = s.replace(new RegExp('<script src="/assets/' + scriptName + '[^"]*"></script>'), inject);
  fs.writeFileSync(path.join(OUT, outName), s, "utf8");
  if (!s.includes("__STATIC_DEMO__")) throw new Error("注入失败: " + file);
}
buildPage("login.html", "login.html", "login.js");
buildPage("dashboard.html", "dashboard.html", "dashboard.js");
fs.copyFileSync(path.join(OUT, "login.html"), path.join(OUT, "index.html"));

// 5. 路由重写
fs.writeFileSync(path.join(OUT, "_redirects"),
  "/            /login.html     200\n/login       /login.html     200\n/dashboard   /dashboard.html 200\n", "utf8");

console.log("demo-dist 生成完成：", fs.readdirSync(OUT).join(", "));
