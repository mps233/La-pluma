# 部署指南

> [← 返回文档索引](../README.md)

本地开发安装见根目录 README 的“快速开始”。

## Docker 部署

> ✨ **推荐方式**：使用 GHCR 预构建镜像，开箱即用！

### 使用 GHCR 镜像（推荐）

```bash
# 拉取最新镜像
docker pull ghcr.io/dongwlin/la-pluma-next:latest

# 运行容器
docker run -d \
  --name la-pluma-next \
  -p 127.0.0.1:3055:3000 \
  -v /path/to/data:/app/server/data \
  -v /path/to/config:/root/.config/maa \
  -v /path/to/maacore:/root/.local/share/maa \
  -v /path/to/maa-state:/root/.local/state/maa \
  -v /path/to/webrtc:/root/ScrcpyOverWebRTC \
  -e ADB_ADDRESS=192.168.x.x:5555 \
  -e LA_PLUMA_TOKEN=change-me \
  ghcr.io/dongwlin/la-pluma-next:latest

# 访问应用
# 浏览器打开 http://localhost:3055
```

`LA_PLUMA_TOKEN` 是网络访问的必配项，保护 `/api/*` 与 WebRTC 票据入口；请替换为足够长的随机值。示例把端口绑定在 `127.0.0.1`，只允许本机访问；需要手机或局域网访问时，确认 token 已配置并配合防火墙后再改为 `-p 3055:3000`。

> 首次发布后请在 GitHub Package settings 中把 `la-pluma-next` 镜像设为 Public；如果保持私有，拉取前需要先执行 `docker login ghcr.io`。

`latest` 跟随最近发布的正式版本，预发布和 `main` 推送不会更新它；补发旧正式版本也会更新 `latest`。可以使用完整版本标签（如 `0.0.6`），同时提供 amd64 与 arm64 两个架构；预发布使用完整标签（如 `0.1.0-rc.1`）。Docker 标签可覆盖，需要固定镜像内容时使用 digest。

镜像内的 maa-cli 固定到上游 release（当前 `v0.7.8`），并在构建时按目标架构校验 SHA-256；升级时通过 `MAA_CLI_VERSION` 与对应的 `MAA_CLI_SHA256_AMD64` / `MAA_CLI_SHA256_ARM64` 构建参数更新。首次启动的 `maa install` 仍会从上游解析并下载 MaaCore 与资源，需要完全可复现的 MaaCore 版本时请预置并复用数据卷。

下表中的 `apps/server/data` 是源码运行的数据目录。镜像中对应的数据卷挂载点为 `/app/server/data`。

