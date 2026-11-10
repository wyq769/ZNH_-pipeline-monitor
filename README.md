# 管道智能化检测系统

节点温度 / 流速 / 电伴热监测系统。管理员登录后查看管网拓扑、实时数据与电伴热投切状态。

- 前端：原生 HTML / CSS / JavaScript（无框架），登录页 + 监控面板拆分为多文件
- 后端：Node.js 原生 `node:http`，会话鉴权、节点 CRUD、审计日志
- 数据库：MySQL 8（默认），可一行配置切到 SQLite
- 数据：温度 / 流速 / 电伴热为浏览器本地模拟，暂未接入真实设备

## 快速开始

```bash
npm install          # 首次
双击 启动.bat          # 自动启动 MySQL + 服务 + 打开浏览器
```

或手动：

```bash
启动MySQL.bat
npm run seed         # 首次：建表 + 写入管理员与 30 个节点
npm start            # http://127.0.0.1:8787/
```

- 登录账号：`123456` / `123456`
- 免密调试通道：登录页「免密直达（调试通道）」，上线前用 `config.json` 的 `devLogin: false` 关闭
- 停止 MySQL：`停止MySQL.bat`

## 目录结构

```
server/            后端
  index.js         入口、路由表、页面守卫
  config.js        配置加载（config.json + 环境变量）
  db.js            数据库适配（MySQL / SQLite 双驱动）
  auth.js          scrypt 密码哈希、会话、限流、审计
  http.js          响应、Cookie、静态文件
  routes/          auth / nodes / system
public/            前端
  login.html       登录页
  dashboard.html   监控面板
  assets/          css / js / nodes.json
sql/
  schema.sql       MySQL 结构
  schema.sqlite.sql SQLite 结构
tools/
  seed.js          建表 + 初始数据
  verify_api.js    接口冒烟测试（npm run verify）
  use-mysql.js     切换数据库驱动
  build-demo.js    生成 Netlify 静态演示版
  serve-demo.js    本地预览静态演示版
mysql/             便携版 MySQL 8（不纳入版本库）
```

## 数据库

| 表 | 说明 |
|---|---|
| `admins` | 管理员账号（scrypt 哈希、角色、状态、强制改密） |
| `sessions` | 会话（只存 token 的 SHA-256） |
| `nodes` | 节点基础信息（编号、坐标、管径、上级节点、间距、分支方向、设备 SN、安装日期、负责人、阈值覆盖） |
| `audit_logs` | 操作审计 |
| `settings` | 系统参数 |

切换驱动：

```bash
npm run use:mysql    # 用 E:\智能化\mysql 里的 MySQL
npm run use:sqlite   # 零安装，数据落 data/app.db
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/config` | 公开配置（是否开启免密通道等） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/dev-login` | 免密调试登录 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前管理员 |
| POST | `/api/auth/password` | 修改密码 |
| GET | `/api/nodes` | 节点列表 |
| POST | `/api/nodes` | 新增节点 |
| GET | `/api/nodes/:id` | 节点详情 |
| PATCH | `/api/nodes/:id` | 修改节点 |
| DELETE | `/api/nodes/:id` | 删除节点（有下游子节点时拒绝） |
| GET | `/api/nodes/meta` | 可选上级节点等元信息 |
| GET | `/api/audit` | 审计日志（仅 admin） |

## 监控面板

- 六张 KPI：节点总数、正常、异常、平均温度、平均流速、加热中
- 管网拓扑：主干 + 一级分支 + 横向二级分支，点击节点查看详情
- 节点详情：温度 / 流速仪表（流速阈值按管径 0.6 / 0.9 / 0.9 m/s）、电伴热状态、趋势曲线
- 电伴热控制：本地阈值自动投切（低于阈值自动低功率加热，恢复后自动停止），也支持云端指令（20 秒回执）
- 实时数据表：8 列（节点 / 上传时间 / 管径 / 坐标 / 温度 / 流速 / 加热 / 状态），点击行联动选中

## 部署到 Netlify（静态演示版）

Netlify 只能托管静态文件，跑不了 Node 服务，也连不到本机 MySQL。仓库内置了一个静态演示构建：

```bash
node tools/build-demo.js   # 生成 demo-dist/
node tools/serve-demo.js   # 本地预览 http://127.0.0.1:8090/
```

`demo-dist` 里的 `/api/*` 由前端垫片 `assets/demo-api.js` 模拟，节点数据来自 `public/assets/nodes.json`。
Netlify 导入本仓库后会自动读取 `netlify.toml`（构建命令 `node tools/build-demo.js`，发布目录 `demo-dist`），无需手动配置。

## 上线前必须处理

1. 改掉默认密码 `123456`
2. 关闭免密通道：`config.json` 里 `devLogin: false`
3. `config.json` 含数据库密码，不要提交到公开仓库（已在 `.gitignore`，仓库里提供 `config.example.json`）
4. 把 MySQL 暴露给公网前，先加固账号权限、开启备份
