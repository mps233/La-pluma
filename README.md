# La Pluma

<div align="center">
  <img src="client/public/logo.webp" alt="La Pluma Logo" width="120" />
  <p><em>Mac 上 MAA CLI 的现代化 WebUI 界面</em></p>
  
  [![Docker Pulls](https://img.shields.io/docker/pulls/mps233/la-pluma)](https://hub.docker.com/r/mps233/la-pluma)
  [![Docker Image Size](https://img.shields.io/docker/image-size/mps233/la-pluma/latest)](https://hub.docker.com/r/mps233/la-pluma)
  [![GitHub Actions](https://github.com/mps233/la-pluma/workflows/Docker%20Build%20and%20Push/badge.svg)](https://github.com/mps233/la-pluma/actions)
</div>

## ✨ 特性

- 🎮 **自动化任务流程** - 启动游戏、理智作战、基建换班、自动公招、信用收支、领取奖励、关闭游戏
- 🎯 **多关卡支持** - 每个关卡独立设置次数，支持活动关卡代号自动替换（HD-X → OR-X）
- 🧠 **智能检测** - 资源本开放日检测、理智耗尽自动停止、游戏状态监控
- ⏰ **定时任务** - 支持多个定时任务，实时显示执行状态和进度
- 📱 **Telegram 通知** - 任务完成后发送通知，包含截图和详细总结
- 🎨 **现代化 UI** - Tailwind CSS + Framer Motion，支持深色模式
- 📲 **PWA 支持** - 可安装为独立应用，支持离线使用
- 🔄 **实时更新** - WebSocket 实时推送任务状态和日志

## 📋 前置要求

- **操作系统**: macOS / Linux / Windows
- **Node.js** 18+
- **MAA CLI** 已安装
  - macOS: `brew install MaaAssistantArknights/tap/maa-cli`
  - Linux: 参考 [MAA CLI 文档](https://maa.plus/docs/manual/cli/)
  - Windows: 参考 [MAA CLI 文档](https://maa.plus/docs/manual/cli/)
- 已执行 `maa install` 安装 MaaCore 及资源

## 🖥️ 跨平台支持

La Pluma 支持 macOS、Linux 和 Windows 系统。项目会自动检测操作系统并使用对应的配置路径：

### 配置文件路径

- **macOS**: `~/Library/Application Support/com.loong.maa/`
- **Linux**: `~/.config/maa/` (遵循 XDG 标准)
- **Windows**: `%APPDATA%\maa\`

服务器启动时会自动显示当前系统的路径配置。

## 🚀 快速开始

### 方式 1: 本地安装（推荐）

#### 1. 克隆仓库

```bash
git clone https://github.com/mps233/la-pluma.git
cd la-pluma
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
docker pull mps233/la-pluma:latest

# 运行容器
docker run -d \
  --name la-pluma \
  -p 3055:3000 \
  -v /path/to/data:/app/server/data \
  -v /path/to/config:/root/.config/maa \
  -v /path/to/maacore:/root/.local/share/maa \
  -e ADB_ADDRESS=192.168.x.x:5555 \
  mps233/la-pluma:latest

# 访问应用
# 浏览器打开 http://localhost:3055
```

#### 使用 Docker Compose（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/mps233/la-pluma.git
cd la-pluma

# 2. 编辑 docker-compose.yml，修改 volumes 和环境变量

# 3. 启动服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f
```

#### 本地构建镜像

```bash
# 构建镜像
docker-compose build

# 启动容器
docker-compose up -d
```

**配置说明**：
- 宿主机端口：`3055`，容器内端口：`3000`
- 数据持久化：`./docker-data/` 和 `./server/data/`
- ADB 连接：在 WebUI 中配置设备地址（如 `127.0.0.1:5555`）
- 首次启动会自动下载 MaaCore（约 5-10 分钟）

**支持架构**：
- `linux/amd64` - x86_64 服务器、PC
- `linux/arm64` - ARM64 服务器、Apple Silicon

## 📦 项目结构

```
la-pluma/
├── client/                    # 前端 (React + Vite + Tailwind CSS)
│   ├── src/
│   │   ├── components/        # UI 组件
│   │   │   ├── AutomationTasks.jsx    # 自动化任务
│   │   │   ├── CombatTasks.jsx        # 战斗任务
│   │   │   ├── RoguelikeTasks.jsx     # 肉鸽模式
│   │   │   ├── LogViewer.jsx          # 日志查看
│   │   │   ├── ConfigManager.jsx      # 配置管理
│   │   │   ├── NotificationSettings.jsx # 通知设置
│   │   │   ├── Layout.jsx             # 布局组件
│   │   │   ├── ThemeToggle.jsx        # 主题切换
│   │   │   └── ...
│   │   ├── services/          # API 调用
│   │   │   └── api.js         # API 封装
│   │   └── utils/             # 工具函数
│   └── public/                # 静态资源（Logo、图标）
├── server/                    # 后端 (Node.js + Express)
│   ├── routes/                # API 路由
│   │   ├── maa.js            # MAA CLI 接口
│   │   └── notification.js   # 通知接口
│   ├── services/              # 业务逻辑
│   │   ├── maaService.js     # MAA CLI 集成
│   │   ├── schedulerService.js # 定时任务调度
│   │   ├── notificationService.js # 通知服务
│   │   └── configStorageService.js # 配置存储
│   ├── data/                  # 用户配置数据
│   │   └── user-configs/      # 任务配置 JSON 文件
│   └── server.js              # 服务器入口
├── package.json               # 根目录脚本
└── README.md                  # 项目文档
```

## 🎯 核心功能

### 自动化任务流程

- ✅ **启动游戏** - 自动启动明日方舟客户端
- ✅ **理智作战** - 支持多关卡，每个关卡独立次数设置
  - 自动替换活动关卡代号（HD-X → OR-X）
  - 资源本开放日检测（CE-6、AP-5、CA-5、SK-5、LS-6）
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

### Telegram 通知

- 任务完成通知（成功/失败/跳过统计）
- 自动截图并发送
- 详细的任务总结（关卡、次数、掉落、耗时）

## ⚙️ 配置说明

### ADB 连接配置

在"自动化任务"页面配置 ADB 连接：

- **ADB 路径**：默认 `/opt/homebrew/bin/adb`
- **设备地址**：
  - 本地模拟器：`emulator-5554` 或 `127.0.0.1:5555`
  - 远程设备：`192.168.x.x:16384`（需要开启网络 ADB）

### Telegram 通知配置

在"通知设置"页面配置：

1. 创建 Telegram Bot（通过 @BotFather）
2. 获取 Bot Token
3. 获取 Chat ID（通过 @userinfobot）
4. 填入配置并测试

## 🛠️ 技术栈

- **前端框架**: React 18 + Vite
- **UI 框架**: Tailwind CSS + Framer Motion
- **后端**: Node.js + Express
- **实时通信**: Socket.io
- **MAA 集成**: 通过子进程调用 maa CLI 命令
- **通知服务**: Telegram Bot API

## 📝 开发指南

项目使用标准的 React + Node.js 技术栈，代码结构清晰，易于扩展。

### 主要技术点

- **前端**: React Hooks + Tailwind CSS 实现响应式 UI
- **后端**: Express + Socket.io 实现实时通信
- **MAA 集成**: 通过 Node.js 子进程调用 maa CLI 命令
- **定时任务**: 使用 node-cron 实现任务调度
- **通知服务**: Telegram Bot API + 截图功能

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [MAA (MaaAssistantArknights)](https://github.com/MaaAssistantArknights/MaaAssistantArknights) - 明日方舟游戏助手
- [maa-cli](https://github.com/MaaAssistantArknights/maa-cli) - MAA 命令行工具
