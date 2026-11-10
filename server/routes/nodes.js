"use strict";
const A = require("../auth");
const H = require("../http");
const { q, one } = require("../db");

const FIELDS = ["id", "seq", "label", "x", "y", "dn_mm", "parent_id", "edge_km",
  "branch_dir", "branch_kind", "device_sn", "installed_on", "area", "owner", "note",
  "t_on", "t_off", "flow_lo", "flow_hi", "enabled"];

function ipOf(req) { return String(req.socket.remoteAddress || "").replace(/^::ffff:/, ""); }
function ua(req) { return req.headers["user-agent"] || ""; }

function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }

function num(v, name, min, max) {
  const n = Number(v);
  if (!isFinite(n)) throw bad(name + " 必须是数字");
  if (min != null && n < min) throw bad(name + " 不能小于 " + min);
  if (max != null && n > max) throw bad(name + " 不能大于 " + max);
  return n;
}

async function validate(input, id, isNew) {
  const out = {};
  if (isNew) {
    if (!/^[A-Za-z0-9_-]{2,16}$/.test(String(input.id || ""))) throw bad("节点编号需为 2-16 位字母/数字/-/_");
    out.id = String(input.id);
  }
  if (isNew || input.seq !== undefined) out.seq = Math.round(num(input.seq, "seq", 1, 9999));
  if (isNew || input.x !== undefined) out.x = num(input.x, "x", -1e6, 1e6);
  if (isNew || input.y !== undefined) out.y = num(input.y, "y", -1e6, 1e6);
  if (isNew || input.dn_mm !== undefined) out.dn_mm = Math.round(num(input.dn_mm, "管径", 50, 2000));
  if (isNew || input.branch_dir !== undefined) out.branch_dir = Math.round(num(input.branch_dir, "branch_dir", -1, 1));
  if (isNew || input.branch_kind !== undefined) {
    const k = String(input.branch_kind || "trunk");
    if (["trunk", "branch", "lateral"].indexOf(k) < 0) throw bad("branch_kind 只能是 trunk/branch/lateral");
    out.branch_kind = k;
  }
  if (isNew || input.parent_id !== undefined) {
    const pid = input.parent_id ? String(input.parent_id) : null;
    if (pid && pid === id) throw bad("上游节点不能是自己");
    if (pid) {
      const p = await one("SELECT id FROM nodes WHERE id = ? LIMIT 1", [pid]);
      if (!p) throw bad("上游节点 " + pid + " 不存在");
    }
    out.parent_id = pid;
  }
  if (isNew || input.edge_km !== undefined) {
    out.edge_km = input.edge_km === null || input.edge_km === "" ? null : num(input.edge_km, "间距", 0, 50);
  }
  ["label", "device_sn", "area", "owner", "note"].forEach(function (k) {
    if (isNew || input[k] !== undefined) out[k] = input[k] == null || input[k] === "" ? null : String(input[k]).slice(0, 255);
  });
  if (isNew || input.installed_on !== undefined) {
    out.installed_on = input.installed_on ? String(input.installed_on).slice(0, 10) : null;
  }
  ["t_on", "t_off", "flow_lo", "flow_hi"].forEach(function (k) {
    if (isNew || input[k] !== undefined) {
      out[k] = input[k] === null || input[k] === "" || input[k] === undefined ? null : num(input[k], k, -50, 200);
    }
  });
  if (isNew || input.enabled !== undefined) out.enabled = input.enabled === false || input.enabled === 0 ? 0 : 1;
  return out;
}

async function list(req, res) {
  const rows = await q(
    "SELECT " + FIELDS.join(",") + " FROM nodes ORDER BY seq ASC"
  );
  H.sendJson(res, 200, { nodes: rows, total: rows.length });
}

async function detail(req, res, id) {
  const row = await one("SELECT " + FIELDS.join(",") + " FROM nodes WHERE id = ? LIMIT 1", [id]);
  if (!row) return H.sendJson(res, 404, { error: "节点不存在" });
  H.sendJson(res, 200, { node: row });
}

async function create(req, res) {
  const input = await H.readBody(req);
  const data = await validate(input, null, true);
  const exists = await one("SELECT id FROM nodes WHERE id = ? LIMIT 1", [data.id]);
  if (exists) return H.sendJson(res, 409, { error: "节点编号已存在" });
  const keys = Object.keys(data);
  await q("INSERT INTO nodes (" + keys.join(",") + ") VALUES (" + keys.map(function () { return "?"; }).join(",") + ")",
    keys.map(function (k) { return data[k]; }));
  await A.audit(req.admin, "node_create", data.id, data, ipOf(req), ua(req));
  H.sendJson(res, 201, { node: data });
}

async function update(req, res, id) {
  const input = await H.readBody(req);
  const exists = await one("SELECT id FROM nodes WHERE id = ? LIMIT 1", [id]);
  if (!exists) return H.sendJson(res, 404, { error: "节点不存在" });
  const data = await validate(input, id, false);
  const keys = Object.keys(data);
  if (!keys.length) return H.sendJson(res, 400, { error: "没有可更新的字段" });
  await q("UPDATE nodes SET " + keys.map(function (k) { return k + " = ?"; }).join(", ") + " WHERE id = ?",
    keys.map(function (k) { return data[k]; }).concat([id]));
  await A.audit(req.admin, "node_update", id, data, ipOf(req), ua(req));
  const row = await one("SELECT " + FIELDS.join(",") + " FROM nodes WHERE id = ? LIMIT 1", [id]);
  H.sendJson(res, 200, { node: row });
}

async function remove(req, res, id) {
  const exists = await one("SELECT id FROM nodes WHERE id = ? LIMIT 1", [id]);
  if (!exists) return H.sendJson(res, 404, { error: "节点不存在" });
  const kids = await one("SELECT COUNT(*) AS n FROM nodes WHERE parent_id = ?", [id]);
  if (kids && kids.n > 0) return H.sendJson(res, 409, { error: "仍有下游节点指向该节点，请先调整拓扑" });
  await q("DELETE FROM nodes WHERE id = ?", [id]);
  await A.audit(req.admin, "node_delete", id, null, ipOf(req), ua(req));
  H.sendJson(res, 200, { ok: true });
}

async function meta(req, res) {
  const agg = await one("SELECT COUNT(*) AS total, SUM(enabled = 1) AS enabled, MIN(dn_mm) AS dnMin, MAX(dn_mm) AS dnMax FROM nodes");
  const areas = await q("SELECT area, COUNT(*) AS n FROM nodes WHERE area IS NOT NULL GROUP BY area ORDER BY n DESC");
  const kinds = await q("SELECT branch_kind, COUNT(*) AS n FROM nodes GROUP BY branch_kind");
  H.sendJson(res, 200, { stats: agg, areas: areas, kinds: kinds });
}

module.exports = { list, detail, create, update, remove, meta };
