# 开发文档

> [← 返回文档索引](../README.md)

项目使用 React + TypeScript + Node.js 技术栈，代码结构围绕“前端页面、Agent API、后端服务”展开。

## 主要技术点

- **前端**: React Hooks 与原生语义组件实现页面壳层和响应式 chrome，Tailwind CSS v4（`@tailwindcss/vite`）/语义 token 负责业务布局，Framer Motion 负责物理动效，Zustand 管理跨页面状态
- **API**: 前端通过 `apps/web/src/shared/api/` 的传输层底座（`API_BASE_URL`、`fetchWithAuth`、`parseJsonResponse`、`getErrorMessage`）访问 `/api/agent/*`；业务端点按语义归各 `features/<domain>/api/`，跨域共用的命令执行与用户配置端点在 `features/task-execution/`、`features/user-config/` 两个微域，应用级 Run 观察与执行控制器也在 `task-execution`（见[前端执行客户端与控制器](../architecture/execution-client.md)）
- **后端**: `apps/server/src/app.ts` 装配并挂载 Agent API，`apps/server/src/server.ts` 负责 HTTP 传输与启动；执行进度与状态由 `/api/agent` 轮询读取，浏览器实时预览经同源 `/webrtc-signaling` 网关；执行身份与生命周期见 [执行身份与生命周期契约](../architecture/execution-lifecycle.md)
- **MAA 集成**: 通过 Node.js 子进程调用 `maa` CLI 命令
- **定时任务**: 使用 node-cron 实现任务调度
- **通知服务**: Telegram Bot API + 任务完成通知

前端 UI 的具体规则见根目录 [设计规范](../../DESIGN.md)，组件 API 见 [通用组件库](../frontend/components.md)。

## 多 worktree 开发

每个 worktree 在自己的仓库根目录安装依赖、运行检查。默认 `pnpm dev` 使用前端 5173 和后端 3000；同时启动另一个 worktree 时，为它指定不同的前后端端口：

```sh
PORT=3100 LA_PLUMA_DEV_PORT=5273 pnpm dev
```

浏览器打开 `http://localhost:5273`，`/api`、`/game-assets` 和 `/webrtc-signaling` 都代理到该实例的 `http://localhost:3100`。前端端口被占用时启动失败，不自动换端口。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | 后端监听端口，也用于推导开发代理目标 |
| `LA_PLUMA_DEV_PORT` | `5173` | Vite 开发服务器端口 |
| `LA_PLUMA_DEV_API_TARGET` | `http://localhost:<PORT>` | 显式指定三路开发代理的后端 HTTP(S) origin，优先于 `PORT` |

这些变量通过启动命令或 shell 的 `export` 传入；只给客户端配置端口不会启动或修改另一个后端。单独运行前端连接已有后端时，例如 `LA_PLUMA_DEV_PORT=5273 LA_PLUMA_DEV_API_TARGET=http://localhost:3100 pnpm dev:client`。开发变量不会注入浏览器代码；子路径仍使用 `VITE_BASE_PATH` 和 `LA_PLUMA_BASE_PATH`，见[部署指南](../guides/deployment.md)。

应用数据默认位于各 worktree 自己的 `apps/server/data/`，不要把该目录软链为共享的可写目录。MAA 配置、资源、ADB 和设备预览仍可能使用同一套外部运行时；普通 PR 验证使用浏览器 fixture，真实设备联调由一个指定实例执行。

## 样式治理

### 全局样式冻结

`apps/web/src/styles/index.css`、`apps/web/src/styles/layout.css` 与 `apps/web/src/styles/ios-theme.css` 已完成分层，不再接受页面级选择器：页面样式由各功能域自持，写在 `features/<domain>/styles/<domain>.css` 并由该域 `index.ts` 导入，统一收进 `@layer page`；新样式按组件目录或功能域目录新增。完整规则见 [设计规范](../../DESIGN.md) 的「层序与 token 单源」「配置即规范」两节。

