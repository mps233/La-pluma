# 执行身份与生命周期契约

> [← 返回文档索引](../README.md)

本文说明 La Pluma Next 当前的执行身份、唯一状态来源与生命周期边界，以及必须保留的兼容语义。它面向执行链路、Agent 集成和前端控制器的维护者；不涉及页面视觉。

契约的权威实现是服务端 Run 记录（`apps/server/src/services/agentRunService.ts`）、运行快照（`apps/server/src/services/runSnapshotService.ts`）、执行租约（`apps/server/src/services/executionCoordinatorService.ts`）、作业集会话（`apps/server/src/services/copilotSetRunService.ts`）、任务进程投影（`apps/server/src/services/maaProcessService.ts`）、战斗结束后停止的等待意图（`apps/server/src/services/roguelikeStopIntentService.ts`）和流程进度投影（`apps/server/src/services/scheduleFlowExecution.ts`，经 `schedulerService.ts` 的公开入口读取）。文档与代码冲突时，以代码和契约测试为准，并修正本文。

## 1. 执行身份

一次设备执行由服务端 Run 表示，不是 HTTP 请求、页面实例或 MAA 子进程。

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| `runId` | 单次执行的稳定身份 | 服务端生成 UUID；创建后不变 |
| `operationId` | 执行动作类别，如 `run_task`、`run_daily_flow` | 幂等键按它分区 |
| `idempotencyKey` | 调用方提供的逻辑请求键，可空 | 格式 `[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}` |
| `input` / 指纹 | 归一化后的请求输入 | 同键不同输入会被拒绝 |
| `state` | 生命周期状态 | 见第 3 节 |
| `acceptedAt` / `startedAt` / `finishedAt` | 接受、开始、结束时间 | 终态必须有 `finishedAt` |
| `result` / `error` | 终态结果或结构化失败 | `failed`/`interrupted` 必须有 `error` |
| `links.self` / `links.stop` | 按 id 查询与按目标停止入口 | `stop` 为 `/api/agent/actions/stop?runId=…` |
| `recovery` | 重启恢复边界，仅 `interrupted` 存在 | 见 5.5 |
| `progress` | 活动 run 的进度投影 | 读取时计算，不持久化 |

