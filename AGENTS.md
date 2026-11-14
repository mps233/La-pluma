# 仓库开发指南

## 项目快照

La Pluma Next 是面向《明日方舟》自动化的本地 Web 控制台：React + TypeScript 前端负责配置、编排与可视化，Node.js + Express 后端调用 `maa` CLI、ADB 与 ScrcpyOverWebRTC 并维护本地 JSON 数据。执行进度、状态与日志通过 HTTP 轮询读取，业务状态没有推送订阅；实时通道只有设备预览的 WebRTC，信令经同源 `/webrtc-signaling` 网关。仓库没有共享类型包或接口代码生成，前后端各自维护契约两侧。

| 路径 | 职责 |
| --- | --- |
| `apps/web/` | 前端应用、领域逻辑、共享 UI、浏览器测试与 PWA 构建 |
| `apps/server/` | HTTP API、任务执行与调度、设备连接、通知与持久化 |
| `docs/` | 现行架构、领域契约、开发与运维文档 |
| `scripts/` | 根级 Docker 化视觉测试入口 |
| `.github/workflows/` | 质量门禁、浏览器检查与镜像发布 |

## 环境与常用命令

使用 Node.js 24+ 和 pnpm 12+（Node 下限由根 `package.json` 的 `engines.node` 声明；pnpm 版本由 `devEngines.packageManager` 校验，不匹配时直接失败）。依赖只在仓库根目录安装，仓库只保留根 `pnpm-lock.yaml`，不引入子包锁文件；以下命令均在仓库根目录执行。

| 目的 | 命令 |
| --- | --- |
| 安装依赖 | `pnpm install`（复现 CI 时加 `--frozen-lockfile`） |
| 启动前后端 | `pnpm dev`；单独启动 `pnpm dev:client` / `pnpm dev:server` |
| 构建 | `pnpm build`：客户端类型检查、构建与 precache 校验；服务端语法检查 |
| 测试 | `pnpm test`：客户端 Vitest + 服务端 `node:test` |
| 客户端快速回归 | `pnpm verify:fast`：客户端 guardrails、ESLint、类型检查与相对 `origin/main` 的改动测试（包含已提交改动；只验证未提交改动时直接运行 `vitest run --changed`）；不含样式预算、构建与服务端流程，全量回归仍用 `pnpm verify` |
| 主要质量检查 | `pnpm verify`：两个包的 guardrails、类型检查、测试与构建，客户端另含 ESLint 与样式预算 |
| 样式预算 | `pnpm --filter la-pluma-next-client stylelint:ratchet` |
| 视觉基线比对 / 更新 | `pnpm visual` / `pnpm visual:update`（需 Docker） |
| 生产启动 | `pnpm start` |

`pnpm verify` 不覆盖浏览器集成、视觉比对、服务端覆盖率与容器启动检查；前端改动需自行补跑对应命令，CI 会全部执行。

## 开发工作流

1. 从 `main` 切主题分支，先定位既有领域、服务与状态所有者，再决定改动落在哪一层。
2. 实现与回归测试一起提交，按「提交前验证」自检。
3. 提 PR，等 CI 门禁通过后合入 `main`；`main` 受分支保护，必须 `verify` 状态。
4. 版本提升用单独 PR 只改根 `package.json`，合入后对合并提交打 annotated tag。

推送到 `main` 时，仅 `docs/`、`screenshots/`、Markdown 与 `LICENSE` 变更不触发 CI；PR 不受该过滤影响，照样运行完整检查。

## 代码组织与惯例

- 保持现有单向分层：客户端 `app → pages → features → shared`，服务端 `utils`/`config → services → controllers → routes → 入口`。新增代码归入既有层，不为绕过检查新建平行层或第二份数据源。
- 源码全部是 TypeScript ESM：Node 直接运行 `.ts`，只写可擦除语法（不用 `enum`、`namespace`、构造器参数属性），服务端相对导入带 `.ts` 后缀。
- 命名沿用现状：React 组件 PascalCase，hooks 用 `use` 前缀，服务端函数与变量 camelCase。

## 注释规范

默认零注释。除以下四类外不写任何注释：

- 许可证头，且仅当仓库确实需要时。
- 无法从代码推导的「为什么」：隐藏约束、微妙不变量、特定 Bug 的 workaround，并指得出具体 issue。
- 项目已有的公共 API docstring 惯例：跟随存量风格，不新增惯例。
- `apps/web/src/shared/ui/**` 内 shadcn CLI 生成文件：随上游原样保留（含上游注释与 `use client` 指令，本项目无 RSC），不适用零注释政策；任何有意本地修改必须是明确的语义决策并记录。

以下写法一律禁止：

- `TODO`、`FIXME`、`XXX` 等待办占位。
- 空 `pass`、空 catch 块。
- 装饰性分隔注释，如 `// ===== 分隔 =====`。
- 注释掉的代码。
- 复述代码行为的注释（例如在循环上方写「遍历列表」）。
- 不加解释的行内注释；生产代码不因「逻辑不直观」加注释，先用命名、拆分函数、提取常量与测试表达，仍无法表达且属于上述例外才写。
- 通过注释与用户对话，或用注释描述本次改动；改动说明只进 commit message 与 PR 描述。

## 测试规范

- 修 Bug 先写失败测试：先补一个能在当前代码上复现问题的测试并确认它失败，再改实现。
- 不得用 mock 把被测逻辑替换成恒真断言。mock 只允许替换真实边界依赖：子进程、网络、时钟、文件系统、浏览器 API。
- 不得为覆盖率堆砌无意义测试。断言必须验证行为（输入 → 可观察结果），不锁实现细节、内部调用次数或私有字段。
- 更新快照、像素基线或覆盖率阈值必须有对应的真实变化与结构依据，不得用重录或降阈值掩盖回归。

