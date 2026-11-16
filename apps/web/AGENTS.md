# Client 开发指南

本指南适用于 `apps/web/`。下列 `src/` 路径相对于本目录；命令均从仓库根目录执行。

## 分层与代码组织

客户端使用 React、TypeScript、Vite、Tailwind CSS v4、TanStack Query 和 Zustand。生产依赖只沿 `app → pages → features → shared` 向下：

| 目录 | 职责与边界 |
| --- | --- |
| `src/app/` | Router、Provider、全局观察、布局与页面出口；不承载领域状态机。 |
| `src/pages/<domain>/` | 组合页面与领域工作区；不直接持有业务端点、传输、QueryClient、存储或轮询。 |
| `src/features/<domain>/` | 领域组件、hooks、模型、API、类型、样式与状态所有者；`index.ts` 是唯一对外入口。 |
| `src/shared/` | 通用 UI、传输、Query 基础设施和纯工具；不感知业务域。`shared/api` 不新增业务端点。 |

- 跨域显式从 `@/features/<domain>` 导入，禁止深路径与跨域相对路径；域内使用相对 import。领域协作须保持无环，`task-execution` 只能依赖自身与 `shared`。
- `src/shared/ui/` 中 shadcn CLI 生成文件随上游原样保留，不适用仓库零注释政策；有意修改必须是明确的语义决策并记录。
- 不把页面逻辑原样搬入 hook 来绕过职责护栏。结构调整后审查实际所有权。
- 新应用代码、脚本和测试使用 TypeScript；组件沿用 PascalCase，hooks 使用 `use` 前缀，测试与实现就近放置。纯类型依赖用 `import type` 或内联 `type`。
- Node 脚本由 Node 24 直接执行，只用可擦除 TypeScript 语法，不用 `enum`、`namespace` 或构造器参数属性。保留工具配置及原样复制的公共脚本已有的 JS 例外。

## 状态、资源与生命周期

- 服务端只读资源由所属域的 Query 定义和 key 持有；使用既有 key 工厂与应用级 QueryClient，不在页面、Zustand 或另一域再建同义可写副本。
- 仓库、持有干员、干员目录及图标版本归 `game-data`；队列、设置与计划归 `training`；掉落、开放关卡及识别编排归 `statistics`。`statistics → training` 可单向使用队列/材料能力。
- 新读取把 Query 的 `signal` 传到实际请求并校验领域载荷；取消保留 `AbortError`，不展示为请求失败。配置草稿、执行命令、日志与 WebRTC 会话不作为普通 Query 资源。
- 写成功后由领域所有者刷新自身缓存，并通过 `resource-invalidation` 发布精确作用域；失败不发布成功失效，端口不携带资源数据。Dashboard 必须取得完整有效快照后原子提交，单路失败保留旧快照。
- 自动化、作业与肉鸽的配置草稿、pending 和串行提交归 `user-config` 协调器；页面不另建保存队列。完整提交全部成功后才确认同步，半失败保留草稿和显式重试入口。
- Run 身份、提交、观察与目标停止归 `task-execution` 控制器；连接健康与运行投影分别消费各自来源。请求返回、断网、进程 idle 或页面清理均不能推断执行完成；重连和刷新只恢复观察，不重新提交。
- URL 是当前 tab 的唯一来源。已访问页面通过 React `Activity` 保活；隐藏保留状态并清理 Effects，不等于真正卸载或文档隐藏。不要替换成导航即卸载上一页的渲染方式。
- 页面隐藏只清理所属订阅、读取和交互副作用，不停止后台任务或应用级执行观察；模块级命令继续由原所有者裁决迟到结果。日志、预览、Query 各按自己的恢复契约处理。
- 删除旧 API、持久化格式或兼容适配前核实消费者和支持窗口；没有明确移除日期不能作为删除依据。

## UI、样式与 PWA

- 通用控件从 `@/shared/ui` 复用；新增或调整公共组件时同步公开导出和组件 API 文档，不在页面复制已有控件。高度受限的表单、选择器与发现弹窗使用 shared `DialogFrame` / `DialogBody` / `DialogFrameFooter`，不复制标题栏、关闭按钮与滚动体壳层；无高度上限的简单弹窗仍可直接组合生成原语。
- 页面根统一使用 `PageShell`；壳层、样式与测试通过 `data-region` / `data-page-*` 定位，不恢复 legacy 页面类或属性。页面不自建标题或页头。
- 避免不必要的辅助标签与说明。让布局本身发挥解释作用。
- 全局语义 token 与层序归 `src/styles/`；`index.css`、`layout.css`、`ios-theme.css` 不接收页面选择器。领域样式置于 `features/<domain>/styles/`，由域入口导入并收进 `@layer page`。
- 保持 `theme, base, components, page, utilities` 层序，使用现有语义 token 和 Tailwind v4 canonical 类名；动态状态使用完整类名映射，不拼接 Tailwind 类名。
- 层序 token 只从 `--layout-z-*` 取；不在组件中新增裸 z-index 层（局部 0/1/2 等仍可）。
- Dialog、Sheet、筛选菜单和 PWA 提示等 portal 位于 `document.body`，不受应用根作用域包裹；样式改动同时核对弹层、深浅主题和响应式断点。
- 视口高度契约：应用壳与启动壳只通过 `--layout-viewport-height` / `--boot-viewport-height` 的 dvh → lvh → vh 分支取高；需要限制高度的 Dialog 与移动 Sheet 复用 `--layout-dialog-max-height` / `--layout-sheet-max-height`；页内固定高度块用 `svh`。生产代码不新增裸视口高度；静态 allowlist 按文件登记，除 `ios-theme.css` more-sheet 与 `ScrcpyDeviceView` 沉浸层两个局部例外外，还包含 token owner 与既有 fallback（`index.html`、`layout.css`、`index.css`、`automation.css`、`logs.css`）以及 shadcn 生成文件（`sidebar.tsx`）；新增使用裸视口单位的文件必须登记。
- 视口断点只使用 DESIGN 批准集合（`sm`/`md`/`workbench`/`lg`/`flow-card`/`xl`/`wide`），成对边界写 `width < Npx` / `width >= Npx`；JS 媒体查询由 `@/shared/lib/breakpoints` 的 `BREAKPOINTS` 生成，不新增 arbitrary `min-[...]`/`max-[...]` 断点。
- 修改分包或 PWA 配置时确保所有 JS chunk 进入预缓存；新增 chunk 同步 `createWorkboxConfig` 的匹配规则。保留 API、health、信令路由的导航回退排除，以及启动主题和静态启动壳行为。