可选环境变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 后端监听端口；必须为 0-65535 的整数，否则服务拒绝启动 | `3000` |
| `LA_PLUMA_BASE_PATH` | 生产环境前端挂载路径，需与构建时 `VITE_BASE_PATH` 一致 | `/` |
| `ADB_PATH` | ADB 可执行文件路径 | Docker 为 `/usr/bin/adb`；本地按平台：macOS `/opt/homebrew/bin/adb`、Linux `/usr/bin/adb`、Windows `adb.exe` |
| `ADB_ADDRESS` | 默认 ADB 设备地址 | `127.0.0.1:16384` |
| `MAA_CLI_PATH` | `maa` CLI 可执行文件路径 | 本地为 `maa`，Docker 为 `/usr/local/bin/maa` |
| `MAA_CLIENT_TYPE` | 默认客户端类型 | `Official` |
| `LA_PLUMA_TOKEN` | 设置后 `/api/*` 与 WebRTC 票据入口需要 Bearer Token 或 `X-La-Pluma-Token` | 空，不启用 |
| `LA_PLUMA_AGENT_RUN_STORE` | Agent Run 与幂等记录的持久化文件 | `apps/server/data/agent-runs.json` |
| `LA_PLUMA_DROP_RECORDS_DIR` | 掉落记录目录 | `apps/server/data/drop-records` |
| `LA_PLUMA_MAA_LOCK_FILE` | MAA 执行互斥锁文件 | `apps/server/data/maa-execution.lock` |
| `LA_PLUMA_MAA_MAINTENANCE_TIMEOUT_MS` | Core 安装/更新维护命令的 execFile 超时；非法值回落默认，超上限收敛到上限 | `900000`（上限 `3600000`） |
| `LA_PLUMA_TRAINING_DATA_DIR` | 养成与参考数据目录（队列、材料表、干员材料、掉落统计、仓库/干员识别结果） | `apps/server/data` |
| `LA_PLUMA_GAME_ASSET_DIR` | 本地图标与头像根目录（含 `item/`、`avatar/` 子目录，文件名规则与 MAA 模板一致：物品 id / 干员 id）；缺省按资源覆盖顺序读取各候选资源层生效的 `template/items`、`template/avatar` | MAA 资源目录下的 `template` |
| `LA_PLUMA_COPILOT_PROGRESS_STORE` | 作业集共享进度文件 | `apps/server/data/copilot-progress.json` |
| `LA_PLUMA_COPILOT_NATIVE_DELEGATION` | 原生 `maa copilot` 委托开关（灰度）；设为 `1`/`true`/`on`/`yes`/`enable`/`enabled`（大小写不敏感）时启用，未设置、空值或其它取值时走现有流程 | 关闭 |
| `LA_PLUMA_ACTIVITY_COPILOT_PROGRESS_STORE` | 当前活动通关进度文件（只读历史数据） | `apps/server/data/activity-copilot-progress.json` |
| `LA_PLUMA_OPERATOR_QUOTES_STORE` | 干员台词数据文件 | `apps/server/data/operatorQuotes.json` |
| `LA_PLUMA_MAX_REALTIME_LOGS` | 实时日志内存缓存最大行数 | `5000` |
| `LA_PLUMA_WEBRTC_DIR` | ScrcpyOverWebRTC 工作目录 | `$HOME/ScrcpyOverWebRTC`（Docker 为 `/root/ScrcpyOverWebRTC`） |
| `LA_PLUMA_WEBRTC_PORT` | ScrcpyOverWebRTC 本地端口 | `8443` |
| `LA_PLUMA_WEBRTC_TURN_PORT` | 受管 TURN 服务端口 | `3478` |
| `LA_PLUMA_WEBRTC_USERNAME` | 网关登录上游 ScrcpyOverWebRTC 的账号；必须与上游实际账号一致 | `admin` |
| `LA_PLUMA_WEBRTC_PASSWORD` | 网关登录上游 ScrcpyOverWebRTC 的密码；不会自动生成或轮换 | `admin123` |
| `LA_PLUMA_WEBRTC_VIEWER_IDLE_GRACE_MS` | 最后一位观看者退出后释放设备 Agent 的等待时间（毫秒） | `3000` |
| `LA_PLUMA_WEBRTC_VIEWER_STARTUP_GRACE_MS` | Agent 启动后无人观看时的等待时间（毫秒） | `15000` |
| `LA_PLUMA_WEBRTC_HOST_IP` | 向设备公布的宿主机 IPv4 地址；默认优先选择与目标 ADB 地址同网段的网卡 | 自动检测 |
| `LA_PLUMA_WEBRTC_TURN_SERVER_PATH` | 本地 `turnserver` 可执行文件路径；默认探测常见安装位置 | 自动检测 |
| `LA_PLUMA_WEBRTC_ICE_SERVERS` | 自定义 STUN/TURN 列表；未设置且无本地 TURN 时使用局域网直连 | 自动检测 |
| `LA_PLUMA_WEBRTC_ARCHIVE` | 安装/升级时使用的本地官方 `cloudphone-v0.4.3.zip`，同样校验 SHA-256 | 自动下载 |
| `LA_PLUMA_WEBRTC_REQUEST_TIMEOUT_MS` | 探测上游 ScrcpyOverWebRTC HTTP 接口的超时时间（毫秒） | `1500` |
| `LA_PLUMA_WEBRTC_SERVER_START_TIMEOUT_MS` | 等待信令服务就绪的超时时间（毫秒） | `15000` |
| `LA_PLUMA_WEBRTC_AGENT_START_TIMEOUT_MS` | 等待设备 Agent 就绪的超时时间（毫秒） | `20000` |
| `LA_PLUMA_WEBRTC_TURN_START_TIMEOUT_MS` | 等待 TURN 监听就绪的超时时间（毫秒） | `5000` |
| `LA_PLUMA_WEBRTC_START_POLL_INTERVAL_MS` | 启动就绪探测的轮询间隔（毫秒） | `250` |
| `LA_PLUMA_HTTPS_CERT_PATH` | 可选 HTTPS 证书链路径，必须与私钥同时配置 | 空，使用 HTTP |
| `LA_PLUMA_HTTPS_KEY_PATH` | 可选 HTTPS 私钥路径，必须与证书同时配置 | 空，使用 HTTP |