## 修改须知

- 改前后端共有行为时同步核对请求、响应、错误码与持久化格式，两侧各自补测试；契约以现有 envelope 为准，不新增平行字段。
- 向 Agent 公开能力时更新 `apps/server/src/routes/agentContract.ts`，manifest 与 OpenAPI 从同一能力清单生成，不分别维护副本。
- 保持对外标识不变：环境变量 `LA_PLUMA_*`、CSS 类名与 localStorage key `la-pluma-*`、HTTP 头 `x-la-pluma-*`、Agent API 标识 `la-pluma-agent-api`；UI 主题偏好的存储 key 为 `lpn-ui`（`lpn-*` 前缀）。重命名不能顺带改这些约定。
- 子路径部署时构建端 `VITE_BASE_PATH` 与运行端 `LA_PLUMA_BASE_PATH` 保持一致；`/api`、`/health`、`/readiness`、`/game-assets`、`/webrtc-signaling` 仍挂在同源根路径，不随子路径前缀移动。
- 运行数据与凭据不入库：`apps/server/data/`（默认持久数据根目录）、`.env*` 以及仓库外的 MAA 状态目录（日志与调试截图）。打包时保持运行数据与源码隔离。
- 文档改动落到该主题的归属文档，其他位置只留导航，不复制参数表与状态机；移动文档时同步修正索引及源码、脚本中的引用。
- 普通文档、README 与源码不引用 AGENTS.md，也不要求读者先读 AGENTS.md；本指南只维护根与子目录两层，引用方向始终自顶向下。
- 计划、交接、验收与一次性证据留在仓库外的私有工作区。私有任务编号、路径与会话标识不得进入源码/注释、测试/fixture、文档、文件名、分支、commit 或 PR 文案。

## 重要约束与风险

- 真实设备链路依赖 `maa` CLI、MaaCore 及资源、ADB；单元测试与 fixture 浏览器测试不能证明设备侧可用，交付时须写明未验证范围。
- 本地 `pnpm verify` 是 CI 的子集：CI 另跑浏览器集成、视觉比对、服务端覆盖率与双架构容器启动。
- 执行是否完成只由 Run 终态决定，这是前后端共同契约：HTTP 返回、子进程 idle、断网或页面卸载都不构成完成信号。

## 提交前验证

1. 跑定向检查：改动包的测试、类型检查与对应专项脚本。
2. 跑 `pnpm verify`。
3. 改前端样式、布局或构建配置时补 `pnpm visual`；样式预算已包含在 `pnpm verify` 中，改基线须说明依据。
4. 纯文档改动核对命令、路径、链接与完整 diff；CI 不会替你发现文档事实错误。
5. 交付说明写清实际执行过哪些检查、哪些仍未验证。

## Git 规范

- commit message 使用英文并遵循 Conventional Commits，例如 `docs: document repository agent guidance`。
- 每个 commit 只包含当前任务相关的改动，不混入无关重构。
- 同时涉及多种自动化任务类型（Fight、Recruit、Award、Infrast、StartUp）时，按任务类型拆成独立 commit；跨类型的共享契约、配置或基础改动先单独提交，便于按类型回溯与回滚。
- 分支推送后以追加 commit 完成修正，不 amend 或 rebase 已推送的提交。
- 同步 `main` 默认先 `git fetch origin main`，再 `git merge origin/main`，随后普通 push。
- branch 使用 `<type>/<kebab-case-description>`，`<type>` 取 `feat`、`fix`、`docs`、`refactor`、`test`、`ci`、`chore`，与本次主要改动类型一致。
- 不使用 Agent、模型或工具名称作为 branch prefix。示例：`test/agent-server-callback-test`。

## 子目录指南路由

这些指南只承载所在目录的独立规则，按任务读取，不必预先通读。

| 目录 | 该目录 AGENTS.md 覆盖什么 | 什么任务下需要读它 |
| --- | --- | --- |
| `apps/web/` | 前端分层与所有权、状态与生命周期、UI/样式/PWA 规则、按改动选择验证 | 修改 `apps/web/` 的页面、领域、共享组件、样式、构建配置或前端测试 |
| `apps/server/` | 服务端分层与控制器边界、执行与回调、持久化与运行时、类型与依赖护栏、后端测试边界 | 修改 `apps/server/` 的 API、执行与调度、设备连接、存储或后端测试 |

## 延伸阅读

每项只在对应任务需要时读取；详细流程与契约以原文为单一事实来源。

| 入口 | 用途与阅读时机 |
| --- | --- |
| [项目 README](README.md) | 首次安装、启动或准备真实设备联调 |
| [文档索引](docs/README.md) | 按任务定位领域契约、配置、部署与 API 文档 |
| [整体架构](docs/architecture/README.md) | 修改跨前后端边界或确认模块职责、技术栈 |
| [开发指南](docs/development/README.md) | 查询样式治理、测试治理、文件类型与专项检查细节 |
| [维护说明](docs/development/maintaining.md) | 发布流程、兼容性标识、外部运行时依赖与文档归属规则 |
| [部署指南](docs/guides/deployment.md) | 修改 Docker、HTTPS/PWA、反向代理或子路径部署 |
| [CI 与工作流说明](.github/workflows/README.md) | 调整质量门禁或确认某项检查在 CI 中的触发条件 |
