"use strict";
const BASE = "http://127.0.0.1:8787";
let cookie = "";
function hd(extra) { return Object.assign(cookie ? { cookie } : {}, extra || {}); }
async function step(name, fn) {
  try { const r = await fn(); console.log("  ✓ " + name + (r ? "  " + r : "")); return true; }
  catch (e) { console.log("  ✗ " + name + "  " + e.message); return false; }
}
function must(cond, msg) { if (!cond) throw new Error(msg); }

(async function main() {
  console.log("verify " + BASE);
  await step("GET /api/health", async () => {
    const r = await fetch(BASE + "/api/health");
    const j = await r.json();
    must(r.status === 200 && j.ok !== false, "health " + r.status + " " + JSON.stringify(j));
    return "db=" + (j.db || j.driver || "ok") + " driver=" + (j.driver || "-");
  });
  await step("GET /api/config", async () => {
    const r = await fetch(BASE + "/api/config"); const j = await r.json();
    must(r.ok, "config " + r.status);
    return "devLogin=" + j.devLogin + " project=" + (j.brand && j.brand.project);
  });
  await step("GET /dashboard 未登录 → 302 /login", async () => {
    const r = await fetch(BASE + "/dashboard", { redirect: "manual" });
    must(r.status === 302 && /\/login/.test(r.headers.get("location") || ""), "got " + r.status + " " + r.headers.get("location"));
    return r.headers.get("location");
  });
  await step("GET /login 200", async () => {
    const r = await fetch(BASE + "/login"); const t = await r.text();
    must(r.ok && t.includes("登"), "login " + r.status);
    return t.length + " B";
  });
  await step("POST /api/auth/login 错误密码 → 401", async () => {
    const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "123456", password: "bad" }) });
    must(r.status === 401, "got " + r.status);
    return "401";
  });
  await step("POST /api/auth/login 正确 → 200 + cookie", async () => {
    const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "123456", password: "123456" }) });
    const j = await r.json();
    must(r.ok && j.ok !== false, "login " + r.status + " " + JSON.stringify(j));
    const sc = r.headers.get("set-cookie") || "";
    must(/sid=/.test(sc), "无 Set-Cookie: " + sc);
    cookie = sc.split(";")[0];
    return cookie.slice(0, 12) + "…";
  });
  await step("GET /api/auth/me", async () => {
    const r = await fetch(BASE + "/api/auth/me", { headers: hd() }); const j = await r.json();
    must(r.ok && j.admin && j.admin.username === "123456", JSON.stringify(j));
    return "user=" + j.admin.username + " role=" + j.admin.role;
  });
  await step("GET /api/settings", async () => {
    const r = await fetch(BASE + "/api/settings", { headers: hd() }); const j = await r.json();
    must(r.ok && j.settings, JSON.stringify(j));
    return "uploadMs=" + (j.settings.uploadMs === undefined ? "(未设置)" : j.settings.uploadMs);
  });
  await step("PATCH /api/settings 校验非法值", async () => {
    const r = await fetch(BASE + "/api/settings", {
      method: "PATCH", headers: hd({ "Content-Type": "application/json" }),
      body: JSON.stringify({ uploadMs: 1234 })
    });
    must(r.status === 400, "应为 400，实际 " + r.status);
    return "拒绝 1234 ms";
  });
  await step("PATCH /api/settings 写入 2000", async () => {
    const r = await fetch(BASE + "/api/settings", {
      method: "PATCH", headers: hd({ "Content-Type": "application/json" }),
      body: JSON.stringify({ uploadMs: 2000 })
    });
    const j = await r.json();
    must(r.ok && j.ok, JSON.stringify(j));
    return "uploadMs=2000";
  });
  await step("GET /api/nodes → 30 条", async () => {
    const r = await fetch(BASE + "/api/nodes", { headers: hd() }); const j = await r.json();
    must(r.ok && Array.isArray(j.nodes), JSON.stringify(j).slice(0, 120));
    must(j.nodes.length === 30, "节点数 " + j.nodes.length);
    const n1 = j.nodes.find(n => n.id === "N01");
    must(n1 && n1.dn_mm === 400, "N01 dn " + (n1 && n1.dn_mm));
    return "nodes=" + j.nodes.length + " N01.dn=" + n1.dn_mm;
  });
  await step("GET /api/nodes/N15 详情", async () => {
    const r = await fetch(BASE + "/api/nodes/N15", { headers: hd() }); const j = await r.json();
    must(r.ok, "got " + r.status);
    const n = j.node || j;
    return "id=" + n.id + " kind=" + n.branch_kind + " parent=" + n.parent_id;
  });
  await step("POST /api/auth/logout", async () => {
    const r = await fetch(BASE + "/api/auth/logout", { method: "POST", headers: hd({ origin: BASE }) });
    must(r.ok, "got " + r.status); cookie = ""; return "已退出";
  });
  await step("POST /api/auth/dev-login 免密 → 200", async () => {
    const r = await fetch(BASE + "/api/auth/dev-login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: "{}" });
    const sc = r.headers.get("set-cookie") || "";
    must(r.ok && /sid=/.test(sc), "dev-login " + r.status + " " + JSON.stringify(await r.json().catch(() => ({}))));
    cookie = sc.split(";")[0];
    return "dev cookie ok";
  });
  await step("GET / 已登录 → 302 /dashboard", async () => {
    const r = await fetch(BASE + "/", { headers: hd(), redirect: "manual" });
    must(r.status === 302 && /\/dashboard/.test(r.headers.get("location") || ""), "got " + r.status + " " + r.headers.get("location"));
    return r.headers.get("location");
  });
  console.log("done");
})();
