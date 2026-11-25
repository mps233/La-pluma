# 前端架构与所有权

> [← 返回文档索引](../README.md)

本文说明当前前端的依赖方向、状态所有者和生命周期，供新增功能与后续维护使用。兼容入口及移除条件见[前端兼容入口与移除规则](compatibility.md)。整体系统与技术栈见[架构与技术栈](../architecture/README.md)，界面规则以[设计规范](../../DESIGN.md)为准。

## 分层与公开面

生产源码按 `app → pages → features → shared` 分层。箭头表示允许向下依赖；跨功能域依赖必须经过该域根入口，并保持无环。

| 层 | 职责 | 入口与约束 |
| --- | --- | --- |
| `app/` | 组装 Router、Provider、全局观察、布局和页面出口 | [App.tsx](../../apps/web/src/app/App.tsx)；不承载领域配置或执行状态机 |
| `pages/<domain>/` | 组合 `PageShell`、领域工作区与布局；页面标题由顶栏提供 | [页面路由表](../../apps/web/src/app/router/pages.ts)登记八个页面；生产页面只经 `@/features/<domain>` 根入口消费领域能力 |
| `features/<domain>/` | 自持领域组件、hooks、纯模型、API、类型、样式与状态所有者 | 每个域以 `index.ts` 为唯一对外入口；域内使用相对 import；不依赖 `pages` 或 `app` |
| `shared/` | 通用 UI、协议传输、Query 基础设施、路由词汇、通用 hooks 与纯函数 | 不感知业务域；`shared/api` 不新增业务端点，`shared/query` 不持有领域资源 |

页面域包括 [dashboard](domains/dashboard.md)、[automation](domains/automation.md)、[combat](domains/combat.md)、[roguelike](domains/roguelike.md)、[training](domains/training.md)、[statistics](domains/statistics.md)、[logs](domains/logs.md)、[settings](domains/settings.md)，各领域的面板、模型、命令和回归入口集中维护在对应文档。跨页能力独立为非页面域：`task-execution`、`user-config`、`game-data`、`resource-invalidation`、`runtime-status`、[device-mirror](domains/device-mirror.md)、`operator-quotes`。非页面域仍有明确业务边界，不能成为任意端点的集合。

允许领域之间按公开面单向协作，例如 `statistics → training` 使用队列与材料命令、`runtime-status → task-execution` 消费运行投影；不要求领域之间零 import。`task-execution` 是特殊下层，只能依赖自身与 `shared`。细则和自动检查见[依赖与职责护栏](../development/guardrails.md)及其[实现](../../apps/web/scripts/guardrails.ts)。

## 状态的唯一所有者

| 状态或资源 | 所有者 | 消费方的边界 |
| --- | --- | --- |
| Run 身份、生命周期和终态 | 服务端 Run；前端 [ExecutionController](../../apps/web/src/features/task-execution/controller/executionController.ts)持有提交意图、持久化身份、观察和按身份停止 | 页面订阅控制器；不从请求结束、断网、页面隐藏或旧进程字段推断完成 |
| 后端健康与全局运行展示 | [健康探针](../../apps/web/src/features/runtime-status/hooks/useBackendStatusMonitor.ts)写连接健康；[运行投影](../../apps/web/src/features/runtime-status/hooks/useRunStatusProjection.ts)从控制器写 `statusStore.runStatus` | 健康与运行分开；`tasks/status.isRunning` 不写运行字段 |
| 运行环境诊断 | [诊断会话](../../apps/web/src/features/runtime-status/hooks/useRuntimeDiagnostics.ts)与 `RuntimeDiagnosticsPanel`（`runtime-status` 域） | 保留能力，当前无页面挂载；重新接入时沿用懒加载、单在途、可取消，且不进入 Query、`statusStore` 或持久化 |
| 自动化、作业和肉鸽配置草稿与提交 | [user-config 协调器](../../apps/web/src/features/user-config/model/configCoordinator.ts)按 key 管理通道，域适配器负责 wire 编解码和完整提交 | 页面不建第二份串行队列；自动化配置与 schedule 两步均成功才确认同步 |
| 设置与养成配置、命令 | settings 的 `connectionConfig`、`autoUpdateConfig`、`deviceConnection`、`updateCommands`；training 的 `queueCommands`、`settingsCommands`、`planCommands`、`planValidity` | 模块级所有者裁决迟到结果、pending 与计划前提；表单和面板只编辑、订阅、发送意图 |
| 服务端只读资源 | 所属领域的 Query 定义与 key | 不在页面或 Zustand 再存一份可写资源；配置草稿、Run、日志和 WebRTC 会话不放进 Query |
| Dashboard 完整展示快照 | [snapshotRefresher](../../apps/web/src/features/dashboard/model/snapshotRefresher.ts)、[snapshot](../../apps/web/src/features/dashboard/model/snapshot.ts)与 `dashboardStore` 投影 | 五路业务读取全部成功且载荷有效才原子提交；单路失败保留上一份完整快照 |
| 实时与历史日志 | [realtimeLogStream](../../apps/web/src/features/logs/model/realtimeLogStream.ts)、[historyLogSession](../../apps/web/src/features/logs/model/historyLogSession.ts)及日志命令 | 页面不另建轮询或缓冲；过滤、折叠和导出是独立纯模型与受控展示 |
| 设备预览与采样 | `device-mirror` 的预览会话、transport、截图采样、基础设施操作和设备 Query | 预览暂停或断连不等于停止任务；Dashboard 只投影设备样本与同一状态源 |
| 跨域写后刷新 | [resource-invalidation](../../apps/web/src/features/resource-invalidation/index.ts)端口 | 写成功后发布精确作用域；端口不传资源数据、不持有缓存，消费域决定刷新方式 |
| 面板局部状态 | 最近的面板或工作区 | 搜索词、选中项、展开状态等按实际共享范围上移；不提升为第二份业务真相 |