### 存活与就绪检查

容器健康检查继续请求根路径 `/health`，只判断进程是否仍在应答。该端点不执行 ADB、MAA 或外网探测，设备离线不会让存活检查失败，也不会触发无意义的重启。

首次启动会在 entrypoint 中执行 `maa install --force` 安装 MaaCore，通常需要 5-10 分钟。Dockerfile 与 Compose 的健康检查 `start-period` 均为 600 秒，安装期间不会因健康检查失败被判定为不健康或触发重启；安装完成后才进入常规探测。

根路径 `/readiness` 表达是否应接收业务流量：运行时初始化未完成、Run 存储不可用或服务正在关闭（draining/closed）时返回 503，其余稳定运行状态返回 200。响应只包含生命周期、初始化与 Run 存储的粗粒度状态和稳定原因码，不包含文件路径、凭据或底层错误文本，并设置 `Cache-Control: no-store`。与 `/health` 一样，`/readiness` 不受 `LA_PLUMA_TOKEN` 约束，便于本机与编排探针直接调用；`/api` 的鉴权行为不变。

反向代理和编排应把 `/readiness` 用于摘除流量，不要用它重启容器：draining 期间 `/health` 仍为 200，进程正在停止执行并等待 Run 落盘。

### PWA、HTTPS 与实时预览

概览、日常、作业、肉鸽、养成、数据与日志页共用预览，默认关闭，需手动选择快照或实时。自动回收通过同源 `/webrtc-signaling` 网关统计观看者，并在释放前核对上游设备的 `client_count` / `clients`。旧版上游若仅返回设备 ID 字符串，只能根据网关观看者判断；未携带设备 ID 的旧网关连接会保守阻止自动回收。项目仍使用单个受管设备 Agent，自动回收仅停止匹配的设备，不关闭信令和 TURN 服务。

预览启停只释放本实例启动的资源：停止接口与服务关闭流程都不会终止启动前已存在的信令服务、TURN 或设备端 Agent。`/api/agent/webrtc/*` 状态中的 `ownership` 以 `managed`、`external`、`none` 标注 server、turn 与 agent 的归属，停止响应的 `released` 列出本次实际释放的 `server`、`turn`、`agent-deployment` 与 `device-agent`；需要接管外部启动的组件时先手动停止它，再由本服务启动。

### 信令凭据与上游端口边界

同源网关每次签发票据都用本机回环地址登录上游 ScrcpyOverWebRTC。账号来自 `LA_PLUMA_WEBRTC_USERNAME` / `LA_PLUMA_WEBRTC_PASSWORD`，未配置时沿用上游出厂值 `admin` / `admin123`。服务不会生成随机密码，也不会改写上游的账号数据，因此两侧始终使用同一组显式或默认值；只改一侧时网关登录失败，票据入口返回 503，不会回退到默认值掩盖不一致。

迁移默认弱口令的顺序固定：先在 ScrcpyOverWebRTC 中修改管理员账号，再把两个变量设置为同一组值并重启本服务。未配置账号时启动日志会提示默认弱口令仍在生效。默认值保留是为了兼容由本服务直接启动的上游安装；它不会阻止外部已有账号，账号是否可用始终以上游登录结果为准。

