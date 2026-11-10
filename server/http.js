"use strict";
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(res, status, obj, extra) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }, extra || {}));
  res.end(body);
}

function sendText(res, status, text, type) {
  const body = Buffer.from(String(text), "utf8");
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req, limit) {
  const max = limit || 1024 * 1024;
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on("data", function (c) {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(Object.assign(new Error("BAD_JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, opts) {
  const o = opts || {};
  const parts = [name + "=" + encodeURIComponent(value), "Path=" + (o.path || "/")];
  if (o.maxAge != null) parts.push("Max-Age=" + Math.floor(o.maxAge));
  if (o.httpOnly !== false) parts.push("HttpOnly");
  parts.push("SameSite=" + (o.sameSite || "Lax"));
  if (o.secure) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie");
  const list = prev ? (Array.isArray(prev) ? prev.slice() : [prev]) : [];
  list.push(parts.join("; "));
  res.setHeader("Set-Cookie", list);
}

function clearCookie(res, name) {
  setCookie(res, name, "", { maxAge: 0 });
}

function serveStatic(req, res, rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const target = path.resolve(rootDir, "." + rel);
  const rootWithSep = path.resolve(rootDir) + path.sep;
  if (target !== path.resolve(rootDir) && !target.startsWith(rootWithSep)) {
    sendText(res, 403, "Forbidden");
    return true;
  }
  let stat;
  try { stat = fs.statSync(target); } catch (e) { return false; }
  if (stat.isDirectory()) return false;
  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const cache = ext === ".html" ? "no-cache" : "public, max-age=300";
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff"
  });
  if (req.method === "HEAD") res.end(); else res.end(body);
  return true;
}

module.exports = { sendJson, sendText, readBody, parseCookies, setCookie, clearCookie, serveStatic };
