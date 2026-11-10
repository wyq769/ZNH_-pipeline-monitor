"use strict";
const fs = require("fs"), path = require("path");
const roots = process.argv.slice(2);
function strip(p) {
  const b = fs.readFileSync(p);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) { fs.writeFileSync(p, b.slice(3)); return true; }
  return false;
}
let n = 0;
function walk(d) {
  if (!fs.existsSync(d)) return;
  const st = fs.statSync(d);
  if (st.isFile()) { if (strip(d)) { n++; console.log("BOM removed:", d); } return; }
  for (const e of fs.readdirSync(d, { withFileTypes: true })) walk(path.join(d, e.name));
}
roots.forEach(walk);
console.log("done, " + n + " file(s)");
