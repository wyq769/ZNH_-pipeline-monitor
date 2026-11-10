"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let file = {};
try {
  file = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
} catch (e) {
  console.warn("[config] config.json 读取失败，使用默认值:", e.message);
}
const env = process.env;
const my = file.mysql || {};
const dbf = file.db || {};

const cfg = {
  root: ROOT,
  publicDir: path.join(ROOT, "public"),
  dataDir: path.join(ROOT, "data"),
  port: Number(env.PORT || file.port || 8787),
  mysql: {
    host: env.MYSQL_HOST || my.host || "127.0.0.1",
    port: Number(env.MYSQL_PORT || my.port || 3306),
    user: env.MYSQL_USER || my.user || "root",
    password: env.MYSQL_PASSWORD !== undefined ? env.MYSQL_PASSWORD : (my.password || ""),
    database: env.MYSQL_DATABASE || my.database || "pipeline_monitor",
    connectionLimit: Number(my.connectionLimit || 10)
  },
  db: {
    driver: (env.DB_DRIVER || dbf.driver || "sqlite").toLowerCase(),
    file: env.DB_FILE || dbf.file || "data/app.db"
  },
  sessionTtlH: Number(env.SESSION_TTL_H || file.sessionTtlH || 8),
  devLogin: env.DEV_LOGIN !== undefined ? env.DEV_LOGIN !== "0" : file.devLogin !== false,
  forcePwdChange: !!file.forcePwdChange,
  brand: file.brand || {},
  cookieName: "sid"
};

module.exports = cfg;
