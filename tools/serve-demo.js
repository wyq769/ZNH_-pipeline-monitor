const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "demo-dist");
const MAP = { "/": "/login.html", "/login": "/login.html", "/dashboard": "/dashboard.html" };
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer(function (req, res) {
  var u = decodeURIComponent(req.url.split("?")[0]);
  if (MAP[u]) u = MAP[u];
  var f = path.join(ROOT, u);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(f, function (e, buf) {
    if (e) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404 " + u); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
}).listen(8090, "127.0.0.1", function () { console.log("demo server http://127.0.0.1:8090/"); });
