# 前端执行客户端与控制器

> [← 返回文档索引](../README.md)

本文说明 `apps/web/src/features/task-execution/` 的执行客户端、Run 类型接线和应用级执行控制器。服务端的执行身份、状态机与停止矩阵见[执行身份与生命周期契约](execution-lifecycle.md)；本文只讲前端如何消费这些契约，以及各页面的消费边界。

## 1. 定位与边界

`task-execution` 是跨页面微域：命令提交、Run 查询、目标停止与观察循环都归它，页面不再各自维护运行身份。控制器是模块级单例，由 `app/App.tsx` 启动，因此页面隐藏、Activity 清理或订阅组件卸载都不会停止观察。

| 能力 | 归属 | 不负责 |
| --- | --- | --- |
| 提交执行并传 `Idempotency-Key` | `features/task-execution/api/index.ts` 的命令函数 + `ExecutionController` | 页面表单校验、业务参数拼接 |
| 读取 `runs/current` / 按 `runId` 查询 | `features/task-execution/api/runs.ts` | 判断“设备是否空闲”以外的业务含义 |
| 保存调用方自己的 `runId` | `ExecutionController` | 持久化 Run 记录（服务端） |
| 停止指定 run | `features/task-execution/api/runs.ts#stopRun` + `stopTrackedRun` | 旧页面按 `tasks/status` 的停止确认 |
| 连接健康 | `runtime-status` 的 `useBackendStatusMonitor` | 不从探针推断运行状态 |
| 全局运行展示 | `runtime-status` 消费控制器的 `summarizeRunStatus` 投影 | 不复制 Run 记录，不由页面写运行字段 |

控制器不反向依赖 `runtime-status`，也不新增可写业务真相：所有观察都来自服务端 Run 快照，控制器只保存调用方身份与最近一次快照。`runtime-status` 只单向依赖控制器，把唯一快照投影成阶段、身份与一行标签。

## 2. 公开面

### API

| 导出 | 行为 |
| --- | --- |
| `getRunSnapshot(signal?)` | `GET /api/agent/runs/current`，返回 `RunSnapshot` |
| `getRun(runId, signal?)` | `GET /api/agent/runs/{runId}`，终态保留期内可读 |
| `stopRun(runId, options?)` | `POST /api/agent/actions/stop?runId=…`，只停止目标 run；`options.mode` 取 `now`（缺省）或 `after-combat`，只有显式传 `mode` 时才发送 JSON body |
| `executeCommand(..., options?)` | 通用 `run-task`，`options.idempotencyKey` 写入 `Idempotency-Key` |
| `executePredefinedTask` / `executePredefinedTaskArgs` | 旧参数形式保持不变，末位新增可选 `AgentRequestOptions` |
| `getTaskStatus` / `stopTask` | 旧进程投影与旧式停止；`getTaskStatus` 仍由连接监测器使用，`stopTask` 仅保留给旧调用方，页面不再调用 |

### 类型

`RunState`、`AgentRun`、`RunSnapshot`、`RunOccupancy`、`RunLease`、`StopRunResult` 与 OpenAPI 的 Run schema 对齐；`StopMode` / `RunStopIntent` 描述停止意图：`StopRunResult.pendingStop` 表示等待战斗结束的停止已被受理，活动 run 的 `progress.stopIntent` 是同一意图的进度投影。`isActiveRunState` / `isTerminalRunState` / `findRunById` 提供不依赖页面状态的判断。类型只描述服务端事实，不包含前端推导出的完成语义。

### 控制器

```ts
import { executionController, useExecutionSnapshot } from '@/features/task-execution'

const intent = executionController.beginExecutionIntent('run_task')
const result = await executionController.submitExecution('run_task', ({ idempotencyKey, signal }) =>
  executePredefinedTask('copilot', params, null, signal, name, 'combat', true, { idempotencyKey }),
)
```