执行的幂等提交、断线恢复与目标停止详见[执行生命周期](../architecture/execution-lifecycle.md)和[执行客户端](../architecture/execution-client.md)。配置串行写入、revision/token 与完整提交详见[配置持久化协调器](../architecture/config-persistence.md)；设置及计划的专门契约见[设置配置编辑](domains/settings.md#配置编辑与保存)、[养成设置与计划有效期](domains/training.md#设置与计划有效期)。

## 读取、缓存与写后刷新

[QueryProvider](../../apps/web/src/app/providers/QueryProvider.tsx)注入应用级唯一 QueryClient，页面重挂载不重建缓存。默认值、重试分类、各资源 key 与覆盖策略由[Query 缓存与键规范](../architecture/query-cache.md)统一维护。

资源边界为：

- `game-data` 唯一持有仓库、持有干员、干员目录及图标版本；training 与 statistics 共用其公开面。
- `training` 持有队列、候选列表、状态计数、设置、计划与材料命令；`statistics` 持有掉落、开放关卡及识别命令编排。
- `automation` 持有活动与 schedule 执行投影；[Dashboard 查询组合](../../apps/web/src/features/dashboard/model/queries.ts)经领域 Query 并发读取活动、schedule 执行、队列、今日掉落、今日开放关卡。协调读取强制新鲜且不叠加重试，避免把部分新值混入旧快照。
- `settings` 持有连接、版本与配置目录；`device-mirror` 持有预览会话、截图采样、基础设施操作与设备采样。

配置与命令写入不经过只读 Query 生命周期。写成功后，领域命令刷新自己的缓存，并经失效端口通知受影响资源；失败不发布虚假成功。失效 hook 在 Activity 隐藏时注销，恢复后按 revision 补发隐藏期间错过的失效。作用域、发布方和消费方的完整映射见[共享资源归属与失效端口](../architecture/resource-ownership.md)，Query key 和错误约定见[Query 缓存与键规范](../architecture/query-cache.md)。

## URL、保活与副作用生命周期

React Router 7 的 `BrowserRouter` 是当前 tab 与 URL 的唯一事实来源。[AppRoutes](../../apps/web/src/app/router/AppRoutes.tsx)把 `/`、`/app`、`/app/` 与未知 tab 归一到默认页；`Layout` 负责导航外观与按 tab 的滚动恢复。[VisitedWorkspaces](../../apps/web/src/app/router/VisitedWorkspaces.tsx)只创建访问过的页面，通过 React `Activity` 切换可见性，因此不使用会随导航卸载上一页的 `<Routes>`/`useRoutes`。安装后的 PWA（standalone）也使用 URL 历史导航，刷新与深链保留当前页；升级前 `history.state` 中的旧 tab 记录不再读取。

Activity 隐藏保留页面 React 状态并清理 Effects；它与真正卸载、浏览器刷新、`document.hidden` 是不同事件，不能用同一个 cleanup 推断业务结束。

| 所有者 | Activity 隐藏时 | 恢复或刷新时 |
| --- | --- | --- |
| 应用执行观察、运行投影、健康探针 | 位于 AppShell，页面切换不解除它们 | 刷新后以已保存身份与服务端快照恢复观察；不重放命令 |
| 模块级配置和命令所有者 | 已接受草稿、串行提交、更新与计划命令继续由原所有者持有 | 订阅恢复；迟到响应仍须通过 revision 或版本裁决 |
| Query 观察者 | 随 Effect 注销；取消行为由具体 Query 与使用的 signal 决定 | 按缓存新鲜度重取，不由页面另建一轮请求 |
| 日志会话 | 实时流取消在途读取、停止计时并保留缓冲；历史会话取消读取并保留选择 | 立即重读实时；历史重读列表并重试被取消的当前读取；手动暂停不被恢复事件清除 |
| 设备预览 | 应用级 `PreviewSessionProvider` 保持同一连接、截图采样与基础设施操作；页面只解除视频绑定 | 切页复用同一视频流；文档隐藏时，已开始信令/WebRTC 的 live 连接（含正在建立）保留 3 分钟缓冲，期间恢复继续使用同一连接，超时才释放并在恢复可见时重连；仅尚在等待启动接口返回时立即中止，snapshot 立即暂停并在恢复可见时立即重拍；真正卸载立即释放资源，不影响 Run 身份或设备任务 |
| 排序与模态交互 | 清理 document 事件、pointer/rAF、焦点与滚动副作用 | 保留的 UI 状态由所属面板恢复；不能留下后台交互监听 |

更细的当前行为见[执行客户端](../architecture/execution-client.md)、[配置持久化协调器](../architecture/config-persistence.md)、[日志实时流](domains/logs.md#实时流生命周期)、[日志历史与清理](domains/logs.md#历史会话与清理)、[设备画面状态与预览设置](domains/device-mirror.md)、[总览快照与设备采样](domains/dashboard.md#完整快照与设备采样)。默认 Query 策略不意味着所有会话都会随 `document.hidden` 停止；日志、预览及业务刷新各自有明确契约。

## 预览偏好与信令凭据

`PreviewSessionProvider` 位于页面 Activity 边界之外，统一持有实时会话、截图采样与预览基础设施操作。总览、日常、作业、肉鸽、养成、数据和日志页经 `usePreviewSession` 绑定同一 MediaStream；切换到设置页也保留连接，不重复启动服务。日常、作业、肉鸽、养成、数据和日志使用相同的 `DeviceMonitorPanel`，宽屏右侧占工作区三分之一，窄屏改为纵向排列。工具栏“预览设置”打开模态窗承载连接与服务、画质与按需采样的连接详情，不再有常显控制轨或独立的完整控制台布局。显式关闭、后端不可用或应用真正卸载会立即释放当前连接；文档隐藏时，已开始信令/WebRTC 的 live 连接（含正在建立）进入 3 分钟缓冲，仅尚在等待启动接口返回时立即中止，snapshot 立即暂停并在恢复可见时重拍。

[`previewStore`](../../apps/web/src/features/device-mirror/store/previewStore.ts)以 `preview-storage` version 2 持久化 `mode`、`quality`、`fps`、`maxSize`、`bitrateMbps`。`off`、`snapshot`、`live` 的选择本身即偏好：新应用加载时恢复上次合法模式（`off` 也合法），导航切页保留运行时偏好。v1 旧数据仅在旧 `autoStart === true` 时沿用其中的 `mode`（该字段随版本 2 移除），否则升级后首次加载从 `off` 开始，此后选择直接持久化。多标签页之间不做实时同步：每次偏好动作只把本次涉及的字段合并进最新落盘值——`setMode` 只写模式，预设画质写整组数值，自定义画质只写 `quality` 与被修改的数值字段——因此另一标签页的无关改动不会回退字段，各标签页在刷新后收敛到同一份偏好，同一瞬间的双页并发写入仍以最后落盘者为准。预设画质使用预设数值，自定义值须通过字段范围校验。恢复、迁移与坏值回退见[偏好测试](../../apps/web/src/features/device-mirror/store/previewStore.test.ts)。

[`useScrcpyWebRTC`](../../apps/web/src/features/device-mirror/hooks/useScrcpyWebRTC.ts)在收到设备 offer 并设置本地 SDP 后立即发送 answer，后续候选经既有信令逐个发送，不等待 ICE 收集完成；设备 SDP 未声明 trickle 时也沿用 Scrcpy 的候选转发协议。每次登录信令服务前先删除旧 `scrcpy_webrtc_auth_token`，成功后只保存本次返回的有效凭据；失败清理同样删除凭据，不能复用旧 token。信令服务重启、连接失败与 transport 清理的回归见[信令测试](../../apps/web/src/features/device-mirror/hooks/useScrcpyWebRTC.test.tsx)。

## 样式、验证与性能方法

`main.tsx` 只引入启动族 `styles` 并挂载 App。全局层序、语义 token、Tailwind v4 映射与 chrome 材质归 `apps/web/src/styles/`；领域页面 CSS 放在 `features/<domain>/styles/`，由领域根入口引入并归入 `@layer page`。通用组件复用 `shared/components`；新增页面不重复实现导航、安全区或主题。样式边界详见[开发指南](../development/README.md)与[通用组件库](components.md)。

客户端 `verify` 执行依赖与页面职责护栏、lint、样式预算、类型检查、单元测试和构建；视觉与浏览器集成检查覆盖布局、交互和生命周期，静态护栏不证明运行时所有权。测试可深路径构造领域内部状态，但不进入生产依赖图。

性能测试的场景、采样方法与解释限制见[性能采样说明](../../apps/web/tests/performance/README.md)。比较必须保持构建、数据、设备、浏览器及操作语义一致；DOM mutation 和 CDP 指标不能当作 React render 或 commit 次数，日志总耗时包含轮询等待。不能根据结构缩减推断性能提升。
