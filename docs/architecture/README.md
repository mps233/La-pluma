# 架构与技术栈

> [← 返回文档索引](../README.md)

## 整体架构

La Pluma Next 是一个面向《明日方舟》自动化的本地 Web 控制台。前端负责配置、编排和可视化；后端负责调用 `maa` CLI、ADB、ScrcpyOverWebRTC 和本地 JSON 配置。

当前后端入口主要挂载两类 API：

- `/api/agent` - 主控制接口，覆盖 MAA 命令、任务状态、日志、截图、WebRTC、养成、调度、通知和数据接口。
- `/api/operator-quotes` - 干员语音/台词相关接口。

历史拆分路由已清理；新增功能应优先接入 `/api/agent`。设备执行的 Run 身份、状态来源以及停止、断线、刷新和外部占用边界见[执行身份与生命周期契约](execution-lifecycle.md)；前端如何保存 `runId`、传幂等键、观察快照以及区分停止与本地中止见[前端执行客户端与控制器](execution-client.md)。

### 前端 UI 与响应式壳层

前端使用 React 19、Tailwind CSS v4（`@tailwindcss/vite`；`@theme` 圆角映射 + 定向 `@utility` 间距映射，无 JS 配置）和 Framer Motion。`Layout` 与 `shared/components` 通用组件使用原生语义元素实现页面 chrome、导航栏、移动 tabbar 和模态交互；`styles/index.css` 的语义 token、`styles/layout.css` 的布局几何 token 与 `styles/ios-theme.css` 的 chrome 材质分别统一品牌色、信息密度、水平留白与默认主题外观，液态玻璃由后续主题层提供。

URL 导航、路径归一、PWA 历史记录与 Activity 保活的约定统一见[前端架构与所有权](../frontend/README.md)。

桌面与移动导航、主题、安全区、响应式断点等界面规则以根目录 [设计规范](../../DESIGN.md) 为唯一来源；组件 API 见 [通用组件库](../frontend/components.md)。新增页面应复用 `PageShell`、现有 `Layout`、`shared/components` 通用组件和语义 token，不要重复实现导航壳层或页面级安全区计算。

## 技术栈

- **前端框架**: React 19 + TypeScript + Vite
- **UI 框架**: Tailwind CSS v4（`@tailwindcss/vite`，CSS-first 配置）+ Framer Motion + 项目语义组件与 `src/styles/` 全局样式
- **图标**: Lucide React
- **路由**: React Router 7（`BrowserRouter`，URL 即 tab 状态）
- **状态管理**: Zustand（跨页客户端状态）
- **客户端 Query 缓存**: TanStack Query 5（应用级 QueryClient，策略与键规范见 [Query 缓存与键规范](query-cache.md)）
- **后端**: Node.js + Express
- **实时通信**: HTTP 轮询（执行/日志状态）+ WebRTC 同源信令网关（浏览器实时预览）
- **MAA 集成**: 通过子进程调用 `maa` CLI 命令
- **模拟器连接**: ADB + ScrcpyOverWebRTC
- **数据来源**: MAA 识别结果和本地游戏数据 JSON
- **通知服务**: Telegram Bot API 和任务完成通知

## 项目结构

前端生产源码按 `app → pages → features → shared` 组织；依赖方向、公开面、状态所有者与生命周期统一见[前端架构与所有权](../frontend/README.md)，旧入口消费者与支持窗口见[兼容规则](../frontend/compatibility.md)。下方目录树用于定位实现，各领域行为从前端架构链接进入。