| 方法 | 语义 |
| --- | --- |
| `start()` | 引用计数启动；返回的释放函数只停止本地观察 |
| `refresh(reason?)` | 读取快照；`reconnect`/`resume` 先按已知 `runId` 查询 |
| `beginExecutionIntent(operationId, { idempotencyKey?, scope? })` | 生成一次逻辑提交的键与领域标签；重试必须复用同一 intent |
| `settleExecutionIntent(intent, response, error?)` | 收敛提交结果，只允许最新 intent 更新身份，并保存 `scope` |
| `submitExecution(operationId, request, options?)` | 生成键、执行请求、收敛响应；`options.scope` 标记调用方领域；本地 signal 中止不等于停止 |
| `adoptSubmission(response, operationId, { scope? })` | 为日常流程/作业集等域端点采纳响应中的 `runId` |
| `observeRun(runId \| null, operationId?, scope?)` | 绑定或解除调用方身份，不发送停止；重新绑定已持久化身份时应传回原 `scope` |
| `stopTrackedRun(options?)` | 按当前身份停止，`options.mode` 透传给 `stopRun`；没有身份时返回 `null`，不退化为旧式“停止当前任务” |
| `abortObservation()` / `resumeObservation()` | 中止/恢复本地观察，不改变服务端执行 |
| `useExecutionObservation()` | 应用级启动观察，通常在 `App` 中调用一次 |
| `useExecutionSnapshot()` | 基于 `useSyncExternalStore` 的薄订阅，返回稳定快照 |
| `summarizeRunStatus(state)` | 纯投影：把控制器状态归为 `running`/`waiting`/`occupied`/`unknown`/`idle`，附 `runId`、一行标签与进度说明 |

控制器状态：

| 字段 | 含义 |
| --- | --- |
| `phase` | `idle`/`syncing`/`live`/`disconnected`/`offline`/`suspended`；`disconnected` 与 `offline` 保留上次快照 |
| `identity` | `none`/`tracked`/`unknown`；`unknown` 表示按 id 查不到，不是成功也不是失败 |
| `submission` | `idle`/`pending`/`accepted`/`rejected`/`unknown`；传输失败一律 `unknown` |
| `snapshot` | 最近一次成功的 `RunSnapshot`，失败时不清空 |
| `trackedRunId` / `trackedRun` | 调用方自己的身份与最近观察到的记录 |
| `trackedScope` | 调用方提交时声明的领域标签（如 `roguelike`）；只用于客户端判断 run 归属 |
| `hasActiveRun` | 快照 `activeRuns` 非空，或已跟踪的 run 仍处于活动状态 |
| `occupancy` | 服务端设备占用投影，可直接展示但不能据此推断执行结果 |

轮询间隔：有活动意图或提交在途时 2s，空闲 30s，断线重试 10s。`beginExecutionIntent` 会立即刷新一次快照：同步提交在请求返回前拿不到 `runId`，但服务端可能已经创建 run，全局展示要尽早看到它。观察只走 HTTP 轮询；没有推送通道。

### 全局运行状态投影

`runtime-status/hooks/useRunStatusProjection` 在 `App` 中调用一次，订阅控制器并把 `summarizeRunStatus` 写进 `statusStore.runStatus`。它是唯一的运行状态写入者：

| 投影阶段 | 条件 | 标签 | 设备是否忙 |
| --- | --- | --- | --- |
| `running` | 快照或已跟踪身份里有活动 run（`stopping` 显示“正在停止”） | `正在执行: <当前任务>`、`任务执行中`，存在 `progress.stopIntent` 时为 `等待战斗结束后停止` | 是 |
| `waiting` | 唯一活动 run 是等待下一关的作业集 | `等待继续` | 是 |
| `occupied` | 没有活动 run，但 `occupancy.state=external`（未纳管的更新、Telegram 或旧调用方） | `设备被其他任务占用` | 是 |
| `unknown` | 观察断线（保留最后已知 `isRunning`），或 `occupancy.state=unknown` | `执行状态未知` | 按最后已知值 |
| `idle` | 其余情况 | 无 | 否 |