受管信令服务为设备端 Agent 监听局域网地址，它的管理界面、`/api` 与 `/devices` 不经过本服务的 `LA_PLUMA_TOKEN` 鉴权，只在 `/webrtc-signaling` 网关后隐藏。局域网或不受信任网络部署应修改上游默认账号，或用防火墙限制 `LA_PLUMA_WEBRTC_PORT` 的来源；浏览器预览仍只经过同源网关。

PWA 的 Service Worker 只会在 HTTPS 或浏览器认可的本机 `localhost` 安全上下文中启用。生产构建在电脑本机通过 `http://localhost:*` 打开时可以安装；手机通过 `http://192.168.x.x:*` 访问时不能安装，也不会获得离线界面缓存。Vite 开发模式默认不注册 Service Worker。

不要把 `5173` 的 Vite 开发服务器作为手机主屏幕或公网长期入口。开发服务器的 HMR 连接在 iOS 后台挂起后可能触发整页重载；手机入口应使用 `pnpm --filter la-pluma-next-client build` 生成的正式资源，并由下方的生产服务或可信 HTTPS 反向代理提供。

La Pluma Next 可以直接使用可信证书启动 HTTPS：

```bash
pnpm --filter la-pluma-next-client build

NODE_ENV=production \
LA_PLUMA_HTTPS_CERT_PATH=/path/to/fullchain.pem \
LA_PLUMA_HTTPS_KEY_PATH=/path/to/privkey.pem \
pnpm start
```

Docker 部署时把证书只读挂载到容器，并同时设置这两个变量：

```bash
docker run -d \
  --name la-pluma-next \
  -p 127.0.0.1:3055:3000 \
  -v /path/to/certs:/app/certs:ro \
  -v /path/to/data:/app/server/data \
  -e LA_PLUMA_HTTPS_CERT_PATH=/app/certs/fullchain.pem \
  -e LA_PLUMA_HTTPS_KEY_PATH=/app/certs/privkey.pem \
  -e LA_PLUMA_TOKEN=change-me \
  ghcr.io/dongwlin/la-pluma-next:latest
```

证书必须受访问设备信任，并覆盖实际使用的域名或 IP。仅在浏览器中临时忽略自签名证书警告，不能可靠满足 PWA 安装要求。网络访问必须配置 `LA_PLUMA_TOKEN`。

HTTPS 下的实时预览使用同源 `/webrtc-signaling` 网关并自动升级为 WSS，不再让浏览器直连不安全的 `ws://`。如果由 Caddy、Nginx 或 NAS 反向代理终止 TLS，需要把 `/api`、`/health`、`/readiness`、`/game-assets` 和 `/webrtc-signaling` 一并转发到 La Pluma Next，并允许 `/webrtc-signaling` 的 WebSocket Upgrade。`/game-assets` 只提供同源只读图标与头像，不需要 token，也不能省略：漏转发时页面其余功能正常，但图标与头像会全部 404。

反向代理还需要容忍长时间的同步维护请求。Core 安装/更新（`POST /api/agent/actions/update-core`）默认按 `LA_PLUMA_MAA_MAINTENANCE_TIMEOUT_MS` 同步执行并整体返回，耗时可达 15-60 分钟；Nginx 默认 `proxy_read_timeout 60s` 会在等待期间断开连接，浏览器表现为网络错误或 504，而服务端更新仍在继续，此时重试会因执行租约被占用返回 409 `MAA_EXECUTION_BUSY`。请求体传 `waitForCompletion:false` 时，维护更新会在取得执行权后立即返回 202 与 `runId`，随后用 `GET /api/agent/runs/{runId}` 轮询终态，避免代理读超时；不传该字段时仍保持同步整体返回的兼容行为。由反向代理转发 `/api` 时，若继续使用同步模式，应为该路径放宽读超时（不低于维护超时上限，例如 Nginx 的 `proxy_read_timeout 3700s;`），或改用支持长等待的配置；无法调整代理时，应在发起更新前预留足够的等待窗口，避免误判失败后重复触发。