```
La-pluma-next/
├── DESIGN.md                  # UI 设计规范（开发者与 Agent 的唯一来源）
├── apps/
│   ├── web/                   # 前端 (React + TypeScript + Vite + Tailwind CSS v4 + Framer Motion)
│   │   ├── src/
│   │   │   ├── main.tsx       # 入口：import './styles' 并挂载 @/app/App
│   │   │   ├── app/           # 应用组装层：router（路由表、URL 归一与保活出口）、layout、providers
│   │   │   ├── pages/         # 页面层：按域组合页面壳与领域工作区
│   │   │   ├── features/      # 功能域（对外只有 index.ts）：dashboard、automation、combat、roguelike、training、
│   │   │   │                  #   statistics、logs、settings 等页面域，以及 task-execution、user-config、game-data、
│   │   │   │                  #   resource-invalidation、runtime-status、device-mirror、operator-quotes 等跨域微域
│   │   │   ├── shared/        # 横向下层：ui、theme（启动主题单一真源）、navigation、stores、api、query、hooks、utils
│   │   │   └── styles/        # 全局样式资产（不参与四层分层）：index.css 语义 token 单源、layout.css 布局几何与 ios-theme.css 材质
│   │   └── public/            # 静态资源（Logo、图标）
│   └── server/                # 后端 (Node.js + Express)
│       ├── src/
│       │   ├── app.ts         # Express 应用装配（中间件与路由挂载）
│       │   ├── server.ts      # 服务器入口（HTTP/HTTPS 传输与启动）
│       │   ├── config/        # 运行时配置：端口、应用路径、HTTPS、连接默认值、信令凭据与 API 版本
│       │   ├── routes/        # API 路由（路径映射与 router 装配）
│       │   ├── controllers/   # 请求解析、校验、DTO 与响应封装的业务适配
│       │   ├── services/      # 业务逻辑：MAA 执行、调度流程、养成、通知、WebRTC 预览与配置存储
│       │   └── utils/         # 横向助手：日志与脱敏、API token 认证、请求上下文等
│       └── data/              # 用户配置数据（user-configs/ 任务配置 JSON）
├── docs/                      # 项目文档（架构、Agent API、功能、配置、部署、开发、组件库、维护）
├── pnpm-workspace.yaml        # pnpm 工作区配置
├── pnpm-lock.yaml             # 统一依赖锁文件
├── package.json               # 根目录脚本（pnpm workspace 入口）
└── README.md                  # 项目入口与快速开始
```

领域类型归各 `features/<domain>/types/`，不集中到 `shared/types/`。

## 后端组装与启动

- `apps/server/src/app.ts` 的 `createLaPlumaApp(options)` 创建独立 Express 应用，接收信令登录、就绪快照和配置存储等注入端口；`/api` router 先认证再解析 JSON，挂载业务路由后由统一 JSON 404 与错误出口收尾，生产静态文件与 SPA fallback 最后挂载并共同排除 API、探针和信令命名空间，探针与信令登录不经过业务 JSON 解析。请求管道与 envelope 细节见[服务端架构与请求契约](../server/README.md)。
- `apps/server/src/server.ts` 的 `createLaPlumaServer(options)` 同步校验传输配置并组装生命周期，返回尚未监听的句柄；`start()` 才恢复 Run 存储、挂载信令网关、监听 HTTP/HTTPS 并初始化后台领域，重复调用复用同一次启动；`startLaPlumaServer(options)` 保留为一步启动入口。
- 直接执行入口先安装 SIGINT/SIGTERM 处理，再调用 `start()`，初始化期间即可关闭准入、取消初始化并进入 draining；初始化退出与资源释放共用关闭截止时间，HTTP 等待在途响应完成、超时才强制断开，启动回滚复用统一释放结果且网关关闭失败仍会排空 HTTP。具体执行收尾语义见[执行身份与生命周期契约](execution-lifecycle.md#56-运行时关闭与后台触发源)。
- HTTP 回归使用应用工厂和本机临时监听器，无需恢复调度、Telegram 或真实设备运行时；初始化、就绪与关闭全流程见[运行时初始化、就绪与关闭](../server/runtime-lifecycle.md)。

## 状态与资源所有权

状态所有者与页面/领域容器的职责统一维护在[前端架构与所有权](../frontend/README.md)。执行、配置、Query 和跨域失效的详细契约分别由该页链接到对应专题。

## 依赖与职责护栏

`app → pages → features → shared` 的单向依赖、feature 公开面、`task-execution` 不反向依赖页面域与页面裸副作用由 `apps/web/scripts/check-guardrails.ts` 自动检查，并作为客户端 `verify` 的第一步运行：

```bash
pnpm --filter la-pluma-next-client guardrails
```

规则、允许方向与已知限制见[依赖与职责护栏](../development/guardrails.md)。ESLint 继续负责编辑器内的深路径与分层即时报错，CLI 额外覆盖相对路径绕过、真实域环与页面职责。

开发流程与常用检查见 [开发文档](../development/README.md)。