`statusStore` 只保留阶段、身份、标签和进度说明，不复制 `AgentRun`；相同投影重复写入会被忽略。用户可见的执行结果与临时消息通过 `shared/notifications` 的 `notify` / `notifyProgress` 进入 sonner 通知器，与运行投影和连接健康互不覆盖。连接监测器只在投影进入忙态时把探针间隔调到 2s，并且只写 `backendStatus`/`backendMessage`，不再从 `tasks/status.isRunning` 推断运行状态。

## 3. 身份、幂等与旧响应

1. 每次逻辑提交用 `beginExecutionIntent` 取一个幂等键；同一次重试复用 intent，不能生成第二个键。键格式为 `[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}`，由服务端按 `operationId` 分区。
2. 提交响应通过 `data.runId` 取得身份，`data.run` 可用时立即作为 `trackedRun`；没有 `runId` 的旧同步响应不会被伪造出身份。
3. 身份写入 `localStorage['la-pluma-execution-identity-v1']`，保留到该 run 进入终态为止。终态后清除持久化身份，本次会话仍可展示最后记录。
4. `scope` 是调用方自己的领域标签，随身份一起持久化，只用于判断“这个 run 是不是本页面发起的”。它不是服务端字段，不参与身份、幂等分区或键格式；缺省为 `null`，旧记录可正常读取。一个域不应把其它域 `scope` 的 run 展示成自己的执行。身份同时保存 `operationId`（`trackedOperationId`）：它让同一流程的多个入口可以认领同一次执行——目前只有日常页对 `run_daily_flow` 按它判定归属，概览与其它域仍按 `scope`，`scope` 只记录是哪个入口发起的。
5. `settleExecutionIntent` 只接受最新 intent 的响应。较早的提交即使更晚返回，也不会覆盖新 run；较早的快照请求同理，晚到响应由序列号丢弃。
6. `stopRun` 始终携带 `runId`；终态旧 run 只返回 `alreadyTerminal`，accepted 会被取消而不发设备命令，非当前活动 run 由服务端拒绝。

## 4. 观察、断线与重连

- 启动/重连/恢复观察时，先按已知 `runId` 查询，再读取 `runs/current`；没有身份时只读快照。
- 网络失败、超时、响应无法解析与离线的结果都是 `disconnected`/`offline`，不是失败或完成。已有 `snapshot`、`trackedRun` 和 `hasActiveRun` 原样保留。
- 重连（`online`、窗口 `focus`、`resumeObservation`）只恢复观察，不重新提交；重新观察失败可安全重试。
- 按 id 查询返回 404 时标记 `identity: 'unknown'` 并删除持久化身份，保留最后记录用于展示，不把 404 解释为成功。
- `lastRun` 只用于展示，不是调用方身份；只有 `trackedRun` 或显式 `observeRun` 才能代表本客户端的执行。
- 进程 idle、`tasks/status.isRunning=false`、页面卸载或轮询失败都不能写成完成；只有 Run 终态或快照中的终态记录可以。

## 5. 停止与本地中止

| 操作 | 是否调用服务端 | 是否影响执行 | 用途 |
| --- | --- | --- | --- |
| `stopTrackedRun({ mode: 'now' })` | 是，`POST stop?runId=…`，body `{ mode: 'now' }` | 记录停止意图并停止设备任务 | 用户明确终止，或取消等待战斗结束 |
| `stopTrackedRun({ mode: 'after-combat' })` | 是，`POST stop?runId=…`，body `{ mode: 'after-combat' }` | 战斗结束后停止；无法判定或不在战斗中时退化为立即停止 | 用户选择等待战斗结束 |
| `abortObservation()` | 否 | 只取消本地请求与定时器，保留快照 | 页面/会话暂时不再观察 |
| `start()` 返回的释放函数 | 否 | 引用计数归零后停止本地观察 | 应用卸载或测试清理 |
| 提交请求的 `AbortSignal` | 否 | 只放弃本地 HTTP 响应，服务端可能已接受 | 页面取消等待 |

停止后仍需继续观察，直到 `stopped`/`failed`/`interrupted` 等终态；重复停止是安全的。

