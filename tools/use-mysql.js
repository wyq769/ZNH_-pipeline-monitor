const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "config.json");
const want = (process.argv[2] || "").toLowerCase();
if (want !== "mysql" && want !== "sqlite") {
  console.error("usage: node tools/use-mysql.js <mysql|sqlite>");
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
cfg.db = cfg.db || { file: "data/app.db" };
cfg.db.driver = want;
if (want === "mysql") {
  cfg.mysql = Object.assign({ host: "127.0.0.1", port: 3306, user: "pipe", password: "Pipe2026!", database: "pipeline_monitor", connectionLimit: 10 }, cfg.mysql || {});
  cfg.mysql.user = process.env.MYSQL_USER || "pipe";
  cfg.mysql.password = process.env.MYSQL_PASSWORD || "Pipe2026!";
}
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
console.log("数据库驱动已切换为: " + want);
if (want === "mysql") {
  console.log("MySQL: " + cfg.mysql.user + "@" + cfg.mysql.host + ":" + cfg.mysql.port + "/" + cfg.mysql.database);
  console.log("下一步: npm run seed  (建库建表并写入管理员与 30 个节点)");
} else {
  console.log("SQLite: " + cfg.db.file + "  (已有数据可直接使用)");
}
console.log("最后请重启服务: npm start");
