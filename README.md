# 管道智能化检测系统 · 前后端项目

节点温度 / 流速 / 电伴热监测演示系统。前端为多文件静态页面，后端为 Node 原生 http 服务，数据落库保存节点基础信息与管理员账号。

## 一、快速开始

```bash
npm install          # 首次
npm run seed         # 建表 + 写入管理员与 30 个节点
npm start            # http://127.0.0.1:8787/
```

Windows 上直接双击 **`启动.bat`**：它会先拉起 MySQL（`启动MySQL.bat`），再开浏览器并启动 node 服务。
单独控制数据库：`启动MySQL.bat` / `停止MySQL.bat`。

- 默认管理员：**123456 / 123456**
- 调试通道：登录页「免密直达（调试通道）」，由 `config.json` 的 `devLogin` 控制，上线前务必关闭
- 重置节点：`npm run seed:reset`；重置密码：`node tools/seed.js --force-pwd`
- 接口自检：`npm run verify`
- 数据库：**MySQL 8.0.28，装在 `E:\智能化\mysql`**，数据目录 `mysql\data`，库名 `pipeline_monitor`
  - 应用账号：`pipe / Pipe2026!`（config.json）；root 为空密码，仅监听 127.0.0.1
  - 切回 SQLite：`npm run use:sqlite`；切回 MySQL：`npm run use:mysql`

## 二、目录结构

```
config.json                端口/数据库/品牌/调试开关
mysql/                     MySQL 8.0.28 便携安装（bin/ data/ my.ini）
启动.bat / 启动MySQL.bat / 停止MySQL.bat
server/
  index.js                 入口：路由表、页面守卫、CSRF、优雅关停
  config.js                配置加载（支持环境变量覆盖）
  db.js                    数据库适配层（SQLite / MySQL 双驱动）
  auth.js                  scrypt 口令、会话、登录限流、审计
  http.js                  JSON/静态文件/ Cookie 工具
  routes/auth.js           登录、免密、退出、改密、当前用户
  routes/nodes.js          节点 CRUD + 元信息
  routes/system.js         健康检查、公开配置、审计列表
sql/schema.sqlite.sql      SQLite 结构（默认）
sql/schema.sql             MySQL 8 结构（可选）
public/login.html          登录页
public/dashboard.html      监控面板
public/assets/*.css|js     前端样式与逻辑
tools/seed.js              初始化库与种子数据
tools/verify_api.js        端到端接口自检
data/app.db                SQLite 数据文件（运行后生成）
```

## 三、数据库

默认使用 **SQLite**（Node 24 内置 `node:sqlite`，零安装，文件为 `data/app.db`）。

切换到 MySQL：把 `config.json` 改成

```json
{ "db": { "driver": "mysql", "file": "data/app.db" },
  "mysql": { "host": "127.0.0.1", "port": 3306, "user": "pipe", "password": "******", "database": "pipeline_monitor" } }
```

再执行 `npm run seed`。两套 schema 字段一致，无需改代码。

> 为什么当前不是 MySQL：本机原先未安装 MySQL；便携版 mysqld 放在 `E:\\智能化` 下无法初始化（MySQL 8 在 Windows 上不接受非 ASCII 安装路径），而本环境不允许在 E:\\ 或 C:\\ 下新建目录。若需要 MySQL，建议安装在纯英文路径（如 `C:\\mysql`）并在 `config.json` 填入账号密码。

### 表结构

| 表 | 用途 |
| --- | --- |
| admins | 管理员账号（scrypt 加盐哈希、角色、状态、强制改密标记） |
| sessions | 会话（存 token 的 SHA-256，过期时间用 epoch 毫秒） |
| nodes | 节点基础信息：编号、序号、真实坐标 x/y、管径、上级节点、间距、分支方向/类型、设备 SN、安装日期、片区、负责人、备注、阈值覆盖、启用状态 |
| audit_logs | 审计：登录、节点增删改 |
| settings | 系统参数（devLogin、heatW、tickMs、telemetryKeepDays） |

节点表**不保存"距起点"**：真实坐标已入库，需要时由边权重累加得出。

## 四、接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/health | 健康检查（含驱动名、db 状态） |
| GET | /api/config | 公开配置（品牌、是否开放免密） |
| POST | /api/auth/login | 登录，失败 5 次锁 5 分钟 |
| POST | /api/auth/dev-login | 免密调试登录（受 devLogin 控制） |
| POST | /api/auth/logout | 退出 |
| GET | /api/auth/me | 当前用户（未登录 401） |
| POST | /api/auth/password | 修改密码（校验旧密码，≥6 位） |
| GET | /api/nodes | 节点列表 |
| GET | /api/nodes/meta | 片区、类型等汇总 |
| GET/PATCH/DELETE | /api/nodes/:id | 节点详情/更新/删除（有下游子节点时 409） |
| POST | /api/nodes | 新增节点 |
| GET | /api/audit | 审计日志（仅 admin 角色） |

写操作会校验 `Origin`，防止跨站提交。

## 五、前端行为

- 未登录访问 `/`、`/dashboard` 由服务端 302 到 `/login`，无闪屏
- 登录后 `dashboard.js` 拉 `/api/nodes` 重建管网：由 `parent_id` 组链、`branch_kind/branch_dir/edge_km` 决定布局
- 温度/流速/加热状态仍为**浏览器本地模拟**（2 s 一拍），加热按管径阈值本地自动投切，并支持页面上的"云端指令"20 s 覆盖，便于后续接真实数据
- 顶栏显示当前管理员与退出按钮

## 六、上线前必须处理

1. `config.json` 的 `devLogin` 置为 `false`（或删除免密按钮）
2. 修改默认密码 123456，必要时 `forcePwdChange` 打开
3. 绑定地址如需对外，改 `host` 并置于反向代理/HTTPS 之后
4. 定期备份 `data/app.db`（或 MySQL 库）