`mode=after-combat` 只有在服务端能确认当前战斗时才被受理：响应带 `pendingStop`（`mode`/`requestedAt`/`deadline`/`combat`；`requestedAt`/`deadline` 是 ISO 8601 字符串，`combat` 为 `null` 表示无法判定），活动 run 的 `progress` 同时出现 `stopIntent` 并保持 `running`，直到进入 `stopping` 时消失。响应没有 `pendingStop` 表示已退化为立即停止，调用方不能自行假设仍在等待。等待期间再次以 `mode=now` 停止就是取消等待并立即停止。

## 6. 生命周期与兼容

- `App` 通过 `useExecutionObservation()` 启动一次应用级观察；页面或组件只能通过 `useExecutionSnapshot()` 订阅，不得自行创建控制器或重复启动轮询。`App` 同时调用 `useRunStatusProjection()`：它在 React 树外订阅控制器并写 `statusStore.runStatus`，所以页面切换、Activity 清理和组件卸载都不会让全局运行展示退回空闲。
- Activity 隐藏只清理页面 Effects，不调用 `abortObservation()` 或 `stopTrackedRun()`；控制器不在 React 树内，页面生命周期不改变执行所有权。浏览器文档隐藏同样不停止应用级 Run 观察，也不改变执行终态。
- 肉鸽页已迁移到控制器：`run_task` 以 `waitForCompletion=false` 和 `scope: 'roguelike'` 提交，202 接受后只按 `trackedRun` 渲染停止意图。运行中提供两个等宽按钮：「立即终止」以 `stopTrackedRun({ mode: 'now' })` 立即停止，「等待战斗结束」以 `stopTrackedRun({ mode: 'after-combat' })` 请求战斗结束后停止；空闲态仍是单个「立即执行」。等待态只由 `trackedRun.progress.stopIntent` 或刚受理的 `pendingStop` 派生，期间右侧按钮禁用并提示最多等待 10 分钟，左侧「立即终止」保持可用，用于取消等待或逃生。停止请求成功但 15s 内仍看不到 `stopping`/终态时解锁按钮允许重试；等待态不算停止确认，不能触发该超时。页面卸载或 Activity 隐藏不发送停止，刷新后按持久化身份恢复且不重新提交。页面只消费全局运行投影。
- 作业页已迁移到控制器，`scope: 'combat'`：
  - 单作业走 `run_task`（`waitForCompletion=false`），幂等键由控制器 intent 生成；作业集走 `run_copilot_set`，只有服务端持有的集合 run 一种身份。
  - 三种页面模式映射为两种服务端模式：`顺序执行` 与 `连续执行` 都提交 `mode=continuous`；`手动逐关` 提交 `mode=manual`，首项后 run 转 `waiting`，页面用 `progress.nextEntry` 渲染“开始下一关”，点击调用 `POST /api/agent/actions/continue-copilot-set`（不新建 run、不使用新幂等键）。
  - 逐项状态与失败汇总只来自 `progress.taskResults`（活动）与 `result.summary`（终态），页面不维护第二份逐项结果；停止后未开始项保持 `pending`，页面不会再提交下一关。终态通知的成功比例按 `summary.queuedEntries` 计算，`summary.totalEntries`（含本次跳过）不作分母。
  - “本次执行进度”只补充其它位置没有的事实：`progress.currentStep`/`totalSteps` 给出的本次执行条目位置（`both` 模式下同一作业的普通与突袭各占一项，不能读作关数）、当前关卡与已用时。运行状态与停止入口留在执行卡片，逐项状态与计划状态计数留在作业列表和续跑进度，不重复呈现。
  - 继续下一关返回可重试的 409 `MAA_EXECUTION_BUSY` 时保持等待态并允许重试；`AGENT_COPILOT_SET_SESSION_LOST` 提示重新提交；拒绝与传输失败之后都先重新读取快照，不凭页面状态推断结果。
  - 作业集终态后页面按服务端计划进度重建“待执行”选择（成功项移出、失败项保留）；计划读取失败只影响展示，不据此宣告完成。`失败后停止` 策略在 manual 等待态遇到失败项时结束集合 run，不再提供“开始下一关”。
  - 作业页只消费全局运行投影；页面隐藏/卸载不发送停止，刷新后按持久化身份恢复运行展示且不重提作业集。刷新后需要重新预览对应作业集才能恢复列表与“开始下一关”入口，`waiting` run 本身不会被重新提交。