## 按改动选择验证

| 影响范围 | 验证要求 |
| --- | --- |
| 纯逻辑、领域状态与请求 | 就近补 `*.test.ts` / `*.test.tsx`；组件和 hooks 按现有测试使用 jsdom、React `act` 和必要的假定时器。 |
| 竞态、保存、取消、保活或恢复 | 覆盖迟到结果、失败保旧、隐藏/恢复及真正 remount；涉及跨页协作时运行 `pnpm --filter la-pluma-next-client test:integration`。 |
| CSS、组件外观、布局或弹层 | 运行 `pnpm --filter la-pluma-next-client stylelint:ratchet` 和 `pnpm visual`；有意改变视觉后用 `pnpm visual:update` 更新并审阅截图差异。 |
| 分包、Service Worker、启动壳、base path | 运行客户端构建并检查相应回归；构建已包含预缓存完整性校验，启动壳或首帧变化还需视觉检查。 |
| 性能优化 | 使用既有性能采样协议；比较双方保持构建、数据、设备和完成语义一致，不把 DOM mutation 或 CDP 指标当作 React render/commit 次数。 |

- 改动后的快速回路用 `pnpm verify:fast`（guardrails、ESLint、类型检查与相对 `origin/main` 的改动测试，包含已提交改动）；提交前仍运行 `pnpm verify` 覆盖样式预算与构建。Vitest 默认最多 4 个 worker，可用 `LA_PLUMA_TEST_WORKERS` 覆盖。
- 浏览器用例使用 `*.pw.ts`，与 Vitest 单元测试分开。
- 测试断言可访问性、可见状态、回调/请求参数、store 与导航结果；不要锁 CSS 类名、包裹层或子元素顺序。`html.dark` 是主题契约例外，视觉效果交给浏览器像素基线。
- 视觉与集成测试使用匹配已安装 Playwright 版本的 Docker 镜像；截图不可跨环境复用。更新样式基线必须有实际清理或结构调整依据，不用重录掩盖非预期回归。
- 功能 PR 只更新实际受影响的视觉基线，使用 spec 或 `--grep` 过滤更新范围；公共主题、字体、全局布局改动及全量视觉基线刷新单独安排 PR。
- 相同 PNG 基线发生合并冲突时，在合并后的源码上重新生成并审核差异，不用 `--ours` / `--theirs` 整张选取一侧。

## 延伸阅读

按任务读取所需契约，不必一次读完。

| 入口 | 用途与阅读时机 |
| --- | --- |
| [前端架构与所有权](../../docs/frontend/README.md) | 新增领域、路由或调整状态归属时；也作为各领域详细契约的导航。 |
| [依赖与职责护栏](../../docs/development/guardrails.md) | import 或页面职责检查失败，以及调整分层边界与页面职责时。 |
| [开发指南](../../docs/development/README.md) | 查询测试治理（含已知缺陷的 `it.fails` 约定）、样式治理与文件类型规则时。 |
| [共享资源归属与失效端口](../../docs/architecture/resource-ownership.md) | 新增共享资源、写后刷新或跨页一致性修改前，核对发布与接收范围。 |
| [Query 缓存与键规范](../../docs/architecture/query-cache.md) | 新增或调整资源 key、缓存策略、Provider 与重试时。 |
| [资源请求错误与取消契约](../../docs/architecture/resource-requests.md) | 修改只读端点、载荷校验、signal 或错误展示时。 |
| [执行客户端与控制器](../../docs/architecture/execution-client.md) | 修改执行提交、观察、停止、身份恢复或全局运行展示前。 |
| [配置持久化协调器](../../docs/architecture/config-persistence.md) | 修改配置适配器、完整提交、pending 或跨域写入屏障前。 |
| [兼容入口与移除规则](../../docs/frontend/compatibility.md) | 删除旧接口、存储键或恢复逻辑前。 |
| [设计规范](../../DESIGN.md) | 修改视觉、交互、token、主题与样式层序前；此处是设计规则的单一来源。 |
| [通用组件库](../../docs/frontend/components.md) | 选用或调整公共控件、更新组件 API 时。 |
| [跨页一致性集成测试](../../docs/development/integration.md) | 运行浏览器集成测试前，确认 Docker 前置条件与场景覆盖边界。 |
| [性能采样说明](tests/performance/README.md) | 性能优化或报告性能结论前，确认采样协议和指标限制。 |
