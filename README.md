# La Pluma

<div align="center">
  <img src="client/public/logo-graphite.svg" alt="La Pluma Logo" width="120" />
  <p><em>MAA CLI 的现代化 WebUI 与本地 Agent 控制台</em></p>
  
  [![Docker Pulls](https://img.shields.io/docker/pulls/miaona/la-pluma)](https://hub.docker.com/r/miaona/la-pluma)
  [![Docker Image Size](https://img.shields.io/docker/image-size/miaona/la-pluma/latest)](https://hub.docker.com/r/miaona/la-pluma)
  [![GitHub Actions](https://github.com/mps233/La-pluma/workflows/Docker%20Build%20and%20Push/badge.svg)](https://github.com/mps233/La-pluma/actions)
</div>

> **项目名称由来**：La Pluma（羽毛笔）是《明日方舟》中的五星近卫干员，本项目以此命名，致敬这位优雅的女士。

## ✨ 特性

- 🧭 **控制台总览** - 汇总今日活动、任务状态、实时预览和掉落信息
- 🎮 **自动化任务流程** - 启动游戏、理智作战、基建换班、自动公招、信用收支、领取奖励、关闭游戏
- 🎯 **多关卡支持** - 每个关卡独立设置次数，支持活动关卡代号自动替换（HD-X → OR-X）
- 🧠 **智能检测** - 日常/芯片本开放日检测、理智耗尽自动停止、游戏状态监控
- ⏰ **定时任务** - 支持多个定时任务，实时显示执行状态和进度
- 🖥️ **模拟器预览** - 集成 ScrcpyOverWebRTC，支持网页内查看和基础设备控制
- 📊 **数据与养成** - 识别仓库和干员 Box，统计掉落，生成干员养成材料计划
- 🧰 **小工具** - 像素画填色、自动提升潜能、材料合成、肉鸽刷取和活动商店兑换
- 🎲 **新版肉鸽/生息演算** - 支持黑流树海、界园、萨卡兹等主题与重启锚点模式
- 📱 **Telegram 通知** - 任务完成后发送通知，包含截图和详细总结
- 🤖 **Bot 远程控制** - 通过 Telegram Bot 远程执行任务
- 🤖 **Agent API** - 通过 `/api/agent` 暴露 manifest/status/actions，方便 AI 或脚本调用
- 🎨 **现代化 UI** - React 原生 iOS 26 风格壳层 + Tailwind CSS + Framer Motion，支持深色模式
- 📲 **PWA 支持** - 在 HTTPS 或 localhost 下可安装，离线可打开已缓存界面
- 🔄 **实时更新** - 轮询 Agent API 刷新任务状态与日志（约 1–5 秒）

## 📸 界面预览

### Web 端

<p align="center">
  <img src="screenshots/automation-web-theme-split.png" alt="自动化任务桌面端" width="92%" />
  <br />
  <em>自动化任务桌面端</em>
</p>

### 移动端

<p align="center">
  <img src="screenshots/automation-mobile-theme-split.png" alt="自动化任务移动端" width="36%" />
  <br />
  <em>自动化任务移动端</em>
</p>

## 🧭 当前架构

La Pluma 是一个面向《明日方舟》自动化的本地 Web 控制台。前端负责配置、编排和可视化；后端负责调用 `maa` CLI、ADB、ScrcpyOverWebRTC 和本地 JSON 配置。

当前后端入口主要挂载两类 API：

- `/api/agent` - 主控制接口，覆盖 MAA 命令、任务状态、日志、截图、WebRTC、养成、调度、通知和数据接口。
- `/api/operator-quotes` - 干员语音/台词相关接口。

历史拆分路由已清理；新增功能应优先接入 `/api/agent`。

### 前端 UI 与响应式壳层

前端使用 React 19、Tailwind CSS 和 Framer Motion。页面 chrome、导航栏、移动 tabbar、主题切换和安全区由 `Layout` 与 common 组件统一提供；壳层结构、导航规则和主题约定见 `DESIGN.md`，这里不再重复。

## 🤖 Agent API

La Pluma 提供一层给 AI/Agent 使用的轻量控制接口。它不是前端内部 API 的简单暴露，而是更语义化的 manifest/status/actions 层，方便 Agent 或自定义自动化发现能力、读取状态和执行动作。Manifest 与 OpenAPI 由同一份能力清单生成，并公开每个动作的风险、dry-run、轮询和停止方式。

### 发现能力

```bash
curl http://localhost:3000/api/agent/manifest
curl http://localhost:3000/api/agent/openapi.json
```

### 读取状态

```bash
curl http://localhost:3000/api/agent/status
```

返回内容会汇总：MAA 版本、任务状态、ADB 连接、前台窗口、WebRTC 预览可用性、最近日志和下一步建议。

连接相关接口默认读取 `profileId: "default"` 对应的连接配置，也可以选择其它已保存配置。显式传入的 `adbPath`、`address` 或 `clientType` 会覆盖该配置中的同名字段。

### 推荐执行流程

```bash
# 检查模拟器连接
curl -X POST http://localhost:3000/api/agent/actions/test-connection \
  -H 'Content-Type: application/json' \
  -d '{"profileId":"default"}'

# WebRTC 实时预览
curl -X POST http://localhost:3000/api/agent/webrtc/start \
  -H 'Content-Type: application/json' \
  -d '{"profileId":"default","deviceId":"mumu-la-pluma"}'

# 启动游戏
curl -X POST http://localhost:3000/api/agent/actions/start-game \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: start-game-20260712-01' \
  -d '{"profileId":"default","waitForCompletion":true}'

# 先检查理智作战计划，不触发 MAA
curl -X POST http://localhost:3000/api/agent/actions/fight \
  -H 'Content-Type: application/json' \
  -d '{"stages":[{"stage":"1-7","times":3}],"medicine":0,"stone":0,"dryRun":true}'

# 检查已保存的今日流程
curl -X POST http://localhost:3000/api/agent/actions/run-daily-flow \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true}'

# 确认计划后开始今日流程
curl -X POST http://localhost:3000/api/agent/actions/run-daily-flow \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: daily-flow-20260712-01' \
  -d '{"dryRun":false}'

# 轮询当前任务、流程状态和最近日志
curl 'http://localhost:3000/api/agent/runs/current?lines=80'

# 按启动响应中的 runId 查询本次执行，即使任务已经结束仍可读取终态
curl 'http://localhost:3000/api/agent/runs/00000000-0000-4000-8000-000000000000'

# 只终止指定 run，避免误停随后启动的其它任务
curl -X POST http://localhost:3000/api/agent/actions/stop \
  -H 'Content-Type: application/json' \
  -d '{"runId":"00000000-0000-4000-8000-000000000000"}'
```

所有标准响应都包含 `success`、`message` 和 `meta`。真实执行响应还包含稳定的 `runId`、`run`、`pollUrl` 和 `stopUrl`；后台接受执行时返回 HTTP `202`。Dry-run 响应会设置 `meta.dryRun: true`；失败响应的 `error` 包含稳定的 `code`、`details` 与 `retryable`，执行器忙碌时返回 HTTP `409`。

`Idempotency-Key` 是可选请求头，适用于活动作业、启动游戏、理智作战、通用任务和今日流程。幂等键按执行动作分区；同一动作使用相同 key 和相同请求参数重试时不会再次启动，而是返回原 `runId`，对象键顺序不影响比较，但显式参数差异会被视为不同输入。相同 key 搭配不同输入会返回 `AGENT_IDEMPOTENCY_KEY_REUSED`。Run 与幂等记录默认持久化到 `server/data/agent-runs.json`，正常重启后仍会保留；重启时尚未结束的 run 会变为不可自动重试的 `interrupted`，且不会自动续跑。终态最多保留 24 小时和 500 条，达到数量上限时可能提前淘汰。

当前持久化保证以单个 La Pluma 服务实例为边界。不要让多个 Node.js 进程同时读写同一个 Run 存储文件；需要修改路径时可设置 `LA_PLUMA_AGENT_RUN_STORE`。

### 通用任务

优先使用 `fight`、`run-daily-flow` 等语义化动作。只有明确知道 MAA CLI 参数时，才使用高风险的通用白名单入口：

```bash
# 执行白名单 maa-cli 任务
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -d '{"command":"award","args":[],"taskName":"领取奖励","waitForCompletion":true}'

# 执行动态任务配置
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -d '{"command":"run","args":["agent-award"],"taskConfig":{"name":"领取奖励","type":"Award","params":{"award":true}},"waitForCompletion":true}'

# 多关卡动态任务：每个子任务单独校验，适用于临期药天数、外服掉落或 7–10 倍代理
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -d '{"command":"run","args":["fight"],"taskConfig":{"name":"理智作战","type":"Fight","tasks":[{"name":"1-7","type":"Fight","params":{"stage":"1-7","times":2,"medicine_expire_days":2,"server":"JP"}},{"name":"CE-6","type":"Fight","params":{"stage":"CE-6"}}]},"waitForCompletion":true}'
```

如果设置了 `LA_PLUMA_TOKEN`，Agent API、其它 `/api/*` 以及 WebRTC 同源网关的票据入口都需要 `Authorization: Bearer <token>` 或 `X-La-Pluma-Token`。未设置时认证关闭。

## 📋 前置要求

- **操作系统**: macOS / Linux
- **Node.js** 22.12+
- **MAA CLI** 已安装
  - macOS: `brew install MaaAssistantArknights/tap/maa-cli`
  - Linux: 参考 [MAA CLI 文档](https://maa.plus/docs/manual/cli/)
- 已执行 `maa install` 安装 MaaCore 及资源

## 🖥️ 跨平台支持

La Pluma 支持 macOS 和 Linux 系统。项目会自动检测操作系统并使用对应的配置路径：

### 配置文件路径

- **macOS**: `~/Library/Application Support/com.loong.maa/`
- **Linux**: `~/.config/maa/` (遵循 XDG 标准)

服务器启动时会自动显示当前系统的路径配置。

## 🚀 快速开始

### 方式 1: 本地安装（推荐）

#### 1. 克隆仓库

```bash
git clone https://github.com/mps233/La-pluma.git
cd La-pluma
```

#### 2. 安装依赖

```bash
# 安装所有依赖（根目录、前端、后端）
npm run install:all
```

#### 3. 启动服务

```bash
# 同时启动前端和后端
npm run dev

# 或分别启动
npm run dev:client  # 前端: http://localhost:5173
npm run dev:server  # 后端: http://localhost:3000
```

#### 4. 访问应用

打开浏览器访问 http://localhost:5173

### 方式 2: Docker 部署

> ✨ **推荐方式**：使用 Docker Hub 预构建镜像，开箱即用！

#### 使用 Docker Hub 镜像（推荐）

```bash
# 拉取最新镜像
docker pull miaona/la-pluma:latest

# 运行容器
docker run -d \
  --name la-pluma \
  -p 3055:3000 \
  -v /path/to/data:/app/server/data \
  -v /path/to/config:/root/.config/maa \
  -v /path/to/maacore:/root/.local/share/maa \
  -e ADB_ADDRESS=192.168.x.x:5555 \
  miaona/la-pluma:latest

# 如需开启 API 鉴权，把下面一行插入到镜像名前：
#   -e LA_PLUMA_TOKEN=change-me \

# 访问应用
# 浏览器打开 http://localhost:3055
```

可选环境变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 后端监听端口 | `3000` |
| `LA_PLUMA_BASE_PATH` | 生产环境前端挂载路径，需与构建时 `VITE_BASE_PATH` 一致 | `/` |
| `ADB_PATH` | ADB 可执行文件路径 | `/opt/homebrew/bin/adb` |
| `ADB_ADDRESS` | 默认 ADB 设备地址 | `127.0.0.1:16384` |
| `MAA_CLI_PATH` | `maa` CLI 可执行文件路径 | 本地为 `maa`，Docker 为 `/usr/local/bin/maa` |
| `MAA_CLIENT_TYPE` | 默认客户端类型 | `Official` |
| `LA_PLUMA_TOKEN` | 设置后 `/api/*` 与 WebRTC 票据入口需要 Bearer Token 或 `X-La-Pluma-Token` | 空，不启用 |
| `LA_PLUMA_AGENT_RUN_STORE` | Agent Run 与幂等记录的持久化文件 | `server/data/agent-runs.json` |
| `LA_PLUMA_MAX_REALTIME_LOGS` | 实时日志内存缓存最大行数 | `5000` |
| `LA_PLUMA_WEBRTC_DIR` | ScrcpyOverWebRTC 工作目录 | `$HOME/ScrcpyOverWebRTC` |
| `LA_PLUMA_WEBRTC_PORT` | ScrcpyOverWebRTC 本地端口 | `8443` |
| `LA_PLUMA_WEBRTC_VERSION` | 安装/升级时使用的 ScrcpyOverWebRTC Release 版本；`latest` 使用最新稳定版 | `latest` |
| `LA_PLUMA_WEBRTC_USERNAME` | ScrcpyOverWebRTC 管理账号 | `admin` |
| `LA_PLUMA_WEBRTC_PASSWORD` | ScrcpyOverWebRTC 管理密码；建议修改上游默认值后同步设置 | 上游默认值 |
| `LA_PLUMA_WEBRTC_TOKEN_TTL_MS` | 信令 token 缓存时间 | `300000` |
| `LA_PLUMA_WEBRTC_DEVICE_SECRET` | 可选的设备注册密钥；服务端与 Agent 必须一致，需要 ScrcpyOverWebRTC v0.4.3+ | 空，不启用 |
| `LA_PLUMA_WEBRTC_TURN_USERNAME` | 本地 TURN 用户名 | `cloudphone_user` |
| `LA_PLUMA_WEBRTC_TURN_PASSWORD` | 本地 TURN 密码；建议修改 | 本地默认值 |
| `LA_PLUMA_HTTPS_CERT_PATH` | 可选 HTTPS 证书链路径，必须与私钥同时配置 | 空，使用 HTTP |
| `LA_PLUMA_HTTPS_KEY_PATH` | 可选 HTTPS 私钥路径，必须与证书同时配置 | 空，使用 HTTP |

#### PWA、HTTPS 与实时预览

实时预览会读取 ScrcpyOverWebRTC 的 `/devices`，只把在线设备视为可用，并展示服务端与设备端 Agent 版本。设备端 Agent 低于 `v0.4.3` 时，预览界面会提示重新部署；`v0.4.3` 移除了旧版 Agent 的内置到期限制，升级服务端后应同时重新部署设备端 Agent。

浏览器预览统一通过同源 `/webrtc-signaling` 网关连接，上游管理凭据只保存在 La Pluma 后端；即使传入直连地址，也会改为通过同源网关。仪表盘快照优先使用 ScrcpyOverWebRTC 的 `/snapshots`，失败时再回退到 ADB 截图。

设置 `LA_PLUMA_WEBRTC_DEVICE_SECRET` 后，La Pluma 会把它同时传给服务端和 ADB 部署的 Agent。已有 Magisk/App 部署的 Agent 也需要配置相同的 `DEVICE_SECRET`，否则无法注册；未设置时保持原有开放注册行为。

“安装组件/重装组件”会从 GitHub Release 下载 `cloudphone-vX.Y.Z.zip`，使用 Release 提供的 SHA256 摘要校验后解压安装；升级时保留现有 `data/` 与 `certs/`，并把旧目录备份为 `ScrcpyOverWebRTC.backup-*`。安装或升级前需要先停止 WebRTC 服务。安装会在后台执行，界面通过 `/api/agent/webrtc/install/status` 轮询结果；可用 `LA_PLUMA_WEBRTC_VERSION` 固定版本，默认跟随最新稳定版。

PWA 的 Service Worker 只会在 HTTPS 或浏览器认可的本机 `localhost` 安全上下文中启用。生产构建在电脑本机通过 `http://localhost:*` 打开时可以安装；手机通过 `http://192.168.x.x:*` 访问时不能安装，也不会获得离线界面缓存。Vite 开发模式默认不注册 Service Worker。

不要把 `5173` 的 Vite 开发服务器作为手机主屏幕或公网长期入口。开发服务器的 HMR 连接在 iOS 后台挂起后可能触发整页重载；手机入口应使用 `npm run build --prefix client` 生成的正式资源，并由下方的生产服务或可信 HTTPS 反向代理提供。

La Pluma 可以直接使用可信证书启动 HTTPS：

```bash
npm run build --prefix client

NODE_ENV=production \
LA_PLUMA_HTTPS_CERT_PATH=/path/to/fullchain.pem \
LA_PLUMA_HTTPS_KEY_PATH=/path/to/privkey.pem \
npm run start --prefix server
```

Docker 部署时把证书只读挂载到容器，并同时设置这两个变量：

```bash
docker run -d \
  --name la-pluma \
  -p 3055:3000 \
  -v /path/to/certs:/app/certs:ro \
  -v /path/to/data:/app/server/data \
  -e LA_PLUMA_HTTPS_CERT_PATH=/app/certs/fullchain.pem \
  -e LA_PLUMA_HTTPS_KEY_PATH=/app/certs/privkey.pem \
  -e LA_PLUMA_TOKEN=change-me \
  miaona/la-pluma:latest
```

证书必须受访问设备信任，并覆盖实际使用的域名或 IP。仅在浏览器中临时忽略自签名证书警告，不能可靠满足 PWA 安装要求。网络访问建议始终配置 `LA_PLUMA_TOKEN`。

HTTPS 下的实时预览使用同源 `/webrtc-signaling` 网关并自动升级为 WSS，不再让浏览器直连不安全的 `ws://`。如果由 Caddy、Nginx 或 NAS 反向代理终止 TLS，需要把 `/api`、`/health` 和 `/webrtc-signaling` 一并转发到 La Pluma，并允许 `/webrtc-signaling` 的 WebSocket Upgrade。

PWA 缓存范围仅包含界面资源。断网时可以打开已缓存页面，但 MAA、ADB、实时预览、状态读取和所有自动化操作仍需要连接 La Pluma 后端；页面会持续显示断连状态并禁用控制台执行入口。

##### 子路径部署

部署到 `/la-pluma/` 等子路径时，需要在构建前设置：

```bash
VITE_BASE_PATH=/la-pluma/ npm run build --prefix client

NODE_ENV=production \
LA_PLUMA_BASE_PATH=/la-pluma/ \
npm run start --prefix server

# Docker 本地构建
docker build --build-arg VITE_BASE_PATH=/la-pluma/ -t la-pluma:local .
```

本地运行时要让 `LA_PLUMA_BASE_PATH` 与构建时的 `VITE_BASE_PATH` 保持一致；通过 Docker build arg 构建时，镜像会自动写入对应的运行时挂载路径。反向代理应保留 `/la-pluma/` 前缀转发，同时继续同源转发根路径 `/api`、`/health` 与 `/webrtc-signaling`。路径建议以前导和结尾 `/` 表示，构建与服务端都会自动规范常见写法。

#### 使用 Docker Compose（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/mps233/La-pluma.git
cd La-pluma

# 2. 编辑 docker-compose.yml，修改 volumes 和 ADB_ADDRESS
nano docker-compose.yml

# 3. 启动服务（会自动拉取镜像）
docker-compose up -d

# 4. 查看日志
docker-compose logs -f
```

#### 本地构建镜像

如果需要修改代码后构建：

```bash
# 编辑 docker-compose.yml
# 注释掉: image: miaona/la-pluma:latest
# 取消注释: build 部分

# 构建并启动
docker-compose up -d --build
```

**配置说明**：
- 宿主机端口：`3055`，容器内端口：`3000`
- 数据持久化：`docker-compose.yml` 挂载三个目录——`server/data`（配置与运行数据）、`/root/.config/maa`（MAA 配置）、`/root/.local/share/maa`（MaaCore 与资源）；宿主机路径按部署环境调整
- ADB 连接：在 WebUI 中配置设备地址（如 `127.0.0.1:5555`）
- 首次启动会自动下载 MaaCore（约 5-10 分钟）

**支持架构**：
- `linux/amd64` - x86_64 服务器、PC
- `linux/arm64` - ARM64 服务器、Apple Silicon

## 📦 项目结构

```
la-pluma/
├── client/                    # 前端 (React + TypeScript + Vite + Tailwind CSS + Framer Motion)
│   ├── src/
│   │   ├── components/        # UI 组件
│   │   │   ├── Dashboard.tsx          # 控制台总览
│   │   │   ├── AutomationTasks.tsx    # 自动化任务流程
│   │   │   ├── CombatTasks.tsx        # 作业、SSS、悖论模拟
│   │   │   ├── RoguelikeTasks.tsx     # 肉鸽模式
│   │   │   ├── OperatorTraining.tsx   # 干员养成计划
│   │   │   ├── CustomTools.tsx        # 小工具（像素画、材料合成等）
│   │   │   ├── DataStatistics.tsx     # 仓库、干员和掉落数据
│   │   │   ├── LogViewer.tsx          # 日志查看
│   │   │   ├── ConfigManager.tsx      # 配置管理
│   │   │   ├── ScreenMonitor.tsx      # 截图与设备预览
│   │   │   ├── ScrcpyDeviceView.tsx   # WebRTC 实时预览
│   │   │   └── ...
│   │   ├── services/          # API 调用
│   │   │   └── api.ts         # /api/agent API 封装
│   │   ├── stores/            # Zustand 状态管理
│   │   ├── hooks/             # 预览、API 请求等 Hook
│   │   └── utils/             # 工具函数
│   └── public/                # 静态资源（Logo、图标）
├── server/                    # 后端 (Node.js + Express)
│   ├── routes/                # API 路由
│   │   ├── agent.js           # 主 Agent API
│   │   ├── agentContract.js   # Agent 能力清单 / OpenAPI 注册表
│   │   └── operatorQuotes.js  # 干员台词接口
│   ├── services/              # 业务逻辑
│   │   ├── maaService.js      # MAA CLI、ADB、截图、实时日志
│   │   ├── schedulerService.js # 定时任务调度
│   │   ├── customTaskService.js # Custom 小工具参数校验与任务配置
│   │   ├── notificationService.js # 通知服务
│   │   ├── operatorTrainingService.js # 养成计划和材料计算
│   │   ├── webrtcService.js   # ScrcpyOverWebRTC 管理
│   │   └── configStorageService.js # 配置存储
│   ├── data/                  # 用户配置数据
│   │   └── user-configs/      # 任务配置 JSON 文件
│   └── server.js              # 服务器入口
├── package.json               # 根目录脚本
└── README.md                  # 项目文档
```

## 🎯 核心功能

### 控制台总览

- ✅ **今日活动** - 查看当前活动、开放日常本和推荐操作
- ✅ **实时预览** - 通过 ScrcpyOverWebRTC 查看模拟器画面
- ✅ **状态汇总** - 聚合当前任务、调度、掉落和养成数据

### 自动化任务流程

- ✅ **启动游戏** - 自动启动明日方舟客户端
- ✅ **理智作战** - 支持多关卡，每个关卡独立次数设置
  - 自动替换活动关卡代号（HD-X → OR-X）
  - 日常/芯片本开放日检测（CE-6、AP-5、CA-5、SK-5、LS-6、PR-A/B/C/D）
  - 理智耗尽自动停止后续关卡
  - 支持剿灭作战（Annihilation）
- ✅ **基建换班** - 自动收菜、换班、无人机加速
- ✅ **自动公招** - 自动刷新、选择标签、确认招募
- ✅ **信用收支** - 自动访问好友、收取信用、购买商品
- ✅ **领取奖励** - 自动领取每日、每周、邮件等奖励
- ✅ **关闭游戏** - 任务完成后自动关闭游戏

### 定时任务

- 支持多个定时任务，每个任务独立配置
- 实时显示执行状态和进度动画
- 任务完成后自动发送 Telegram 通知

### 作业与肉鸽

- 支持普通作业、作业集、SSS 作业和悖论模拟
- 作业集使用 `prts://s<id>`；支持连续执行与手动逐关，旧 URI 写法仅保留输入兼容
- 支持从链接或关卡名搜索作业
- 集成战略支持傀影、水月、萨米、萨卡兹、界园和黑流树海主题；新模式覆盖月度小队、深入调查、常乐节点、襁褓动物和刷开局
- 肉鸽支持三顺位开局干员 `core_char_list` 和逐位助战
- 生息演算支持沙洲遗闻与重启锚点，包含 RA-1 / RA-15 / RA-4 模式

### 小工具

- 像素画填色：24×24 点阵与 0–39 色板，支持参数检查和真实执行
- 自动提升潜能、缺口材料合成、刷傀影皇冠、活动商店兑换
- 所有工具先校验参数；真实执行前会明确提示会改变游戏或账号状态

### 数据与养成

- 从 MAA 识别结果解析仓库和干员 Box；干员识别保存全干员列表，支持未拥有筛选和收集率
- 仓库识别保留完整度，并展示基础资源、材料、消耗品和活动纪念品分类
- 读取材料数据库和关卡开放日，计算干员精二/技能所需材料
- 维护养成队列，并可将养成计划应用回自动化任务流程
- 记录并统计掉落数据

### Telegram 通知

- 任务完成通知（成功/失败/跳过统计）
- 自动截图并发送
- 详细的任务总结（关卡、次数、掉落、耗时）

## ⚙️ 配置说明

### ADB 连接配置

在"配置 → 连接配置"中设置 ADB 路径和设备地址：

- **ADB 路径**：默认 `/opt/homebrew/bin/adb`
- **设备地址**：
  - 本地模拟器：`emulator-5554` 或 `127.0.0.1:5555`
  - 远程设备：`192.168.x.x:16384`（需要开启网络 ADB）

### Telegram 通知配置

在"自动化任务"页面的"定时与通知"区域配置：

1. 创建 Telegram Bot（通过 @BotFather）
2. 获取 Bot Token
3. 获取 Chat ID（通过 @userinfobot）
4. 填入配置并测试

**Bot 远程控制**：保存配置并重启服务后，Bot 会随服务启动，支持以下命令：

```
/help - 显示帮助信息
/status - 查看当前任务状态
/start /stop - 开始或停止当前任务
/fight <关卡> - 执行理智作战（例如：/fight 1-7）
/roguelike [主题] - 执行肉鸽任务（例如：/roguelike Sami）
/copilot - 执行抄作业
/startup /closedown - 启动或关闭游戏客户端
/screenshot - 获取当前截图
```

**注意**：Bot 只响应配置的 Chat ID，其他用户无法控制。

## 🛠️ 技术栈

- **前端框架**: React 19 + TypeScript + Vite
- **UI 框架**: Tailwind CSS + Framer Motion + 项目语义组件与 `ios-theme.css`
- **图标**: Lucide React
- **状态管理**: Zustand
- **后端**: Node.js + Express
- **状态刷新**: 前端轮询 `/api/agent`
- **API 访问**: 前端统一通过 `client/src/services/api.ts` 调用 `/api/agent/*`
- **MAA 集成**: 通过子进程调用 `maa` CLI 命令
- **模拟器连接**: ADB + ScrcpyOverWebRTC
- **定时任务**: node-cron
- **数据来源**: MAA 识别结果和本地游戏数据 JSON
- **通知服务**: Telegram Bot API 和任务完成通知

## 📝 开发指南

### 文档地图

| 文档 | 负责的内容 |
| --- | --- |
| `README.md` | 产品能力、架构、安装部署、Agent API 概览 |
| `AGENTS.md` | 编码 agent 的工作规则、验证命令与交付标准 |
| `DESIGN.md` | 视觉规范与组件选型的唯一事实源 |
| `client/src/components/common/README.md` | 通用组件的 props 与用法示例 |
| `server/README.md` | 服务端工具类与数据脚本 |
| `docs/maa.md` | MAA 集成现状、未完成项与 CLI 事实 |

规范类内容只在对应文件中维护一次，其他文档引用而不复制；修改规范时同步更新该文件本身。

### 常用检查

验证命令与交付标准统一维护在 `AGENTS.md` 的 Commands 与 Definition Of Done 两节，这里不再重复。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [MAA (MaaAssistantArknights)](https://github.com/MaaAssistantArknights/MaaAssistantArknights) - 明日方舟游戏助手
- [maa-cli](https://github.com/MaaAssistantArknights/maa-cli) - MAA 命令行工具