视口断点集合与方向以 [设计规范](../../DESIGN.md#breakpoints) 的 Breakpoints 表为准：CSS 使用 `width < Npx` / `width >= Npx` 区间语法，JS 媒体查询用 `apps/web/src/shared/lib/breakpoints.ts` 的 `BREAKPOINTS` 生成，不新增未登记阈值。

视口高度契约由 `apps/web/src/styles/viewport-contract.test.ts` 静态审计：壳层与启动壳的 dvh → lvh → vh 分支、弹层高度 token、日志控制台与 more-sheet 的 `vh` 前置兜底、DESIGN 登记的局部例外与裸视口单位 allowlist。平台支持口径与完整契约以[设计规范](../../DESIGN.md#viewport-contract)为准；修改视口单位或弹层高度前，先核对 DESIGN 的视口契约与上述静态测试入口。

### stylelint 预算制（ratchet）

存量违规数冻结在 `apps/web/stylelint-baseline.json`（按文件粒度记录，文件移动/改名时比单一总数更稳）。存量违规一律 warning，不阻塞本地开发；拦净新增靠脚本：

```bash
pnpm --filter la-pluma-next-client stylelint           # 本地查看违规（全部 warning）
pnpm --filter la-pluma-next-client stylelint:ratchet   # 预算校验（CI 同款，超出基线即失败）
pnpm --filter la-pluma-next-client stylelint:baseline  # 违规数下降或有意的迁移/重构后重新生成基线
```

`pnpm verify` 包含样式预算检查。CI 将客户端检查、客户端构建与服务端检查拆成并行任务，`stylelint:ratchet` 归客户端检查；服务端保留编译器版本断言和一次 `typecheck`，完整测试通过 `test:coverage` 运行一次，同时检查行为与覆盖率阈值（见 `.github/workflows/ci.yml`）。

CI 在 PR/main 运行浏览器跨页集成和视觉检查，只等待客户端构建，通过 artifact 复用产物；PR 和发布还验证两种原生架构的容器启动。纯文档变更合入 main 时不再重复触发 CI。发布不重复运行浏览器检查。必选的 `verify` 状态是适用任务的汇总结果，详见[工作流说明](../../.github/workflows/README.md)。

### 视觉基线（8 tab + portal 弹层 + 启动壳 × 深/浅主题 × 3 视口）

视觉基线用于验收布局、材质与交互层级，harness 在 `apps/web/tests/visual/`，基线截图入库于 `apps/web/tests/visual/__screenshots__/`。

- **环境钉死**：截图生成与比对统一跑在 `mcr.microsoft.com/playwright` 官方镜像内（tag 自动取 client 实际安装的 `@playwright/test` 版本，如 `v1.64.1-noble`），字体与浏览器由此与 CI 完全一致。基线截图是 **Linux/Chromium 专属**：更换镜像、Playwright 版本或操作系统后，必须用 `pnpm visual:update` 重新生成并逐项评审 diff，不要试图跨环境复用。
- **确定性**：`/api` 请求全部由 `apps/web/tests/visual/fixtures.ts` 的固定数据应答（不依赖真实后端与 MAA 运行状态）；`page.clock` 固定到 2026-10-24 04:00（UTC+8），日期敏感内容（今日开放关卡、资源更新时间等）不随运行当天变化；`reducedMotion: 'reduce'` 加文档级样式禁用 CSS 动画/过渡；主题通过 zustand persist 的 `ui-storage` localStorage 预置，首帧即目标主题。公共部分集中在 `harness.ts`。
- **三个视口**：桌面 1440×900、平板 820×1180、移动 390×844，deviceScaleFactor 1。tab 基线（`app.pw.ts`）整页截图；弹层基线（`overlays.pw.ts`）为视口截图。820 落在 `sm`（640）与 `workbench`（900）之间，与桌面一起把 `workbench` 具名断点两侧夹住，同时也是「无侧栏 + 顶栏标题」这个 390 与 1440 都覆盖不到的组合；1024 / 1200 两档只在桌面侧出现，改动时注意同步核对。断点定义见 [设计规范](../../DESIGN.md#breakpoints)。
- **弹层基线守 portal**：Dialog、AlertDialog、Sheet、DropdownMenu 与 PWA 安装提示都由 Base UI portal 渲染到 `document.body`，位于 `.la-pluma-app` 作用域之外，材质、遮罩与定位只由 portal 处的选择器决定。它们 `position: fixed` 按视口定位，`fullPage` 会把 fixed 元素拉到整页顶部，所以单独取视口或按 `data-region` / `data-slot` 做 locator 截图。
- **启动壳基线守首帧**：启动壳（`boot.pw.ts`）在 `installDeterministicEnvironment` 之后 abort `assets/index-*.js`，让 React 模块不执行、页面停在 `index.html` 的内联启动壳上；按视口截图验收 safe-area / dvh / standalone 的真实渲染。
- **锚点定位**：布局与可访问性断言使用 `data-region` / `data-page-*` 锚点，滚动宿主为 `[data-region="scroll"]`，不依赖实现类名。

```bash
pnpm visual          # 比对模式：与入库基线比对，diff 非零即失败（CI 同款）
pnpm visual:update   # 有意的视觉改动后重新生成基线截图
pnpm visual --grep "dashboard"   # 透传 playwright 过滤参数，只跑部分用例
```

视觉测试的浏览器与静态服务运行在同一 Docker 容器中，使用容器自己的网络，不占用宿主机 4300 端口；不同 worktree 可以同时运行。基线更新只选择实际受影响的用例，例如 `pnpm visual:update --grep dashboard`，更新后审核图片差异。同一 worktree 的构建产物和测试输出仍共用目录，不并发启动多个构建或同类浏览器检查。

### README 界面截图

README 的「界面预览」由 `apps/web/tests/screenshots/` 单独生成，只输出浅色主题；它复用视觉基线的固定 fixture、固定时间与 Playwright 镜像，不读取本机配置。

```bash
pnpm screenshots:readme
```

- 桌面：1440×900，输出 `screenshots/automation-web-light.png`
- 移动：440×956，输出 `screenshots/automation-mobile-light.png`
- 展示用任务流在 `apps/web/tests/screenshots/fixtures.ts` 覆盖；基础接口继续复用 `apps/web/tests/visual/fixtures.ts`
- 截图展示“无最近执行”的空闲状态，不包含示例执行结果
- 桌面截图侧栏身份固定为阿米娅；头像使用 `apps/web/tests/screenshots/assets/amiya.png`，不依赖外部图片网络
- 这是文档资产生成器，不加入 `pnpm visual` / `pnpm verify` 的检查链，也没有 CI 截图门禁；更新后审阅图片差异并随文档提交

### Tailwind v4 与样式分层

当前约定：

- **构建链路**：依赖为 `tailwindcss@^4` + `@tailwindcss/vite`，由 Vite 插件处理样式；`autoprefixer`、`postcss` 与 `apps/web/postcss.config.js` 已退役，不再有 `@config` 指令与 `apps/web/tailwind.config.js`。
- **层序与 token 单源**：语义 token 只在 `index.css` 的 `:root`、`html.dark, #app-root.dark` 与对比度/透明度媒体查询中定义；布局几何与结构 token（`--layout-*`）只由 `layout.css` 定义；`ios-theme.css` 只保留 `--glass-*` 材质 token 与 chrome 视觉。项目语义 token 以 `index.css` 显式定义为准，不依赖 v4 默认色板。层序声明、`page` 层归属与 utilities 优先级详见 [设计规范](../../DESIGN.md) 的「层序与 token 单源」。
- **档位即规范**：圆角由 `index.css` 的 `--radius` 经标准派生档位生效、间距沿用 v4 原生档位与 .5 步进、content 自动检测，以 [设计规范](../../DESIGN.md)「档位即规范」为唯一依据。
- **canonical 类名**：`eslint-plugin-tailwindcss` 的 `enforces-canonical-classname` 在 `apps/web/eslint.config.js` 中对 `src/**/*.{ts,tsx}` 启用（只开这一条），由 `lint` 拦截非规范写法：CSS 变量写 `bg-(--muted)` 而非 `bg-[var(--muted)]`；`break-words` 写 `wrap-break-word`，`[overflow-wrap:anywhere]` 写 `wrap-anywhere`，两者同时出现时保留两个类。
- **v3→v4 类名**：`shadow-sm→shadow-xs`、`backdrop-blur-sm→backdrop-blur-xs`、`outline-none→outline-hidden`、`flex-shrink-0→shrink-0`，`!` 前缀改后缀（如 `dark:text-white!` 仍有效）；**`shadow-md` 及以上档位在 v4 中数值与 v3 相同，不要按 "shadow-lg→shadow-md" 的通用口诀改名**。`ring`、裸 `border`/`divide` 已显式给色。
- **preflight 对齐**：v4 移除了按钮 `cursor: pointer` 与 `:disabled` 的 default cursor，并把 placeholder 改为 currentColor/50%、默认 border-color 改为 currentColor；`index.css` 的 base 层保留了 v3 等价规则（按钮 pointer、disabled default、placeholder gray-400、border gray-200），避免 cursor 这类截图捕获不到的行为回归。
- **浏览器下限**：Tailwind v4 依赖原生 cascade layers、`color-mix()`、OKLCH 与 `@property`，前端最低支持 **Safari 16.4+ / Chrome 111+ / Firefox 128+**。低于该下限的浏览器不再保证样式正确。

## 测试治理

### 断言只看用户能感知的输出

前端测试锁的是**行为**，不是**实现**。允许断言的对象：

- 可访问性契约：`role`、`aria-*`、`disabled`、`tabIndex`、label 的 `htmlFor` 关联
- 用户可见文本与状态：文本内容、加载中/禁用/选中态的实际效果
- 交互结果：回调入参、store 状态、`location.pathname`、请求入参
- 渲染位置：portal 是否落在 `document.body` 且没有被塞回应用根（用 `closest('.la-pluma-app')` 断言）

明确禁止：

- **断言 CSS 类名**（`classList.contains('min-h-11')`、`toHaveClass('surface-soft')`）。Vitest 不做 CSS 处理，样式表根本不参与求值，这类断言只是在核对 JSX 里的字符串字面量：改类名就红，视觉零变化。点按区尺寸、断点显隐、材质层级、层级顺序由 `tests/visual/` 的像素基线守。唯一例外是 `<html>` 上的 `dark` 类——它是 Tailwind `@custom-variant dark` 的契约本体，不是样式细节。
- **断言 DOM 形状**：子元素顺序、包裹层数量、骨架屏占位块数量。这类断言把 JSX 结构写死在测试里，等价重构（换包裹层、拆组件、调列表结构）都会误报。**业务数量**可以断言（8 个导航目的地、3 个 Tab、2 个开关），但要用语义选择器数（`[role="tab"]`、`[data-app-tab]`、`[role="switch"]`），不要数 `.some-class`。
- **枚举式 grep CSS 源文件**（“这几个 `@keyframes` 名字必须存在”）：删掉声明不会报错，但枚举清单会随重构腐烂。选择器是否被应用根作用域包住，只有浏览器能判定，交给弹层基线。唯一保留的是 `apps/web/src/styles/animations.test.ts`：它机械核对「每个 `animation` 引用都能在全部样式表里找到对应 `@keyframes` 声明」，不枚举名字，补的是 stylelint `no-unknown-animations` 只解析单文件的缺口。

### 覆盖分工

| 关注点 | 归属 | 手段 |
| --- | --- | --- |
| 纯逻辑（解析、格式化、store、URL 生成） | 单元测试 | 直接调函数 |
| 竞态、轮询、生命周期、WebRTC 状态机 | jsdom 组件/钩子测试 | 假定时器 + 回调断言 |
| 布局、断点、材质、遮罩层、视觉层级 | 视觉基线 | Playwright 像素比对 |
| 弹层（Dialog、Sheet、DropdownMenu、PWA 提示） | 视觉基线 | 打开状态单独截图 |
| CSS 引用完整性（`@keyframes`） | 单测 | `src/styles/animations.test.ts` |

新增样式约束时先问：这条规则能不能被视觉基线捕获？能就补基线，不能才考虑写测试——且只断言结果（元素实际位置、可见性），不复述选择器。

### 已知缺陷的预期失败标记

表征测试需要记录当前确实不满足目标不变量时，用 `it.fails` 而不是删除断言或写下“当前错误行为正确”的断言：CI 保持绿色，场景仍可执行，修复落地后该用例会转为失败。承接修复的任务必须删除 `.fails` 标记、保留原断言，并把它作为新行为的回归测试。用例名与注释要写明缺失的不变量，不能只写“当前行为”。契约清单见[配置持久化协调器](../architecture/config-persistence.md)。

### 依赖与职责护栏

`apps/web/scripts/check-guardrails.ts` 已作为客户端 `verify` 的第一步，检查功能域依赖环、公开面/深路径、`app → pages → features → shared` 分层方向、`task-execution` 反向依赖与页面文件直接持有传输/存储/轮询原语；不依赖视觉基线。规则明细、允许方向与已知限制见[依赖与职责护栏](guardrails.md)。

## 文件类型

`apps/web/` 下的应用代码、构建脚本与测试一律使用 TypeScript。`tsc -b` 通过两个 project 覆盖：`tsconfig.app.json` 检查 `src`，`tsconfig.node.json` 检查 `vite.config.ts`、`scripts/**`、`tests/visual/**`、`tests/integration/**`、`tests/performance/**`。Node 侧脚本直接以 `node xxx.ts` 运行（Node 24 原生类型擦除，脚本只使用可擦除语法：不用 `enum`、`namespace` 与构造器参数属性）。

只有两个 `.js` 文件是有意保留的：

- `apps/web/public/legacy-page-cache-cleanup.js`：`public/` 由 Vite 原样复制，再经 workbox `importScripts` 注入 Service Worker，不经过构建管线，无法写成 TS。
- `apps/web/eslint.config.js`：ESLint 9 加载 TypeScript 配置需要额外的 `jiti` 依赖，且它依赖的 `globals` 包没有类型声明；工具启动配置留在 JS，不进入应用代码。

## 常用检查

```bash
# 前端类型检查和构建（类型检查覆盖 src、vite.config.ts、scripts 与 tests/{visual,integration,performance}）
# 构建会校验 dist/assets/*.js 全部进入 dist/sw.js 的 precache 清单；
# 新增 chunk 时必须同步 createWorkboxConfig 的 globPatterns，否则构建失败。
pnpm --filter la-pluma-next-client build

# 后端语法检查（node --check 逐个解析 TS，不依赖 TypeScript 编译器）
pnpm --filter la-pluma-next-server check

# 后端类型检查（TypeScript 6.0.3，覆盖全部 TS；源码目录出现 JS 时直接失败）
pnpm --filter la-pluma-next-server typecheck

# 后端类型与依赖护栏（any / 类型抑制 / 双重断言 / 分层方向 / 静态导入环，verify 已包含）
pnpm --filter la-pluma-next-server guardrails

# 后端覆盖率（固定统计范围与渐进阈值，独立于 verify）
pnpm --filter la-pluma-next-server test:coverage

# 依赖/职责护栏（verify 已包含；单独运行便于定位）
pnpm --filter la-pluma-next-client guardrails

# 全仓 guardrails + lint + 样式预算 + 类型 + 测试 + 构建（本地完整检查入口）
pnpm verify

# 前端快速回路：guardrails + lint + 类型检查 + 相对 origin/main 的改动测试（不含样式预算、构建与服务端）
pnpm verify:fast

# 样式预算可单独定位；视觉基线需配合 pnpm verify 运行
pnpm --filter la-pluma-next-client stylelint:ratchet
pnpm visual
```

`lint` 与 `stylelint:ratchet` 复用本地缓存（`.eslintcache`、`.stylelintcache`，已忽略）；客户端 Vitest 默认最多 4 个 worker，服务端测试默认最多 4 个并发进程，分别用 `LA_PLUMA_TEST_WORKERS` 与 `LA_PLUMA_TEST_CONCURRENCY` 调整。并发只降低同时运行的进程数，不改变逐文件进程隔离。

`verify:fast` 的测试以 `origin/main` 为固定基线，分支上的提交仍会被覆盖；只检查未提交改动时直接运行 `pnpm --filter la-pluma-next-client exec vitest run --changed`。基线 ref 不存在时命令会报错，需先 fetch 或显式传入可用 ref。

`eslint-plugin-react-hooks` 固定在 7.0.1：7.1 的 `recommended` 新增了 React Compiler 规则（如 `set-state-in-effect`、`purity`），现有代码仍有 19 处命中。等这些写法单独迁移后再放宽版本范围。