Run 存储是**单实例**语义：不要让多个 Node.js 进程同时读写同一文件。存储位置（默认路径与 `LA_PLUMA_AGENT_RUN_STORE` 覆盖）及终态保留期限由[持久化与运行数据](../server/persistence.md#run-存储与幂等记录)维护；被淘汰后按 `runId` 查询返回 404，同键请求会创建新 run。

同一执行可能同时被多个客户端观察，但同一时刻只应有一个由执行租约保护的设备变更者。Run 记录本身不提供跨实例协调。

## 2. 唯一状态来源

执行相关的“正在运行吗”“完成了吗”“是不是同一个任务”分别由不同对象回答，不能互相替代。

| 观察对象 | 权威来源 | 只回答什么 | 不能据此推断 |
| --- | --- | --- | --- |
| 执行身份与状态 | Run 记录；`GET /api/agent/runs/current`、`GET /api/agent/runs/{runId}` | 本次执行处于 accepted/waiting/running/stopping/终态 | 设备是否空闲、页面是否可见 |
| 活动身份集合与设备占用 | `GET /api/agent/runs/current` 的 `run`、`activeRuns`、`lastRun`、`occupancy` | 当前唯一活动 run、其余 accepted 意图、最近终态，以及设备由 run 还是未纳管执行占用 | 执行结果；`occupancy` 也不能证明租约之外的直接设备使用 |
| 当前 MAA 子进程 | `GET /api/agent/tasks/status`（`maaProcessService` 的 `taskStatus`） | 当前是否有一个受管子进程在跑，及其 `taskName`/`stopRequested` | 整个流程是否完成；流程步间等待时它可以是 idle |
| 流程步骤进度 | `GET /api/agent/schedules/execution`（`scheduleExecutionStatus`） | `isRunning`、`currentStep`、`totalSteps`、`currentTask`、`taskResults`，以及当前流程的 `runId` | 看不到进度就推断未运行；`runId` 为空只表示该次流程没有 Run 身份（如 Telegram 等未纳管调用方） |
| 执行租约 | `apps/server/data/maa-execution.lock`；快照中的 `occupancy.lease` | 哪个协作进程在占用设备变更权（`pid`、`source`、`taskName`、`command`、`startedAt`） | 执行结果；租约释放不代表流程成功 |
| 连接健康 | 前端 runtime-status 健康探针 | 浏览器能否访问后端 | 执行是否活动、成功、失败或已完成 |
| 全局运行展示 | `useRunStatusProjection` 从执行控制器写入 `statusStore.runStatus` | 当前 Run 快照的 UI 投影 | 后台任务所有权或独立终态 |

规则：

1. **Run 是身份与终态的唯一来源。** 进程 idle、流程 `isRunning=false`、页面卸载或轮询失败都不能直接写成“完成”。
2. **进程 idle 不等于流程完成。** 定时/日常流程在步骤之间会释放子进程（等待、截图、仓库解析、汇报），此时 `tasks/status.isRunning=false`，但流程仍在进行；只有 Run 终态或流程结果才能确认完成。日常流程 Run 只有在自己持有 `schedule.runId` 时才投影步骤；`accepted` 尚未获得执行权、或 `schedule.runId` 指向别的流程时，`progress` 显示等待而不是借用他人的步骤。
3. **流程进度是投影。** `schedules/execution` 与 Run 的 `progress` 来自同一流程状态；纳入 Run 的流程在 `scheduleExecutionStatus.runId` 中带上自己的 `runId`，本身仍不是执行身份。未纳入 Run 的调用（当前为 Telegram 等直接调用方）`runId` 为 `null`。
4. **租约只做互斥。** 它防止协作进程同时操作设备，不记录业务结果；锁文件被回收只说明原持有进程已不存活。
5. **页面不维护第二份运行状态机。** 页面可以缓存展示，但停止、完成、重连后的恢复必须以 Run 快照对账。`useRunStatusProjection` 是 `statusStore.runStatus` 的唯一写入者；健康探针只写连接健康，页面只消费投影。客户端规则见[执行客户端](execution-client.md)。

### 2.1 运行快照

`GET /api/agent/runs/current` 返回一个快照，而不是单个 run：

| 字段 | 含义 |
| --- | --- |
| `run` | 当前活动 run；`running`/`stopping` 的设备持有者优先并按开始时间取最新（同级取最新序号），没有持有者时 `accepted` 优先于 `waiting`，同级取最新 |
| `activeRuns` | 全部活动 run，按同一顺序。长度大于 1 表示还有额外 accepted/waiting 意图，调用方不能把它们当作同一个执行。滞留在 `stopping` 的旧 run 不会压过之后开始的新 `running`，全局停止只作用于设备持有者中最新的 run |
| `lastRun` | 按 `finishedAt` 取最近终态；只用于展示，不是调用方自己的身份 |
| `occupancy` | 设备占用投影：`state`、`runId`、`runState`、`sources`、`lease`、`task`、`schedule` |
| `isRunning`/`taskName`/`startTime`/`taskType`/`stopRequested`/`logs` | 旧客户端的任务进程字段，原样保留 |
| `schedule`/`recentLogs` | 旧客户端的流程与日志字段，原样保留。`schedule.runId` 是该次流程的 Run 身份，未纳管调用为 `null` |

`schedule` 是旧字段，现在也作为自检信息：当 `schedule.isRunning` 为真而 `schedule.runId` 为空时，说明设备被一个没有 Run 身份的流程占用，`occupancy.state` 会落在 `external`。

`occupancy.state` 只描述“现在谁在变更设备”：

| 值 | 含义 |
| --- | --- |
| `run` | 当前活动 run 为 `running`/`stopping`，设备归该 run |
| `external` | 检测到任务进程、流程或存活租约，但没有持有执行权的 run（未纳管的直接调用方、自动更新定时任务、Telegram 等） |
| `pending` | 只有不持有执行权的活动意图：`accepted` run，或等待下一关的 `waiting` 作业集 run |
| `idle` | 没有活动 run、任务、流程或存活租约 |
| `unknown` | 租约文件存在但无法解析；不能把它当作空闲 |

`sources` 列出得出该判断的证据组合（`run`、`task`、`schedule`、`lease`）。`lease.state` 为 `free`/`held`/`stale`/`unknown`；`stale` 表示锁文件仍存在但记录的进程已不存活，可以回收，不算占用。`external` 与 `pending` 可以同时有 `runId`（一个待执行的 accepted 或等待中的 waiting 意图）——它们描述的是设备归属，不是 run 身份。`run` 只携带当前 run 的进程/流程投影；作业集 `activeRuns` 条目带有自己的会话进度，即使它不是 `run`。

执行状态没有推送通道；客户端通过 HTTP 轮询观察。浏览器实时预览使用 WebRTC 信令，与任务执行状态无关。


## 3. 生命周期状态

```
accepted ──start──> running ──stop accepted──> stopping ──exit──> stopped
    │                  │                                          └ failed（正常停止路径优先 stopped）
    ├──stop accepted──> stopped（取消，从未执行）
    ├──pre-exec fail──> failed
    └──settle─────────> succeeded
running ──exit──> succeeded / failed / stopped
running ──manual set waits for next entry──> waiting ──next──> running
waiting ──stop──> stopped
任意活动状态 + 服务重启 ──> interrupted（终态，不续跑）
```

| 状态 | 含义 | 设备租约 | 可观察位置 | 状态机允许的下一状态 |
| --- | --- | --- | --- | --- |
| `accepted` | 已落库接受，执行器尚未获得执行权 | 本 run 未持有 | `runs/current.run`；并发时也在 `activeRuns` | `running`、`stopped`（取消）、`succeeded`、`failed` |
| `waiting` | 作业集 manual 模式在两项之间等待用户确认；这是活动状态，不是终态 | 本 run 未持有 | `runs/current.run` 或 `activeRuns`；`progress.phase=waiting_for_next` | `running`（继续下一项）、`stopped`（停止）、`failed` |
| `running` | 执行器已获得执行权（租约后、子进程 spawn 前也短暂处于此状态） | 持有 | run 进度、任务进程或流程进度 | `waiting`（仅 manual 作业集）、`stopping`、`succeeded`、`failed`、`stopped` |
| `stopping` | 停止请求已接受，等待子进程/流程退出 | 持有到退出 | `state=stopping`，任务 `stopRequested` | `stopped`、`failed` |
| `succeeded` | 终态成功 | 已释放 | `result` | 无 |
| `failed` | 终态失败 | 已释放 | `error` | 无 |
| `stopped` | 终态已停止；`result.canceled=true` 表示从未开始的取消 | 已释放 | `result` | 无 |
| `interrupted` | 服务重启或关闭截止时间内未能确认结果 | 未知，可能仍被旧进程占用 | `error.code=AGENT_RUN_INTERRUPTED`；`recovery` | 无 |

约束：

- 终态不可变；重复写入同一终态是幂等的，其他越级转换返回 `AGENT_RUN_STATE_CONFLICT`（409）。
- `accepted` 没有执行权。带 `runId` 的停止会把它直接取消为 `stopped`，`result` 为 `{canceled:true, reason:'stop_requested_before_start'}`，不向设备发送任何命令；取消可以安全重复并保持 200。
- `waiting` 只用于 manual 作业集：它表示集合仍有未执行条目，但当前不持有执行租约。其他客户端可以合法占用设备；此时快照的 `occupancy.state` 为 `external`，等待结束后重新获取租约。等待期间按 `runId` 停止会直接转为 `stopped`，保留逐项结果和未开始项的 `pending`，不发送设备命令。
- 从 `waiting` 继续下一项会重新经过租约与 pre-start 门禁：只有 `waiting` 会转为 `running`；`stopping` 或终态会返回 `AGENT_RUN_STOPPED_BEFORE_START` 并放弃启动。若租约被其他执行占用，继续请求得到可重试的 409（`MAA_EXECUTION_BUSY`），run 保持 `waiting`，不消耗下一项。
- 执行器在获得租约后、产生任何设备副作用前，会通过 `startAgentRunForExecution` 复核身份：只有 `accepted`/`waiting` 会转为 `running`；`stopping` 或终态会返回 `AGENT_RUN_STOPPED_BEFORE_START` 并放弃启动。该错误不对 HTTP 调用方暴露，提交方最终看到自己的 run 为 `stopped`。
- `stopping` 不是终态；调用方必须继续查询，直到 `stopped`、`failed` 或 `interrupted`。重复停止请求返回同一状态。
- `interrupted` 只描述**记录**：服务重启或关闭时无法确认原执行结果，因此不自动续跑。`waiting` 的作业集在重启后同样转为 `interrupted`，因为进程内的集合会话没有持久化。它不证明设备已空闲或原 MAA 进程已退出，重新提交前应重新确认连接与设备状态。`recovery.source` 区分来源：`server_restart`（启动恢复发现残留活动记录）与 `server_shutdown`（关闭流程在截止时间内没有等到结算）。
- `discard` 仅用于执行前的校验/占用拒绝，会删除记录并释放幂等键；它不是公开状态。


### 响应与状态对应

| 场景 | HTTP | 响应要点 |
| --- | --- | --- |
| 同步执行完成 | 200 | `data.runId`、`data.run`、`pollUrl`、`stopUrl`；`run.state` 为终态 |
| 后台接受执行 | 202 | 同上，并带 `Location`；`X-La-Pluma-Run-Id`；调用方应改为轮询 |
| 幂等重放 | 200/202 | `Idempotency-Replayed: true`，返回原 `runId`；活动 run 返回 202，终态成功/停止返回 200，失败/中断返回错误响应 |
| 执行前占用/校验失败 | 400/409 | 错误响应，`error.details.runId`/`run` 可查；run 为 `failed`，幂等键释放，允许用同键重试 |
| 执行中失败 | 4xx/5xx | 错误响应，`error.details.run` 为 `failed`，幂等键保留 |
| 已停止 | 200 | 成功响应，`data.run.state=stopped` |
| 战斗结束后停止（延后受理） | 200 | `stopRequested: true`、`deviceStopRequested: false`、`pendingStop`，`data.run.state=running`；重复请求带 `alreadyPending: true` |
| Run 持久化不可用 | 503 | `AGENT_RUN_PERSISTENCE_FAILED`（可重试）或 `AGENT_RUN_STORE_INVALID`（不可重试） |

`enrichAgentRun` 会为活动 run 追加 `progress`：日常流程只有在自己持有 `schedule.runId` 时读取 `schedule.scheduleId/currentStep/totalSteps/currentTask/shouldStop/message`；尚未获得执行权时显示 `等待执行权`，流程状态尚未发布时显示 `等待流程状态`。作业集 run 读取服务端会话：`setId`、`mode`、`phase`（`starting`/`running`/`waiting_for_next`）、`currentStep`/`totalSteps`、`currentTask`、`nextEntry`、`shouldStop` 与逐项 `taskResults`；`waiting` 阶段显示 `等待开始下一关`，会话在服务重启后不存在时按状态回退为等待提示。Core/CLI/资源更新 run 读取 taskStatus 的受管更新子进程：`currentTask` 为受管任务名，`message` 区分等待执行权、执行中、停止中与收尾阶段；更新 run 没有步骤进度，不能把子进程 idle 读成更新完成。其他执行读任务进程的 `taskName` 与 `stopRequested`。肉鸽/生息演算的延后停止在等待期间额外带 `stopIntent`（`mode`、`requestedAt`、`deadline`、`combat`），`message` 为 `等待战斗结束后终止`；停止真正下发、run 进入 `stopping` 后不再包含 `stopIntent`。肉鸽/生息演算的 `run_task` 在捕获日志检查点后注册进度跟踪器，活动的 `progress` 额外带 `roguelike` 快照（`command`、`theme`、`mode`、`phase`、当前/目标局数、已开始/结束/结算/通关计数、`settlementSupported`、当前动作、最近事件、战斗数、投资、最近 5 局、`blackflow`、`degraded` 与 `observed`）；`blackflow` 只在观察到 `BlackFlow*` 回调时非空，携带楼层、当前节点、行动力、最近路由与节点完成、里程碑与策略结果。`message` 为“集成战略执行中”或“生息演算执行中”，`stopping` 期间仍可读取；终态不追加进度，最终快照并入 `result.summary.progress` 或 `error.details.summary.progress`。

### 幂等与重试

- `Idempotency-Key` 可选；同一 `operationId` + 同键 + 同输入重放原 run，不重复执行；同键不同输入返回 `AGENT_IDEMPOTENCY_KEY_REUSED`（409）。
- 幂等记录随 Run 持久化，正常重启后仍有效；重启时活动 run 变为 `interrupted`，同键重试只会重放该中断结果，**不会重新执行**；要重试必须换新键。
- 执行中失败（`failed`）保留键，因此同键重试会重放失败；只有执行前拒绝（占用、校验、准入落库失败）会释放键。
- 键的保证受终态保留限制（期限由[持久化与运行数据](../server/persistence.md#run-存储与幂等记录)维护）；记录被淘汰后同键请求会创建新 run。
- 未提供键时，每次请求都是新 run；当前 Web UI 经执行控制器生成并复用逻辑提交的幂等键，具体接线见[执行客户端](execution-client.md)。
- 执行准入前落库失败会阻止执行并把 run 置为 `failed`；服务启动时 Run 存储初始化失败则**纳入 Run 的执行接口**整体关闭（503），不会在无身份记录的情况下执行。运行期写入失败时，准入落库会失败并阻止执行，返回可重试的 503。

## 4. 取消语义

停止是**服务端操作**，不是中止本地读取。入口是 `POST /api/agent/actions/stop`；`runId` 可放在请求体或查询参数中（`links.stop` 使用查询参数），请求体优先。请求体还可带 `mode`：`now`（缺省，原有行为）或 `after-combat`；其它值返回 400 `AGENT_VALIDATION_STOP_MODE_INVALID`，不会进入执行编排；显式 `mode: null` 同样非法，只有字段缺失才取 `now`。

`mode=after-combat` 只对满足全部条件的请求延后受理：目标是 `operationId=run_task` 的肉鸽/生息演算 run（`command`、`taskType` 或动态任务类型匹配）、run 为 `running` 且是当前执行，并且从本次 run 开始后的 `asst.log` 判定正处于战斗中。任一条不满足（包括非肉鸽 run、非当前 run、战斗已结束或无法判定）都退化为立即停止，响应与 `mode=now` 相同，不产生 `pendingStop`。

延后受理时：

- 响应 200，`stopRequested: true`、`deviceStopRequested: false`、`pendingStop: { mode, requestedAt, deadline, combat }`；`requestedAt`/`deadline` 为 ISO 8601 字符串，`deadline` 是受理时刻加 600 秒（`ROGUELIKE_STOP_INTENT_MAX_WAIT_MS`）。
- run 保持 `running`，不向设备发送停止命令；`run.progress.stopIntent` 与 `pendingStop` 相同，`message` 为 `等待战斗结束后终止`。
- 已在等待中的重复请求返回同一 `pendingStop` 并带 `alreadyPending: true`，不建立第二个 watcher。
- 战斗判定只采信本次 run 的 `startedAt` 之后的日志行：最后一个标记决定状态，`SubTaskExtraInfo.what=StageInfo` 表示战斗中，只有 `RoguelikeCombatEnd` 清除战斗状态，`StageInfoError` 不改变判定（单独出现且没有更早的 `StageInfo` 时仍为无法判定）；更早的残留回调（例如上一局被强杀的 run）不参与判定。没有相关事件、读取失败或 `startedAt` 缺失都按无法判定处理并立即停止。
- 等待期间只保存内存中的 pending，不落盘；通过 `createMaaLogCheckpoint` 与 `readMaaLogIncrement` 轮询增量，只要 `ok` 或 `truncated` 的增量带回文本并发现 `RoguelikeCombatEnd` 就结束等待（`truncated` 的文本是区间尾部，仍可做肯定发现）；文本为空、不可读、轮转或没有结束标记时继续轮询。到达 600 秒上限后同样按既有停止路径下发。
- 下发停止复用 `stopCurrentTask` 与 `requestAgentRunStop`；run 进入 `stopping` 后 `progress.stopIntent` 消失。
- `mode=now`、不带 `runId` 的旧式停止、run 进入终态、设备子进程退出或服务关闭都会释放等待，不补发停止；`mode=now` 会先取消已有的 pending。
- 战斗状态依赖 MaaCore 把结构化回调写入 `asst.log`。真实设备上这些回调的可见性尚未验证；日志不可读或没有回显时行为会保守地退化为立即停止。当前 `StageInfo`/`RoguelikeCombatEnd` 由肉鸽战斗插件发出，生息演算若没有同类回调，同样会按无法判定退化为立即停止。

不带 `runId` 的旧式停止仍然有效：停止当前受管子进程和当前流程，并在存在活动 run 时记录停止意图。`accepted` 的当前 run 会被取消；`waiting` 的当前作业集会直接转为 `stopped`（`waitingRunStopped`）且不发送设备命令；`running` 的会转入 `stopping`。响应保留 `task`、`scheduleStopped`、`stopRequested`，并新增 `deviceStopRequested` 表示是否真的向设备发出了停止命令。

带 `runId` 的目标停止：

| 目标 run 状态 | HTTP | 结果 | 是否发送设备命令 |
| --- | --- | --- | --- |
| `accepted`（是否为 current 均可） | 200 | 立即取消为 `stopped`，`acceptedRunCanceled: true` | 否 |
| `waiting`（manual 作业集；是否为 current 均可） | 200 | 立即转为 `stopped`，`waitingRunStopped: true`，`result` 含逐项汇总，未开始项保持 `pending` | 否 |
| `running` 且是 current | 200 | 记录 `stopping` | 是，`deviceStopRequested` 反映结果 |
| `running` 且是 current，`mode=after-combat`，肉鸽/生息演算且正在战斗 | 200 | 只记录 `pendingStop`，run 保持 `running`，`progress.stopIntent` 可观察 | 否，战斗结束或到达 600 秒上限后补发 |
| `running` 且是 current，`mode=after-combat`，其它情况 | 200 | 退化为立即停止，记录 `stopping` | 是，`deviceStopRequested` 反映结果 |
| `running` 但不是 current | 409 `AGENT_RUN_NOT_CURRENT` | 拒绝，不改任何 run | 否 |
| `stopping` 且是 current | 200 | 保持 `stopping`，重发设备停止 | 是 |
| `stopping` 但不是 current | 200，`alreadyStopping: true` | 已是停止意图 | 否 |
| 终态 | 200，`alreadyTerminal: true` | 原样返回 | 否 |
| 未知或已淘汰 | 404 `AGENT_RUN_NOT_FOUND` | 无 | 否 |

规则：

- **旧 runId 不会误伤新运行。** 终态旧 run 只返回 `alreadyTerminal`；未开始的旧 run 只会取消它自己；非当前的活动 run 在发出设备命令前被拒绝。
- **停止可安全重试。** `stopping` 与终态的重复请求都返回 200；`stopping` 时会重新尝试设备停止。调用方仍需轮询到终态。`after-combat` 的重复请求返回同一 `pendingStop` 与 `alreadyPending: true`，不会重复建立 watcher。
- **延后停止不是完成。** 等待期间的 `pendingStop`/`progress.stopIntent` 只描述已受理的停止意图；run 仍是 `running`，设备仍在执行。调用方必须继续轮询到终态，不能用 `pendingStop` 判断战斗已结束或任务已停止。
- 停止请求先记录 run 意图，再发送设备命令。若子进程尚未 spawn，执行器在 pre-start gate 看到 `stopping` 会直接放弃启动并转为 `stopped`；若 spawn 已发生但事件尚未处理，`onStarted` 会补发进程/流程停止。
- 停止过程中若子进程/流程正常退出，run 进入 `stopped`；若以错误结束，当前实现按 `stopping` 优先记为 `stopped`。不要在停止请求后把“进程退出”直接当作成功完成。
- 更新 run 与其它执行共用同一停止矩阵：`running` 的更新 run 收到停止后终止受管更新子进程（Core/CLI/资源更新都登记进 `taskStatus`），最终结果为 `stopped`；`accepted` 的更新被直接取消，不启动子进程。停止不会把失败写成成功，也不会自动重试。
- 本地 `AbortController` 中止、页面卸载、浏览器断线都**不等于停止**；服务端会继续执行。页面关闭后任务继续运行是预期行为。

### 4.1 日常流程提交与异步接受

手动、Dashboard、cron 与 Agent 日常流程入口共用 `run_daily_flow` 一个执行动作和同一条 Run 生命周期：

| 入口 | 提交方式 | Run | 同步兼容 |
| --- | --- | --- | --- |
| `POST /api/agent/actions/run-daily-flow` | Agent API；`waitForCompletion` 默认 `true` | 是 | 默认同步返回整个流程结果 |
| `POST /api/agent/schedules/{scheduleId}/execute` | Web UI 手动（`manual`）、Dashboard 快捷（`dashboard-quick-start`）及旧调用方 | 是 | 默认同步；响应保留原 `data` 字段并新增 `runId`/`run`/`pollUrl`/`stopUrl` |
| 定时触发（cron） | `schedulerService.executeScheduledTaskFromCron` | 是 | 无 HTTP 调用方；Run 在流程开始前创建，完成后可从 `/runs/current` 的 `lastRun` 或保留记录查询 |

- `waitForCompletion=false` 时，入口在流程获得执行租约并通过 pre-start gate 后返回 HTTP 202；`data` 同时带 `accepted: true`、`scheduleId`、`totalSteps` 与 `runId`。需要计划内容的 Agent 调用还会返回 `plan`。在此之前发生的占用或校验失败仍同步返回 409/400，run 记为 `failed` 并释放幂等键。
- 流程在步间等待（延迟、截图、解析）时子进程可以是 idle，Run 保持 `running`，`progress.currentStep/totalSteps` 来自 `scheduleExecutionStatus`；这不发布整个流程完成。
- 停止按第 4 节执行：`accepted` 直接取消，`running` 转入 `stopping` 后由流程的 `shouldStop`/中止信号结束；停止后不得启动下一项，最终结果为 `stopped`，`result.summary.taskResults` 保留已完成项。
- 首个请求的幂等键由 `Idempotency-Key` 提供，作用于 `run_daily_flow` 动作；相同 key、相同 `scheduleId` 与 `taskFlow` 重放同一 run。cron 触发没有幂等键，每次触发都是一次新的执行意图；并发触发由执行租约拒绝，被拒绝的触发会留下一个 `failed` 的 `run_daily_flow` 记录。
- 完成通知与智能养成回写不属于执行本身。执行器持有租约期间只准备通知载荷；设备租约释放且 Run 终态落盘之后，才由调度入口触发这些副作用（cron 在结算后执行，HTTP/Telegram 入口不等待它们完成，避免通知超时阻塞响应）。副作用失败只记录日志并保留在完成副作用的错误摘要中，不改变已经结算的 Run 终态。
- 不经过上述 Run 包装、直接调用 `executeScheduleNow` 的入口（当前为 Telegram）不会获得 `runId`；它以 `occupancy.state=external` 出现在快照中，不能当作本契约已覆盖。
- Web UI 入口的提交方式：Dashboard 快捷入口以 `waitForCompletion=false` 提交 `run_daily_flow`，把响应的 `runId` 交给前端控制器观察；响应中的 `runId` 由前端控制器采纳，不再由前端判断“是否在运行”，全局展示只读 `/runs/current` 快照。
- 兼容细节：旧 `/schedules/{scheduleId}/execute` 曾把校验失败也报成 409 `AGENT_SCHEDULE_ALREADY_RUNNING`。现在占用仍保留该旧码，校验失败改为 400 `AGENT_DAILY_FLOW_REJECTED`；这修正了错误分类，未删除同步入口。

### 4.2 作业集提交、模式与等待下一关

作业集由服务端持有集合身份，全部模式共用一个执行动作 `run_copilot_set`；集合内每个条目仍是同一 Run 下的步骤，不再各自成为独立 Run。

| 模式 | 请求 | Run 行为 | 设备租约 |
| --- | --- | --- | --- |
| `continuous`（默认） | `POST /api/agent/copilot-sets/{setId}/execute` | 一个 Run 执行整个待办队列；同步默认返回旧响应，`waitForCompletion=false` 在取得执行权后返回 202 | 集合执行期间持续持有 |
| `manual` | 同端点，`mode=manual` | 首个条目执行后 Run 转 `waiting`；每次 `POST /api/agent/actions/continue-copilot-set` 执行下一项 | 仅在单个条目执行期间持有；等待时释放 |
| `app` / `cli`（旧模式） | 同端点，`mode=app` 或 `mode=cli` | 均映射为 `continuous`；旧的页面内连续与 maa-cli 连续不再有独立服务端语义 | 同 `continuous` |

- 未传 `mode` 的旧调用保持 `continuous`，响应继续包含 `plan`、`results`、`completed`、`pending`，并新增 `runId`、`run`、`state`、`pollUrl`、`stopUrl`、`mode`、`summary`。旧客户端只读原有字段时行为不变。
- 旧 `app` 模式的页面内“失败继续/失败停止”属于页面编排，不再有独立服务端语义；映射到 `continuous` 后沿用旧 `cli` 行为：一个 MAA 命令失败会结束集合，Run 置为 `failed`，未开始的条目保持 `pending`。前端模式与失败策略见[执行客户端](execution-client.md)，不得重新引入页面逐项提交循环。
- `continuous` 的逐项结果在 `summary.taskResults`：`status` 为 `pending`/`running`/`success`/`failed`/`skipped`/`stopped`；`skipped` 是计划中未选中且此前未完成、本次不执行的条目，`skippedCount` 与 `progress.currentStep`/`totalSteps`（按本次执行队列 1 基编号，跳过条目不参与）一并向后兼容新增。
- `summary` 用三个独立字段表达条目总数，彼此不靠差额推导：`plannedEntries` 是计划中的全部执行条目（含历史已完成）；`queuedEntries` 是本次执行队列（计划未完成且被选中）的条目数；`totalEntries` 是本次汇总列出的条目数，恒等于 `taskResults.length`（本次队列 + 本次跳过）。成功比例按 `queuedEntries` 计算，不得用 `totalEntries` 充当分母。
- `summary.delegation` 为可选字段，只在本次执行尝试过原生 `maa copilot` 路径时出现：`outcome` 显式区分 `native-succeeded`/`native-failed`/`native-stopped` 与回退后的 `fallback-succeeded`/`fallback-failed`/`fallback-stopped`；`attempted`（恒为 `true`）、`fallback` 与 `nativeError` 为兼容字段。旧客户端忽略该字段即可；条件、回退判据、缓存失效、灰度开启与回滚方式见[服务端集成](../server/integrations.md)。
- MAA 命令失败时 Run 为 `failed`，响应保留旧错误码 `COPILOT_PLAN_FAILED`（HTTP 422）与 `details.summary`；停止时返回 `stopped`，已完成项为 `success`，未开始项保持 `pending`。组与组之间检查停止意图，停止后不会启动下一组。
- `manual` 在等待阶段返回 HTTP 200，`data.waitingForNext=true` 与 `data.nextEntry`；`run.state=waiting`，`progress.phase=waiting_for_next`。等待不持有租约，`occupancy` 不会把设备算作该 run 所有。
- 继续下一项必须携带 runId。租约被占用时返回可重试的 409 `MAA_EXECUTION_BUSY`，run 保持 `waiting`，已完成条目、选中范围与下一项都不变；停止后继续返回 `alreadyTerminal`，不会启动任何条目。
- `manual` 的条目失败记录在 `summary`（`failedCount`/`errors`/`taskResults`），集合继续等待下一项；全部条目尝试完毕后 Run 为 `succeeded`，是否整体成功由 `failedCount` 判断。集合级错误（计划获取失败、持久化失败）才使 Run 为 `failed`。
- 两种模式都支持 `Idempotency-Key`，作用于 `run_copilot_set`；相同 key 与相同输入重放同一 run。继续下一项不创建新 run，也不使用独立幂等键；同一 run 已在执行时重复继续返回 409 `AGENT_COPILOT_SET_NOT_WAITING`。
- 计划获取失败返回 502 `AGENT_COPILOT_SET_UNAVAILABLE`，属于执行前拒绝：run 为 `failed`，幂等键释放。无效的 `mode`/`selectedIndexes`/`options` 返回 400 `AGENT_VALIDATION_*`，不创建 run；未知的 `raid` 沿用旧行为回退为 `normal`。
- 集合会话保存在服务端进程内。服务重启后活动集合 run 转为 `interrupted`；等待中的集合不会自动续跑，页面必须重新选择并提交。浏览器刷新、页面隐藏或断线只影响观察，不影响集合 run；重新连接后按 `runId` 或 `runs/current` 恢复观察。


### 4.3 显式作业队列 Run

Web UI 的「作业队列」不是作业集：用户队列以显式条目提交，服务端创建 `operationId='run_copilot_queue'` 的 Run，`metadata.taskType='copilot-queue'`。端点、请求字段与错误码见 [Agent API](../api/agent.md#作业队列执行)；本节只定义 Run 语义。

| 模式 | 行为 | 设备租约 |
| --- | --- | --- |
| `continuous`（默认；旧 `app`/`cli` 同义） | 一个 Run 按提交顺序执行全部条目；`failurePolicy=stop` 首项失败后不执行后续项，`continue` 记录失败后继续 | 整个队列执行期间持有 |
| `manual` | 首项执行后 Run 转 `waiting`；每次 continue 执行下一项，skip 把下一个 pending 项标为 `skipped` | 仅单项执行期间持有；等待时释放 |

- 队列条目 1–50 项，`clientId` 在本次请求内唯一；`source=prts` 由服务端按 `copilotId` 取作业内容，`source=file` 只接受受管目录 `copilot-imports/` 内的绝对 `.json` 路径，服务端读取并解析 `stage_name` 后写入队列计划目录，不把用户路径直接交给 MaaCore。
- `auto` 读取作业的 `difficulty`，缺省、`0` 和 `1` 为普通，`2` 为突袭，`3` 为两者。双模式按输入顺序为每个适用作业展开 `normal`、`raid` 两个相邻步骤，预设编队只展开普通，显式 `raid` 的预设编队条目不进入计划。步骤共用来源的 `clientId` 和 `itemIndex`，用 `mode` 区分。计划文件写入 `copilot-plans/queue-<queueId>/`。
- 连续模式按相邻步骤的编队配置分批，将每批作为一个 MaaCore `copilot_list` 执行。手动模式每次执行一步。连续执行失败时，服务端根据本批回调确认已完成步骤和失败位置。选择继续时从已确认的失败位置之后接续。无法确认执行位置时 Run 以执行错误结束，避免重复执行可能已经开战的步骤。
- 队列执行不写 `copilot-progress.json`，历史通关不参与队列；这与作业集按计划进度跳过已完成项不同。
- 运行中 `run.progress`（`enrichAgentRun` 注入）包含：`queueId`、`name`、`mode`、`failurePolicy`、`phase`（`starting`/`running`/`waiting_for_next`/`finished`/`stopped`）、`currentStep`、`totalSteps`、`currentClientId`、`currentTask`、`nextEntry`、`shouldStop`、`message` 与五类计数。`taskResults[]` 按条目给出 `clientId`、`itemIndex`、`stage`、`stageId`、`apCost`、`mode`、`status`（`pending`/`running`/`success`/`failed`/`skipped`/`stopped`）与可选 `error`。
- 终态 `run.result.summary` 包含 `queueId`、`name`、`mode`、`failurePolicy`、`totalEntries`、成功/失败/跳过/停止/待执行计数、`durationMs`、`errors[]` 与 `taskResults[]`。`totalEntries` 统计展开后的执行步骤，最多 100 步，与 `taskResults` 长度及 `progress.totalSteps` 一致。
- `failurePolicy=stop` 在首项失败后不再启动后续项，后续项保持 `pending`；`continue` 记录失败后继续。条目失败不把整个 Run 置为 `failed`：按策略完成执行后 Run 结算为 `succeeded`，失败事实保留在 `failedCount`、`errors` 与 `taskResults`；只有计划构建失败、持久化失败或执行级错误才使 Run 为 `failed`。该终态映射暂保留现状，是否应把“执行完成但存在失败项”改为 `failed` 待产品确认。
- `manual` 首项完成后 Run 为 `waiting`，`progress.phase=waiting_for_next`，`nextEntry` 指向下一个 pending 项，逐项结果与计数来自同一 Run。等待期间不持有设备租约；继续时重新获取租约，被占用返回可重试的 409 `MAA_EXECUTION_BUSY`，保持 waiting 且不消耗条目。等待期间 skip 只把下一个 pending 项标为 `skipped`；没有 pending 时结算为 `succeeded`。
- 停止复用目标 Run 停止：`waiting` 直接转 `stopped` 并保留逐项结果，未开始项保持 `pending`；`accepted` 取消；`running` 转 `stopping`，执行器在当前项结束或下一项前退出并结算为 `stopped`。停止后 continue/skip 返回 `alreadyTerminal` 或 `AGENT_COPILOT_QUEUE_NOT_WAITING`，不得启动任何条目。
- 队列会话保存在服务端进程内。服务重启后活动队列 run 转为 `interrupted`；等待中的队列不自动续跑，continue/skip 返回 `AGENT_COPILOT_QUEUE_SESSION_LOST`（409），页面应重新提交。浏览器刷新、页面隐藏或断线只影响观察，不影响队列 run。
- `Idempotency-Key` 作用于 `run_copilot_queue`：相同 key 与相同输入重放同一 run；continue/skip 不创建新 run，也不使用独立幂等键。队列 Run 与作业集 Run 一样只使用一个身份，不按条目拆分子 Run。


## 5. 边界契约

### 5.1 断线未知

- 任何网络失败、超时、离线或无法解析的响应都表示**未知**，不是失败、完成或停止。UI 不得把已知的 `running` 清成 idle。
- 重连后先按已知 `runId` 查询；没有 `runId` 时查询 `runs/current`：`run` 是当前活动执行，`activeRuns` 暴露其他 accepted 意图，`lastRun` 是最近终态。`lastRun` 不是身份安全的：若同一实例期间启动了别的执行，可能与调用方自己的执行无关。
- 调用方应在提交时保存 `runId`，并保留到看到该 run 的终态为止。无法恢复身份时应标记为未知并要求用户确认，不能自动假定成功或重新提交。
- `404` 表示未知或已过保留期，不是成功；服务重启后的活动 run 变为 `interrupted`，重连查询应展示该终态和 `recovery.deviceState=unknown`，而不是继续等待。
- 没有推送通道；轮询间隔、超时和重连退避由客户端决定，但不得改变上述判定。

### 5.2 外部占用

- 协作占用通过锁文件表达。提交执行时租约不可用会返回 409：通用执行是 `MAA_EXECUTION_BUSY`，日常流程入口包装为 `AGENT_EXECUTION_BUSY`，旧定时执行接口返回 `AGENT_SCHEDULE_ALREADY_RUNNING`。错误 `details.owner` 给出占用者元数据。锁文件先把完整内容写入同目录临时文件，再用 `link()` 原子发布；锁文件从可见的第一刻起就是完整 JSON，不存在空文件窗口。内容为空、无法解析或缺少可核实 PID 的锁按 `unknown` 拒绝获取，不能当作 `stale` 回收。
- 对纳入 Run 的入口，占用属于执行前拒绝：run 为 `failed`，幂等键释放，调用方可用同键安全重试。
- 未纳入 Run 的执行（Telegram 指令、自动更新定时任务及直接调用 `run-task` 的旧调用方）也持有同一租约。此时 `runs/current.run` 为 `null`，`activeRuns` 为空，但 `occupancy.state` 为 `external`，`sources` 包含 `task`、`schedule` 或 `lease`。不能因为 Run 为空就认为设备空闲。定时日常流程、作业集与 Core/CLI/资源更新已纳入 Run；若 `schedule.isRunning` 而 `schedule.runId` 为空，说明占用来自未纳管的直接调用方。等待下一关的 manual 作业集 run 为 `waiting`，同样不持有租约；只有其他执行占用时 `external` 才会出现。
- `occupancy.lease.state=held` 表示租约记录的 PID 仍存活；`stale` 表示锁文件可回收，不算占用；`unknown` 表示锁文件无法解释，必须按“未知”处理而不是空闲。
- 租约只约束协作进程。用户或其他工具直接用 MAA/ADB 操作设备不会被检测，系统不提供对非协作占用的排他保证。
- 锁文件只在持有进程 PID 不存活时回收；PID 存活即视为占用。服务异常退出后，旧 MAA 子进程可能仍在运行，回收租约不代表设备已释放。

### 5.3 manual 等待下一项

服务端已把作业集与显式作业队列的 manual 模式纳入 Run：首个条目执行后 Run 转为 `waiting`，等待用户决定继续。等待态归服务端，页面只负责展示和发起继续/跳过请求。Web UI 的作业页已按该契约迁移：manual 提交一次集合或队列 run，页面展示 `nextEntry` 并在用户点击「开始下一关」/「开始下一项」时调用对应继续端点；页面不再逐项提交 `run-task`，也不再维护等待态。队列的「跳过此项」只把下一个 pending 项标为 `skipped`，不启动设备。

等待态必须满足的不变量：

1. 等待期间不持有设备租约，其他客户端可以合法占用；占用时 `occupancy.state` 为 `external`，而集合 run 仍是 `waiting`。
2. 作业集身份在页面隐藏、刷新后仍可观察：`runs/current` 的 `activeRuns` 包含该 `waiting` run，`progress` 给出 `phase=waiting_for_next`、`nextEntry` 与逐项结果。
3. 用户继续时重新获取租约；若被其他客户端占用，返回可重试的 409 `MAA_EXECUTION_BUSY`，集合保持等待态，不丢失已完成的条目和选中范围，也不消耗下一项。
4. 等待期间停止必须结束集合 run 并阻止下一项；停止直接转为 `stopped`，`result.summary` 保留已完成项，未开始项保持 `pending`；重复停止返回同一终态。
5. 每个条目的结果、失败汇总和“是否还会继续”都归属于集合 `runId`：`summary.taskResults`、`errors`、`waitingForNext`/`nextEntry` 随 Run 返回，而不是页面闭包。
6. 服务重启后等待中的集合 run 转为 `interrupted`；集合会话不持久化，不能自动恢复“下一项”。页面应重新选择并提交。

与日常流程的步间延迟区分：后者由服务端流程在运行期间持有租约，延迟只是流程内部推进，不是“等待用户决定是否继续”；manual 等待则是释放租约、等待外部确认的独立阶段，用 `waiting` 显式表达。

### 5.4 客户端生命周期与旧断点

页面隐藏、卸载、刷新或本地读取中止均不改变服务端执行所有权。客户端只能恢复观察，不能据此停止、宣告完成或重新提交；观察与持久化身份规则见[执行客户端](execution-client.md)。旧 `maa-task-flow-execution` 断点只允许关联已有 Run，格式、24 小时接受期限、冲突和清理规则由[前端兼容入口与移除规则](../frontend/compatibility.md#旧自动化断点的接受与恢复)统一维护。

### 5.5 服务重启与持久化失败

- 启动时恢复 Run 存储：终态保留；所有 `accepted`/`waiting`/`running`/`stopping` 记录改为 `interrupted`，写入 `error.details.reason=server_restart`、`previousState` 和当前 `finishedAt`，不自动续跑。
- `interrupted` 的 run 额外返回 `recovery`：`source`、`previousState`、`executionResumed=false`、`deviceState='unknown'`。可恢复的只有记录身份与终态；执行不会恢复，设备是否仍被旧进程占用无法证明。`/runs/current` 的 `lastRun` 会展示该记录，`occupancy` 不会因为存在终端 run 而把设备标成空闲以外的结论——它按新的任务/流程/租约观测重新判断。
- 定时任务由运行时初始化按已保存的自动化配置重新注册；它与被中断的 Run 没有续跑关系，之后可以独立触发新的执行。
- 定时触发源在停止、替换或禁用时不能静默丢弃旧 `job.destroy` 失败：停止返回 `success:false`，替换/禁用保留已经生效的新状态但返回失败与逐时间点 `errors`，与 `stopAll` 的 `ok=false` 语义一致。
- Run 存储文件损坏、版本不支持或启动恢复失败时，纳入 Run 的执行接口保持关闭（503），不能用无身份记录的方式继续执行。JSON 语法损坏（截断、手工编辑）与形状/版本错误都属于不可重试的 `AGENT_RUN_STORE_INVALID`；只有磁盘读取/写入等临时错误才返回可重试的 `AGENT_RUN_PERSISTENCE_FAILED`。运行期写入失败按上一条处理：阻止新的准入并返回可重试的 503。
- 正常关闭（SIGINT/SIGTERM）先进入 draining 再收尾活动执行：新提交的执行被拒绝，本实例记录的活动 run 收到停止意图，当前任务进程收到 SIGTERM（关闭预算不足时提前升级 SIGKILL），流程、作业集与作业队列在下一项之前退出。关闭只处理本实例的内存记录与进程内任务进程/流程，不按端口或其他进程的 PID 终止进程。
- 关闭在预算内等待执行器结算，**实际结果决定终态**：已结算的 run 保留执行器写入的 `succeeded`/`failed`/`stopped`；预算耗尽时仍未结算的 run 记为 `interrupted`（`recovery.source=server_shutdown`、`executionResumed=false`），不会写成成功。Run 存储在退出前等待落盘；落盘或执行收尾失败时关闭摘要 `ok=false`，进程以非零退出码结束，其余收尾步骤仍继续执行。
- 重复信号复用同一次关闭，不会在收尾中途再次退出或重复写入停止意图；关闭完成后由新进程重新组装并重新开放准入。
- 异常退出（崩溃、`kill -9` 等）没有关闭流程，仍由下次启动把残留活动记录转为 `interrupted`（`recovery.source=server_restart`）。无论哪种退出，都不保证已 detach 的 MAA 子进程（非 Windows）一定终止，重启后的设备占用需要重新确认。
- 记录被 24 小时/500 条保留策略淘汰后，按 id 查询返回 404：这是“未知或已失效”，不是成功。

### 5.6 运行时关闭与后台触发源

进程入口在异步启动前安装关闭信号处理；初始化取消、关闭预算分配、定时计划替换与重新注册、Telegram 轮询和 WebRTC 预览的停止挂接等完整机制见[运行时初始化、就绪与关闭](../server/runtime-lifecycle.md)。本节保留与执行契约相关的摘要：

- **关闭顺序**：固定为后台触发源与轮询 → 执行收尾 → HTTP 传输 → 预览资源。执行收尾在触发源停止之后进行，按 §5.5 结算已开始的日常流程、作业集与作业队列：执行器在预算内写出的实际结果优先，截止时间到达仍未结算的 run 记为 `interrupted`，不会写成成功或重新排队。传输阶段之前的读取接口（查询 Run、任务状态、日志）继续可用，便于查询执行收尾状态。
- **draining**：关闭开始即关闭 Run 准入与设备租约申请，并拒绝注册新的触发源与生命周期步骤；已经排队的 cron 回调不再启动日常流程或自动更新，已开始的流程仍由实际执行结算。
- **503**：draining 开始后 `beginAgentRun` 返回 503 `AGENT_EXECUTION_SHUTTING_DOWN`，直接申请设备变更权返回 503 `MAA_EXECUTION_SHUTTING_DOWN`；HTTP 执行入口、cron、Telegram 指令、维护更新、作业集继续与作业队列继续/跳过都经过这两个闸门，不会因为入口不同而绕过。关闭期间的提交（包括携带相同幂等键的重放）返回 503，调用方应改为查询已有 run。
- **预算**：关闭预算默认 10 秒，从第一次关闭请求或启动回滚开始统一计算；等待初始化退出与全部逆序释放共用同一截止时间，份额耗尽时传递零预算，不回退默认超时。失败与超时使关闭摘要 `ok=false`，进程以非零退出码结束。
- **回滚**：只有 `close` 的生命周期步骤表示资源已归本实例，注册时即纳入回收；带 `start` 的步骤在实际受理启动时才纳入，尚未启动的资源不会被释放。启动步骤失败按注册逆序释放已受理资源，回滚与后续关闭复用同一次释放及其结果，不掩盖回滚失败。


## 6. 执行入口覆盖

“纳入 Run”指该入口通过 `beginAgentRun`/`executeTrackedAgentAction` 创建服务端 run，并在响应中返回 `runId`。判定依据见 `apps/server/src/controllers/agentExecutionController.ts`、`apps/server/src/controllers/agentMaintenanceController.ts`、`apps/server/src/routes/agent.ts` 与 `apps/server/src/routes/agentContract.ts`。

| 入口 | 端点/调用方 | Run | 租约/执行方式 | 进度来源 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 启动游戏 | `POST /api/agent/actions/start-game` | 是（`start_game`） | 命令期间持有 | run 进度 | 支持 `waitForCompletion=false` |
| 理智作战 | `POST /api/agent/actions/fight` | 是（`fight`） | 逐关执行全程持有 | run 进度 | 支持 dry-run；多关卡按顺序逐关执行 |
| 单任务/通用任务 | `POST /api/agent/actions/run-task` | 是（`run_task`） | 命令期间持有；`{tasks:[...]}` 多任务在整个数组执行期间持有 | run 进度 | Web UI 的单作业、肉鸽、仓库/干员识别都走这里；多任务按顺序逐项执行并归档逐项结果 |
| 日常流程（Agent API） | `POST /api/agent/actions/run-daily-flow` | 是（`run_daily_flow`） | 流程全程持有 | `schedule` 投影进 run 进度 | 默认同步；`waitForCompletion=false` 返回 202；dry-run 不创建 run |
| 日常流程（Web UI 手动） | `POST /api/agent/schedules/manual/execute` | 是（`run_daily_flow`） | 流程全程持有 | `schedule` 投影 + `schedule.runId` | 默认同步兼容原响应；自动化页以 `waitForCompletion=false` 提交并观察 Run；异步模式返回 202；重复提交可用幂等键 |
| 日常流程（Dashboard 快捷） | `POST /api/agent/schedules/dashboard-quick-start/execute` | 是（`run_daily_flow`） | 流程全程持有 | 同上 | 同上 |
| 定时触发 | `schedulerService.executeScheduledTaskFromCron` | 是（`run_daily_flow`） | 流程全程持有 | `schedule` 投影 + `schedule.runId` | 无 HTTP 客户端；无幂等键；Run 在开始前创建，供快照观察 |
| 作业集（continuous，含旧 app/cli） | `POST /api/agent/copilot-sets/{setId}/execute` | 是（`run_copilot_set`） | 集合全程持有 | `run.progress` + 响应 `summary`；完成进度落 `copilot-progress.json` | 默认同步兼容原响应；`waitForCompletion=false` 返回 202 |
| 作业集（manual） | `POST /api/agent/copilot-sets/{setId}/execute`（`mode=manual`）与 `POST /api/agent/actions/continue-copilot-set` | 是（`run_copilot_set`；集合级 `waiting`） | 仅单条目执行期间持有；等待释放 | `run.progress` 的 `waiting_for_next`/逐项结果 | 等待期间其他客户端可占用；继续失败可重试且不消耗条目 |
| 显式作业队列（continuous） | `POST /api/agent/copilot-queues/execute` | 是（`run_copilot_queue`） | 队列全程持有 | `run.progress` + 响应 `summary`；逐项结果来自同一 Run | 默认同步；`waitForCompletion=false` 返回 202；不写 `copilot-progress.json` |
| 显式作业队列（manual） | 同端点（`mode=manual`）与 `POST /api/agent/actions/continue-copilot-queue`、`POST /api/agent/actions/skip-copilot-queue-entry` | 是（`run_copilot_queue`；`waiting`） | 仅单条目执行期间持有；等待释放 | `run.progress` 的 `waiting_for_next`/逐项结果 | 等待期间可继续或跳过；跳过只改下一个 pending 项 |
| 逐项 `run-task`（通用入口） | `POST /api/agent/actions/run-task` | 每项是；集合整体否 | 每项命令期间持有 | 每项 run | 页面内的连续编排已退役；其它调用方仍可逐项提交，但不构成集合身份 |
| 旧断点迁移 | 页面启动读取 `maa-task-flow-execution` | 否（只关联已有 run） | 不获取 | 所关联 run 的 progress | 一次性；不重提，见 5.4 |
| 仓库/干员识别 | `POST /api/agent/actions/run-task`（`command=run` + `taskConfig`，`Depot`/`OperBox`） | 是 | 命令期间持有 | run 进度 | 后续 `depot-recognition`/`operbox-recognition` 只解析本地日志，不是设备执行 |
| 材料数据更新 | `POST /api/agent/actions/fetch-training-materials` | 否 | 不占设备租约 | 无 | 拉取数据脚本，不是设备自动化 |
| 核心/CLI/资源更新 | `POST /api/agent/actions/update-core`、`update-cli`、`hot-update-resources` | 是（`update_core`/`update_cli`/`update_resources`） | 全程持有 | run 进度（受管更新子进程） | 维护入口；默认同步，`waitForCompletion=false` 取得执行权后返回 202；支持按 `runId` 停止；失败归一化为 `AGENT_MAA_UPDATE_*_FAILED`；资源热更新并发时后到请求立即 409 `AGENT_MAA_RESOURCE_UPDATE_IN_PROGRESS` |
| 自动更新 | 定时任务 | 否 | 全程持有 | 无 | 直接调用 Core/CLI 更新命令，无 runId；与维护更新入口共享同一租约与任务进程投影 |
| Telegram 指令 | `telegramBotService` 命令 | 否 | 命令期间持有 | 无 | 外部客户端入口；未纳入 HTTP Run 统一包装 |
| 预览/截图/连接测试 | `/webrtc/*`、`/screen/screenshot`、`test-connection` | 否 | 不属于设备自动化执行 | 预览会话/即时响应 | 不适用 Run |

补充判定：

- `setupSchedule`/`stopSchedule`、`apply-training-plan`、配置保存是**配置写入**，不是执行，不产生 run。
- `run-task` 的 `command=activity|list` 被强制为同步；其他命令可后台执行（202）。
- `run-task` 的 `{tasks:[...]}` 多任务在同一 Run 内按数组顺序逐项执行，整个数组共享租约；单项失败后继续后续任务，最终 Run 为 `failed` 且 `error.details.tasks` 保留全部逐项结果；停止后不再启动剩余任务，未开始项保持 `pending`。
- WebRTC 启停、截图和连接测试只管理预览基础设施，不参与执行租约。
- 只有 Agent API 的四个执行动作（`start_game`、`fight`、`run_task`、`run_daily_flow`）在 manifest/OpenAPI 中声明 `producesRun`，与上表一致。
- `POST /api/agent/schedules/{scheduleId}/execute` 未在 Agent manifest 中广告，但同样创建 `run_daily_flow`；它和 Agent 入口共享 OperationId 与幂等命名空间。
- `POST /api/agent/copilot-sets/{setId}/execute` 与 `POST /api/agent/actions/continue-copilot-set` 面向 Web UI，未在 Agent manifest 中广告；它们创建/推进 `run_copilot_set`，与其他执行共享同一租约与快照。
- `POST /api/agent/copilot-queues/execute`、`POST /api/agent/actions/continue-copilot-queue` 与 `POST /api/agent/actions/skip-copilot-queue-entry` 面向 Web UI，未在 Agent manifest 中广告；它们创建/推进 `run_copilot_queue`，与其他执行共享同一租约与快照。
- 定时流程与 HTTP 入口使用同一执行租约；同一时刻只有一个流程能进入 pre-start gate，第二个触发会得到占用失败而不是并行执行。
- 资源热更新在服务实例内 single-flight：已有 `hot-update-resources` 进行中时，后到请求不会排队等待首个结束，也不会复用首个结果，而是在创建本次 Run 后立即返回 409 `AGENT_MAA_RESOURCE_UPDATE_IN_PROGRESS`（`details.activeRunId`/`activeRunState` 指向进行中的 Run）；被拒绝的 Run 按执行前拒绝写入 `failed` 并释放幂等键，首个更新结束后可重新发起。

## 7. 契约演进与持久化维护

旧 HTTP 入口、响应字段、同步默认值、作业集模式别名及外部调用方的现存消费者、支持窗口和移除条件，统一见[前端兼容入口与移除规则](../frontend/compatibility.md)。新增 Run 字段不授权删除旧字段；客户端按身份观察和停止的约束见[执行客户端](execution-client.md)。

Run 存储当前使用 `version: 1`，只接受该版本并严格校验记录；不支持任意旧版本的自动迁移。后续升级格式必须能读取旧文件，或提供明确迁移路径，并保留 `runId`、终态与幂等记录的一致性。服务端回退前必须确认目标版本能读取当前文件格式；不支持的格式应保持 fail-closed，不得删除 Run 文件来绕过准入关闭。

回退前端前应确认正在执行的 Run、持久化身份与外部设备占用，并检查目标版本对 `waiting`、幂等键和按身份停止的支持。不得清空服务端记录或因为旧页面没有新字段就重提执行。终态记录的保留限制由[持久化与运行数据](../server/persistence.md#run-存储与幂等记录)维护，服务重启中断语义见 5.5。

## 8. 契约测试清单

### 当前契约测试

- **入口命令**：`pnpm --filter la-pluma-next-server test`（仓库根 `pnpm test` 会连同客户端一起运行）。测试只发现 `apps/server/src` 各级 `__tests__` 目录下的 `*.test.ts`，逐文件、逐进程串行执行；本清单覆盖的契约测试分布在 `apps/server/src/services/__tests__/`、`apps/server/src/routes/__tests__/` 与 `apps/server/src/__tests__/`。
- **Run 状态机**：生命周期转换与终态幂等、`waiting` 等待/恢复/停止、accepted 取消、pre-start 门禁在 spawn 前生效并放弃启动；幂等键按 `operationId` 分区、同键不同输入拒绝、跨重启重放不重新执行；current 排序与设备所有权对齐（滞留 `stopping` 不压过新 `running`）。
- **持久化与恢复**：重启后活动 run（含 `waiting`）转 `interrupted` 并带 `recovery`；终态保留淘汰与写回；JSON 语法损坏不可重试、磁盘错误可重试、坏版本 fail-closed；cron 日常流程终态写回磁盘。
- **快照与占用**：`occupancy` 的 idle/pending/run/external/unknown 与租约 free/held/stale/unknown；`lastRun` 与当前身份分离；只有 current 带进度，日常流程只投影自己持有的 `schedule.runId`。
- **HTTP 契约**：目标停止矩阵与“旧 run 不误停新运行”；同步/后台 202 与幂等重放响应头、错误码映射；manifest/OpenAPI 同源且与实际挂载 router 图一致，恰好四个执行动作声明 `producesRun`，公开 operation 按发布 schema 校验请求与真实响应；HTTP 排空（在途响应完整结束、keep-alive 回收、超时强制断开并非零退出）与信令网关关闭失败仍排空 HTTP。
- **停止时序**：`mode` 校验与非法值 400；非肉鸽、非战斗中、无法判定时回退立即停止；战斗中只记录 `pendingStop` 与 `progress.stopIntent` 而不下发设备停止；增量出现 `RoguelikeCombatEnd` 或到达 600 秒上限后下发并清除 `stopIntent`；增量文本为空、不可读或没有结束标记时不提前结束等待（`truncated` 尾部文本仍参与肯定发现）；`StageInfoError` 不改变战斗状态；run 先进入终态时释放 watcher 且不补发停止；`mode=now` 取消 pending 并立即停止。
- **租约与执行**：租约互斥、死进程锁回收、unknown/空锁拒绝获取、锁文件完整内容原子发布；执行失败释放租约。
- **维护更新 Run**：Core/CLI/资源更新返回 `runId` 与可查询终态；`waitForCompletion=false` 在取得执行权、产生受管子进程前返回 202；`running` 的更新 run 作为 `occupancy.state=run` 出现，按 `runId` 停止终止受管更新子进程并释放租约；失败归一化为 `AGENT_MAA_UPDATE_*_FAILED` 写入 `failed` 终态，详情保留各操作的领域字段（core 为 `version`/`failedStep`/`coreUpdated`，CLI 为 `channel`/`source`，资源为 `failedStep`）；资源热更新并发时后到请求立即得到 409 `AGENT_MAA_RESOURCE_UPDATE_IN_PROGRESS`（含当前更新 `activeRunId`/`activeRunState` 与本次被拒绝的 `runId`），首个更新结束后可重新开始且不启动第二次更新；相同幂等键重放原 run，不重复执行更新。
- **作业集与流程**：continuous/manual 的等待、继续与停止语义，占用 409 可重试且不消耗条目，逐项结果归属 `runId`；计划构建与逐项状态分类；可中止的步间等待，完成副作用在租约释放且 Run 结算后消费；cron 产生单个带终态结果的 `run_daily_flow`，占用时 fail-closed；触发源重复配置替换、销毁失败上报、draining 后拒绝注册并丢弃排队回调。
- **关闭与后台触发源**：draining 后 Run 准入与设备租约 503 且不可绕过；执行器实际结果优先，预算耗尽记为 `interrupted`；子进程 SIGTERM 与预算内升级 SIGKILL；重复信号复用同一次关闭；Telegram 停止后不执行迟到命令；外部预览资源不被停止，网关关闭断开观看连接并清空票据；启动逆序回收、初始化取消与统一关闭截止时间。

客户端控制器、各领域接线与全局投影的回归入口见[执行客户端](execution-client.md#7-回归清单)；跨页场景见[跨页面集成验收](../development/integration.md)。本节只维护服务端身份、状态机、持久化与执行入口的契约测试。