PWA 缓存范围仅包含界面资源。断网时可以打开已缓存页面，但 MAA、ADB、实时预览、状态读取和所有自动化操作仍需要连接 La Pluma Next 后端；页面会持续显示断连状态并禁用控制台执行入口。

### 跨域与访问来源

同源是默认且完整的支持方式：Web UI 与 `/api`、`/health`、`/readiness`、`/game-assets`、`/webrtc-signaling` 同源部署（根路径或反向代理后的同源子路径）时无需关心跨域头部。跨域调用按以下策略支持：

- 鉴权只由 token 承担，CORS 不作为鉴权。`/api` 与 WebRTC 票据入口对任何来源应答 CORS 预检（`OPTIONS` 无需 token）并返回 `Access-Control-Allow-Origin: *`，但这只声明浏览器可跨域读取响应；`/api` 的来源不构成访问边界。配置 `LA_PLUMA_TOKEN` 后，`/api` 与票据入口要求 `Authorization: Bearer <token>` 或 `X-La-Pluma-Token`；网络访问建议始终配置该 token。
- 本地图标与头像（`/game-assets`）只服务同源页面：响应不返回 `Access-Control-Allow-Origin`，并声明 `Cross-Origin-Resource-Policy: same-origin`，跨源页面无法读取或嵌入本机资源目录；同源 `<img>` 加载不受影响。
- 未配置 `LA_PLUMA_TOKEN` 时，`/api/agent/diagnostics` 额外按来源地址限流（默认每分钟 30 次，超限返回 429 `AGENT_RATE_LIMITED` 并带 `Retry-After`），避免匿名并发请求放大 MAA/ADB 探测；配置 token 后由鉴权承担边界。
- 令牌比较先对两侧做摘要再使用恒定时间比较：长度差异、非字符串请求头或格式错误只会返回 401 `AGENT_AUTH_REQUIRED`，不会抛错，也不会回显预期值、变量名或长度。认证失败按来源地址限流（默认每分钟 10 次），超限返回 429 `AGENT_RATE_LIMITED` 并带 `Retry-After`；有效令牌不参与失败计数，也不会被同一来源的失败额度阻塞。限额是进程内计数、重启清零，不跨实例共享；未启用 `trust proxy`，反向代理后所有客户端共享代理连接地址的额度。
- 不支持浏览器凭据模式：服务端不使用 Cookie，不返回 `Access-Control-Allow-Credentials`。以 `credentials: 'include'` 发起的跨域请求会被浏览器拒绝；调用方应改用上述 token 头并保持默认的 `credentials: 'same-origin'`。关闭凭据并不限制请求来源——任何来源都可携带 token 调用开放接口，未携带有效 token 的 `/api` 请求一律 401。
- 实时预览的 `/webrtc-signaling` 网关继续按同源方式使用：HTTP 票据入口受同一 token 保护，其余信令管理端点不通过应用端口暴露，WebSocket 升级只服务持一次性票据的观看连接。票据签发自成边界：未设置 `LA_PLUMA_TOKEN` 的本地/LAN 模式只接受同源签发，`Origin` 的主机名必须与 `Host` 一致（端口不参与比较，兼容本地开发代理）；无 `Origin` 的非浏览器调用保持可用，跨源请求返回 403 `AGENT_SIGNALING_ORIGIN_FORBIDDEN`。设置 token 后由 token 把关，来源不再作为额外边界。两种模式都按来源地址限制签发频率（默认每分钟 30 次），反向代理需要保留原始 `Host` 主机名。

### 子路径部署

部署到 `/la-pluma-next/` 等子路径时，需要在构建前设置：

```bash
VITE_BASE_PATH=/la-pluma-next/ pnpm --filter la-pluma-next-client build

NODE_ENV=production \
LA_PLUMA_BASE_PATH=/la-pluma-next/ \
pnpm start

# Docker 本地构建
docker build --build-arg VITE_BASE_PATH=/la-pluma-next/ -t la-pluma-next:local .
```