- 自动化页已迁移到控制器，`scope: 'automation'`，归属按 `trackedOperationId === 'run_daily_flow'` 判定：
  - 手动执行只提交一次 `run_daily_flow`（`POST /api/agent/schedules/manual/execute`，`waitForCompletion=false`），幂等键由控制器 intent 生成；202 接受后页脚只由 `trackedRun` 决定：运行中只渲染「终止」，不再渲染运行按钮。页面不再逐项提交 `run-task`，也不再保留第二套前端流程引擎。
  - 活动进度来自 `run.progress` 的 `currentStep`/`totalSteps`/`currentTask`/`message`；逐项结果只读取快照中 `schedule.runId === trackedRunId` 的 `taskResults`。流程步间延迟期间 run 仍为活动，页面不会提前标完成；终态摘要只来自 `run.result.summary`。空闲且本页没有持有 run 时，“最近执行”可回退展示快照的 `schedule.lastResult`；它只是旧字段的展示投影，不用于判断身份、完成或重提。
  - 停止走 `stopTrackedRun()`，确认期间由快照推进，15s 未确认解锁重试；页面隐藏/卸载不发送停止，刷新后按持久化身份恢复观察且不重新提交。
  - 旧 `maa-task-flow-execution` 断点只关联已有 Run，绝不重提任务；接受期限、匹配与清理规则由[兼容文档](../frontend/compatibility.md#旧自动化断点的接受与恢复)维护。
  - 自动化页不再单独轮询 `schedules/execution`，也不写全局运行字段；它接管本页与概览快捷入口发起的今日流程（两者同为 `run_daily_flow`，进度、逐项状态与停止都可用），不把 cron 或 Telegram 发起的流程显示成自己的执行——那些执行没有本客户端身份。跨页全局展示由运行状态投影统一处理。
- 设置页的组件更新命令同样提交服务端 Run（`update_core`/`update_cli`/`update_resources`）：`model/updateRunPort.ts` 通过 `adoptSubmission` 采纳 `runId` 并等待控制器观察到的终态；“停止更新”只停止该 `runId`，不退化成本地中止或旧式停止当前任务。等待没有前端本地时限，仍活动时保留 `running` 槽位与停止入口；刷新后 `observeTrackedRun` 按持久化身份恢复观察，终态只由服务端 Run 决定。命令所有者不在 React 树内，页面隐藏或 Activity 清理不会取消更新；旧同步响应没有 `runId` 时不伪造身份。
- `features/task-execution` 不导入 `features/runtime-status`；连接健康与执行身份来自不同来源，不能互相替代。
- Dashboard 已迁移到控制器，`scope: 'dashboard'`：
  - 日常入口提交一次 `run_daily_flow`（`POST /api/agent/schedules/dashboard-quick-start/execute`，`waitForCompletion=false`），幂等键由控制器 intent 生成；202 接受后不再等待请求返回，卡片按共享快照显示运行或等待。
  - Dashboard 只展示当前活动，不提供活动作业执行入口。
  - 启动入口的禁用与运行文案只来自共享投影：活动 run（含其它域或 Agent 发起的）和未纳管占用都会禁用启动；断线时显示“执行状态未知”并按最后已知活动 run 保留禁用。Dashboard 只消费全局运行投影，也不再用 `schedules/execution.isRunning` 判断运行。
  - 本页发起的日常流程终态只在“实际观察过活动”后提示一次；其它域或未纳管执行不产生“今日流程完成”提示。页面隐藏/卸载不发送停止，控制器继续观察。日常页按同一 `run_daily_flow` 接管概览发起的今日流程，不改变本页的全局观察与提示规则。
- 数据统计页已迁移到控制器，`scope: 'statistics'`：
  - 仓库/干员识别通过 `beginExecutionIntent('run_task', { scope: 'statistics' })` 生成幂等键，以 `waitForCompletion=true` 提交；命令确认成功后才轮询解析端点等待 MAA 日志可解析。
  - 命令超时或本地取消只结束本地等待，不调用停止；继续时复用同一幂等键确认已有 Run，已接受 Run 只读取终态，绝不产生第二个设备命令。Run 终态等待或解析超时后只继续等待/解析，不再提交 `run-task`。
  - 识别成功由 `features/statistics/model/commandOwner.ts` 发布作用域失效；材料刷新是脚本入口，不产生 Run。命令状态归域内所有者，页面不再内联 `executeCommand`、固定延迟或读 queue 决定提示。详见[统计识别命令与失效联动](../frontend/domains/statistics.md#识别命令)。
- 肉鸽、作业、自动化、Dashboard 与统计识别的运行身份都来自同一控制器；Dashboard 启动的 run 带有 `scope: 'dashboard'`，统计识别带有 `scope: 'statistics'`，其它页面不会把它们显示成自己的执行，但全局运行投影和 Dashboard 会看到同一个活动 run。

## 7. 回归清单

下表路径相对于 `apps/web/src/`。

| 测试 | 固定行为 |
| --- | --- |
| `features/task-execution/api/api.test.ts` | 旧位置参数不带幂等头；新 `AgentRequestOptions` 写入 `Idempotency-Key`；快照/按 id/目标停止的 URL 与请求方式；缺省停止不带 body，`mode` 才写入 JSON body；旧 `tasks/status`、`stopTask` 仍可用 |
| `features/task-execution/controller/executionController.test.tsx` | 快照作为唯一观察源；旧快照不覆盖新快照；旧提交不覆盖新 run；幂等键复用与格式；调用方 `scope` 与 `operationId` 随身份提交/持久化/恢复，未知身份或解除绑定时清除；断线保留活动状态；重连按 `runId` 恢复观察且不重新提交；页面卸载后仍观察；引用计数释放；订阅入口不启动轮询；观察 hook 挂载/卸载；404 标记 unknown；停止与本地中止分离；`mode` 透传后保持 run 的 `running` 与响应中的 `pendingStop` |
| `pages/roguelike/RoguelikeTasks.test.tsx` | 单次幂等提交保留 `run_task`/`taskType`/命令参数；重复点击不并发提交；运行中双按钮与空闲单按钮；两种停止模式与请求 `mode`；等待态来自 `progress.stopIntent`/`pendingStop` 且不触发 15s 超时；等待中点「立即终止」发 `mode=now`；非战斗退化提示；停止确认超时与拒绝后可重试；Activity 隐藏/恢复不遗留锁定按钮；页面卸载不发送停止且继续观察；刷新按身份恢复且不重提交；其它 `scope` 的 run 不显示为本页执行；终态成功/失败消息 |
| `features/combat/model/copilotSetRun.test.ts` | 活动 `progress` 与终态 `summary` 的投影；突袭/普通条目按作业折叠；等待态 `nextEntry`；缺失进度不伪造完成；终态通知文案 |
| `pages/combat/CombatTasks.test.tsx` | 单作业 `run_task` 幂等提交（不等待完成）；作业集三模式映射（cli/app→`continuous`、`manual`）；提交在途重复点击只发一次；等待态“开始下一关”与 409 占用重试；失败汇总与失败数；按 `runId` 停止后不再提交；停止确认超时重试；Activity 隐藏/恢复不停止、不重提；断线保留运行态并在重连后恢复观察；刷新按身份恢复；其它 `scope`/其它作业集的 run 不显示为本页执行；未知身份不冒充完成 |
| `features/statistics/model/commandOwner.test.ts` | 识别命令经 `beginExecutionIntent` 提交并携带 `scope: statistics`；超时/取消后复用同一幂等键确认已有 Run；Run 终态等待与解析超时不重提；材料刷新不产生 Run；成功后发布作用域失效 |
| `pages/statistics/DataStatistics.layout.test.tsx` | 识别运行状态来自命令所有者；运行中不重复提交；超时后“继续解析”不重执行；识别快照写入 Query；按作用域失效 |
| `features/automation/api/index.test.ts` | 旧同步调用不带 `waitForCompletion` 与幂等头；后台调用写入 `waitForCompletion=false`、`Idempotency-Key` 并转发 signal |
| `features/automation/model/automationRun.test.ts` | 活动进度取 `run.progress` 与匹配 runId 的 `schedule`；其它 run 的逐项结果不被借用；不完整结果行被丢弃；终态摘要只来自 `succeeded`/`stopped`；成功/失败/停止/中断通知文案 |
| `features/automation/model/flowCheckpoint.test.ts` | 旧断点 JSON/版本/时效校验；活动与终态 `run_daily_flow` 关联；无身份流程与其它活动 run 的冲突；所有分支删除旧键；删除失败仍只观察不重提 |
| `pages/automation/AutomationTasks.execution.test.tsx` | 单次 `run_daily_flow` 幂等提交；步间延迟期间不提前完成；按 `runId` 停止并等待终态；刷新按身份恢复且不重提；概览入口发起的今日流程被本页接管并可停止；非今日流程的活动 run 不被认领；其它 run 的 `schedule` 投影不被采用；Activity 隐藏/恢复保留终态标记；旧断点有效/终态/失效/过期/冲突分支；失败、跳过与未执行结果 |
| `pages/automation/AutomationTasks.activity.test.tsx` | 流程结束时 Activity 隐藏再恢复，完成标记不丢失、不发送停止、不重新提交 |
| `features/runtime-status/hooks/useRunStatusProjection.test.tsx` | 空闲/运行/等待继续/等待战斗结束后停止（仍算设备忙）/正在停止/外部占用/未知占用/断线保留最后活动 run/终态才回到空闲 |
| `features/runtime-status/hooks/useBackendStatusMonitor.test.tsx` | 探针只写连接健康，不写运行状态；投影进入忙态后探针改按 2s 间隔 |
| `features/runtime-status/store/statusStore.test.ts` | 运行字段只接受投影；相同投影不重复通知；连接健康与运行投影互不影响 |
| `pages/dashboard/Dashboard.test.tsx` | 日常入口单次异步 `run_daily_flow` 幂等提交（`scope: dashboard`）；在途重复点击不产生第二个提交；终态通知只宣告实际观察过的本页 run；其它域启动/停止不冒充本页执行但全局保持一致；外部占用与断线未知禁用启动入口 |

## 8. 当前限制

- 自动化页展示本页发起并持有的 run，以及概览快捷入口发起的同一 `run_daily_flow`。cron、Telegram 或其它操作发起的流程不会变成自动化页的 `trackedRun`；全局展示由运行状态投影提供。日常页之外的域仍只按本域 `scope` 判定归属，跨页同时启动由服务端执行租约拒绝。
- 作业页刷新后不会自动恢复作业集预览：需要用户重新预览对应作业集才能看到列表与“开始下一关”；`waiting` run 本身仍可观察且不会被重提。
- 作业集 `waiting` 在全局投影里按“设备忙、等待继续”处理，Dashboard 会禁用启动入口；是否允许在等待期间启动其它流程仍由服务端租约决定，界面暂不提供跨页继续入口。
- Dashboard 完整业务快照由 `features/dashboard/model/snapshotRefresher.ts` 协调，设备采样归 `device-mirror`；页面只投影。所有权与失败保旧规则见[总览完整快照与设备采样](../frontend/domains/dashboard.md#完整快照与设备采样)。
- 前端 fixture 性能测试不覆盖真实后端 `runs/current` 读取租约文件的 I/O 成本，也不覆盖提交在途额外刷新的服务端成本；这部分需要真实后端采样。