本地运行时要让 `LA_PLUMA_BASE_PATH` 与构建时的 `VITE_BASE_PATH` 保持一致；通过 Docker build arg 构建时，镜像会自动写入对应的运行时挂载路径。反向代理应保留 `/la-pluma-next/` 前缀转发，同时继续同源转发根路径 `/api`、`/health`、`/readiness`、`/game-assets` 与 `/webrtc-signaling`。`/game-assets` 是只读免 token 的同源资产命名空间，漏转发会让图标与头像在子路径部署下全部 404。路径建议以前导和结尾 `/` 表示，构建与服务端都会自动规范常见写法。

### 使用 Docker Compose（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/dongwlin/La-pluma-next.git
cd La-pluma-next

# 2. 从示例创建环境文件，设置必配的 LA_PLUMA_TOKEN 和 ADB_ADDRESS
cp .env.example .env
nano .env

# 3. 按需修改 docker-compose.yml 的 volumes 与端口绑定
nano docker-compose.yml

# 4. 启动服务（会自动拉取镜像；缺少 LA_PLUMA_TOKEN 时 Compose 拒绝启动）
docker-compose up -d

# 5. 查看日志
docker-compose logs -f
```

Compose 默认把宿主机端口绑定到 `127.0.0.1:3055`，只允许本机访问；需要手机或局域网访问时，确认 `.env` 中的 `LA_PLUMA_TOKEN` 足够强并配合防火墙后再改为 `3055:3000`。

### 本地构建镜像

如果需要修改代码后构建：

```bash
# 编辑 docker-compose.yml
# 注释掉: image: ghcr.io/dongwlin/la-pluma-next:latest
# 取消注释: build 部分

# 构建并启动
docker-compose up -d --build

# 国内网络下依赖下载较慢，可改用镜像源构建
docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t la-pluma-next:local .
```

镜像默认使用 `registry.npmjs.org`，CI 也使用该默认值；`NPM_REGISTRY` 只影响构建时的依赖下载，不会写入运行环境。

**配置说明**：
- 宿主机端口：默认 `127.0.0.1:3055`（仅本机），容器内端口：`3000`
- 数据持久化：`./docker-data/server/`、`./docker-data/maa-config/`、`./docker-data/maa-core/`、`./docker-data/maa-state/`、`./docker-data/webrtc/`
  - `server/` 保存应用运行数据；`maa-config/`、`maa-core/`、`maa-state/` 分别对应 MAA 的配置、数据与状态目录（日志、缓存）
  - `webrtc/` 保存 ScrcpyOverWebRTC 工作目录（`LA_PLUMA_WEBRTC_DIR`，容器内默认 `/root/ScrcpyOverWebRTC`），避免重建容器后重新下载或构建
- ADB 连接：在 WebUI 中配置设备地址（如 `127.0.0.1:5555`）
- 首次启动会自动下载 MaaCore（约 5-10 分钟）

### 参考数据与运行数据

镜像只包含程序，不包含游戏参考数据：`materials.json`、`material-formulas.json`、`operator-materials.json`、`penguin-drop-data.json` 都不随仓库或镜像发布。缺少这些文件时，养成与掉落相关页面会为空；容器启动时 entrypoint 会打印缺失警告，但不会自动联网生成。

在宿主机仓库内生成后，把文件放入持久化数据目录（Compose 默认为 `./docker-data/server/`）：

```bash
pnpm --filter la-pluma-next-server fetch-all-materials
pnpm --filter la-pluma-next-server fetch-formulas
pnpm --filter la-pluma-next-server fetch-materials
pnpm --filter la-pluma-next-server fetch-drop-data

cp apps/server/data/{materials.json,material-formulas.json,operator-materials.json,penguin-drop-data.json} \
  ./docker-data/server/
```

也可以直接把生成好的 `apps/server/data` 目录挂载到 `/app/server/data`。不要把 `user-configs/`、`depot.json`、`operbox.json`、`drop-records/`、`agent-runs.json` 等用户运行数据打进自定义镜像，它们只应通过数据卷持久化。

**支持架构**：
- `linux/amd64` - x86_64 服务器、PC
- `linux/arm64` - ARM64 服务器、Apple Silicon
