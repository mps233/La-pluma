# Agent API 使用指南

> [← 返回文档索引](../README.md)

La Pluma Next 提供一层给 AI/Agent 使用的轻量控制接口。它不是前端内部 API 的简单暴露，而是更语义化的 manifest/status/actions 层，方便 Agent 或自定义自动化发现能力、读取状态和执行动作。Manifest 与 OpenAPI 由同一份能力清单生成，并公开每个动作的风险、dry-run、轮询和停止方式。

## 发现能力

```bash
curl http://localhost:3000/api/agent/manifest
curl http://localhost:3000/api/agent/openapi.json
```

## 读取状态

```bash
curl http://localhost:3000/api/agent/status
```

返回内容会汇总：MAA 版本、任务状态、ADB 连接、前台窗口、WebRTC 预览可用性、最近日志和下一步建议。

连接相关接口默认读取 `profileId: "default"` 对应的连接配置，也可以选择其它已保存配置。显式传入的 `adbPath`、`address` 或 `clientType` 会覆盖该配置中的同名字段。

## 运行环境诊断

```bash
# 通用诊断
curl 'http://localhost:3000/api/agent/diagnostics'

# 附带任务预检：校验命令是否允许，并检查当前是否已有任务占用执行权
curl 'http://localhost:3000/api/agent/diagnostics?command=roguelike'
```

`GET /api/agent/diagnostics` 返回只读诊断报告，供 Agent 在提交任务前判断能否执行。报告固定包含四项检查：

| 检查 | `id` | 内容 |
| --- | --- | --- |
| 运行环境 | `runtime` | maa-cli 与 MaaCore 版本是否可读 |
| 设备连接 | `connection` | ADB 设备是否可连接，附地址、设备摘要与前台包名 |
| 资源状态 | `resource` | 资源版本新鲜度与关键目录条目（`version.json`、`tasks`、`template`） |
| 任务预检 | `execution` | 可选 `command` 的参数预检、当前任务与执行租约 |

响应 `data` 的每个检查条目包含 `status`（`pass`/`warn`/`fail`；类型仍保留 `unknown`，当前四项探测不会返回它）、可读 `summary`、证据 `details`、可选 `hint` 与定位信息 `locations`；整体 `status` 为 `fail` 优先的 `error`/`warn`/`ok`，`ok` 仅在全部检查通过时为 `true`，`conclusion` 给出结论摘要。除探测 ADB 连接外不产生副作用，不创建 Run。

四项外部探测在进程内合并并短时缓存（约 1.5 秒），并发诊断请求只启动一次 MAA/ADB/资源目录探测；响应固定 `Cache-Control: no-store`，不把旧结论交给后续请求。未配置 `LA_PLUMA_TOKEN` 时，该入口按来源地址限流（默认每分钟 30 次），超出返回 429 `AGENT_RATE_LIMITED` 与 `Retry-After`；配置 token 后由鉴权承担访问边界。

## 推荐执行流程

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

# 立即拿到 runId，稍后再查询终态（流程获得执行权后返回 202）
curl -X POST http://localhost:3000/api/agent/actions/run-daily-flow \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: daily-flow-20260712-02' \
  -d '{"dryRun":false,"waitForCompletion":false}'

# 轮询运行快照：当前 run、全部活动意图、最近终态与设备占用
curl 'http://localhost:3000/api/agent/runs/current?lines=80'

# 按启动响应中的 runId 查询本次执行，即使任务已经结束仍可读取终态
curl 'http://localhost:3000/api/agent/runs/00000000-0000-4000-8000-000000000000'

# 只终止指定 run，避免误停随后启动的其它任务；也可使用响应里的 stopUrl/links.stop
curl -X POST http://localhost:3000/api/agent/actions/stop \
  -H 'Content-Type: application/json' \
  -d '{"runId":"00000000-0000-4000-8000-000000000000"}'
```

### Web UI 专用端点（不在 Agent manifest）

以下端点由 Web UI 使用，未在 `AGENT_OPERATIONS` 中注册，也不会出现在 manifest/OpenAPI 中；Agent 应使用上面的 manifest 动作，而不是依赖这些入口：

```bash
# 日常流程：Web UI 手动触发；默认同步，支持 waitForCompletion=false
curl -X POST http://localhost:3000/api/agent/schedules/manual/execute \
  -H 'Content-Type: application/json' \
  -d '{"taskFlow":[...]}'

# 作业集：continuous（默认，含旧 app/cli）返回集合 runId
curl -X POST http://localhost:3000/api/agent/copilot-sets/12345/execute \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: copilot-set-20260712-01' \
  -d '{"mode":"continuous","raid":"normal","selectedIndexes":[0,1]}'

# 作业集：manual 首项执行后等待下一关，不会自动连续
curl -X POST http://localhost:3000/api/agent/copilot-sets/12345/execute \
  -H 'Content-Type: application/json' \
  -d '{"mode":"manual","selectedIndexes":[0,1]}'

# 继续 manual 作业集的下一项（run 必须处于 waiting）
curl -X POST http://localhost:3000/api/agent/actions/continue-copilot-set \
  -H 'Content-Type: application/json' \
  -d '{"runId":"00000000-0000-4000-8000-000000000000"}'
```

#### 作业队列执行

Web UI 的「作业队列」按显式条目提交 `run_copilot_queue`，不经过作业集计划，也不写入作业集的 `copilot-progress.json`。队列条目为 1–50 项，`clientId` 在本次请求内唯一（`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`）；`source=prts` 使用正整数 `copilotId`，`source=file` 使用受管目录 `copilot-imports/` 内的绝对 `.json` 路径。`mode` 为 `continuous`（默认，旧 `app`/`cli` 同义）或 `manual`；每项 `mode` 可用 `normal`（接口默认）、`raid`、`both` 或 `auto`；预设编队只按普通模式展开——`both` 只产出 `normal`，显式 `raid` 的预设编队条目不进入计划。`failurePolicy` 为 `stop`（默认）或 `continue`；`queueId` 可选（缺省 `copilot-queue`，仅字母数字与 `.`/`_`/`-`，1–64 位），`name` 可选（缺省「作业队列」，最多 128 字）；`options` 与作业集执行使用同一组字段；`waitForCompletion` 默认 `true`，Web UI 传 `false` 以先取得 `runId` 再观察 Run。

```bash
# 提交显式队列；queueId/name 只是 Run 标签
curl -X POST http://localhost:3000/api/agent/copilot-queues/execute \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: copilot-queue-20260712-01' \
  -d '{"queueId":"my-queue","name":"我的作业队列","mode":"manual","failurePolicy":"stop","entries":[{"clientId":"queue-a","source":"prts","copilotId":1088231,"mode":"normal"},{"clientId":"queue-b","source":"file","filename":"/path/to/copilot-imports/uuid.json","mode":"raid"}],"waitForCompletion":false}'

# manual 首项完成后等待下一项
curl -X POST http://localhost:3000/api/agent/actions/continue-copilot-queue \
  -H 'Content-Type: application/json' \
  -d '{"runId":"00000000-0000-4000-8000-000000000000"}'

# 跳过下一个待执行项（仅 manual waiting）
curl -X POST http://localhost:3000/api/agent/actions/skip-copilot-queue-entry \
  -H 'Content-Type: application/json' \
  -d '{"runId":"00000000-0000-4000-8000-000000000000"}'
```

- 同步终态响应与作业集同形：`runId`、`run`、`state`、`mode`、`queueId`、`name`、`failurePolicy`、`summary`、`message`；`waitForCompletion=false` 在取得执行权或进入 waiting 后返回 202，`data.accepted=true`。
- manual 首项完成后 Run 为 `waiting`，响应带 `waitingForNext:true`、`nextEntry` 与当前 `summary.taskResults`；继续与跳过只在该状态可用。跳过把下一个 `pending` 项改为 `skipped` 并保持 waiting；若已无 pending 则结算为 `succeeded`。
- 错误码：未找到 Run `AGENT_RUN_NOT_FOUND`（404）；非等待/连续模式 `AGENT_COPILOT_QUEUE_NOT_WAITING`（409）；会话丢失 `AGENT_COPILOT_QUEUE_SESSION_LOST`（409）；租约被占 `MAA_EXECUTION_BUSY`（409，保持 waiting 且不消耗条目）；请求校验失败为 `AGENT_VALIDATION_*`（400）；计划获取失败为 `AGENT_COPILOT_QUEUE_UNAVAILABLE`（502）。
- 停止继续使用 `POST /api/agent/actions/stop?runId=`：waiting 直接转 `stopped` 并保留逐项结果；running 转 `stopping`，执行器在下一项前退出；accepted 直接取消。逐项状态、`failurePolicy`、waiting 与重启语义见[执行生命周期](../architecture/execution-lifecycle.md#43-显式作业队列-run)。
- 本端点不在 `AGENT_OPERATIONS` 中，也不出现在 manifest/OpenAPI；Agent 需要批量执行时应使用 manifest 中的任务动作，不能依赖 Web UI 队列入口。

### 自定义基建排班文件端点（不在 Agent manifest）

Web UI 的基建排班编辑器通过下列端点读写 MAA 配置目录 `infrast/` 下的排班 JSON。它们同样属于 Web UI 专用入口，未在 `AGENT_OPERATIONS` 中注册，也不会出现在 manifest/OpenAPI 中：排班文件是编辑器维护的 MAA 配置，不是面向 Agent 的语义化动作，这些端点只读写文件，不创建 Run、不占用执行租约，也不做任务参数预检。

```bash
# 列出排班文件：返回 { directory, schedules }，schedules 每项含 name、title、planCount、updatedAt 与 valid
curl 'http://localhost:3000/api/agent/infrast-schedules'

# 读取单个文件：返回 { name, document }，name 与 maa-cli 解析 filename 的规则一致
curl 'http://localhost:3000/api/agent/infrast-schedules/document?name=daily.json'

# 保存文件：请求体为 { name, document }，服务端按 Core 协议校验后原子写入
curl -X PUT http://localhost:3000/api/agent/infrast-schedules/document \
  -H 'Content-Type: application/json' \
  -d '{"name":"daily.json","document":{"plans":[{"rooms":{}}]}}'
```

`name` 相对 MAA 配置目录下的 `infrast/`，也可传入落在该目录内的绝对路径；`..`、非 `.json` 与符号链接逃逸均被拒绝。读取返回 `{ name, document }`，`document` 是解析后的原始 JSON，不补默认值；保存只校验已知字段，未知扩展字段原样保留。文件位置、校验与协议字段见[日常流程与定时触发](../server/scheduling.md#自定义基建排班文件)。鉴权与其他 `/api` 路由一致（`LA_PLUMA_TOKEN` 开启时需要令牌，认证失败限流同样适用）；参数或路径不合法、文件不存在、读写失败分别返回 `AGENT_INFRASTRUCT_SCHEDULE_INVALID`（400）、`AGENT_INFRASTRUCT_SCHEDULE_NOT_FOUND`（404）与 `AGENT_INFRASTRUCT_SCHEDULE_IO_FAILED`（500，`retryable: true`）。Agent 需要执行基建换班时应使用 `run-task` 的 `Infrast` 任务配置，而不是依赖这些端点。

### 维护更新端点（不在 Agent manifest）

Core/CLI/资源更新由 Web UI 的维护端点发起，同样创建服务端 Run；CLI 或自定义调用方可以使用同一套 API：

```bash
# 取得执行权、产生维护子进程前返回 202 与 runId
curl -X POST http://localhost:3000/api/agent/actions/update-core \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: update-core-20260712-01' \
  -d '{"waitForCompletion":false}'

# 轮询终态与进度；更新进度来自受管维护子进程
curl 'http://localhost:3000/api/agent/runs/00000000-0000-4000-8000-000000000000'

# 按 runId 停止：终止受管维护子进程，终态为 stopped
curl -X POST http://localhost:3000/api/agent/actions/stop \
  -H 'Content-Type: application/json' \
  -d '{"runId":"00000000-0000-4000-8000-000000000000"}'
```

`update-cli`（body 可选 `channel`）与 `hot-update-resources` 共用同一响应形状：默认同步返回既有领域字段并新增 `runId`、`run`、`pollUrl`、`stopUrl`；`waitForCompletion=false` 在取得执行权后返回 202。失败保留既有 `AGENT_MAA_UPDATE_CORE_FAILED`、`AGENT_MAA_UPDATE_CLI_FAILED`、`AGENT_MAA_RESOURCE_UPDATE_FAILED` 错误码，并把同一错误模型写入 `run.error`。三类更新与自动化、日常流程共用执行租约，占用时返回 409；`dryRun` 仍只返回计划，不创建 Run。

`update-core` 成功载荷的 `steps.core.success` 与 `steps.resources.success` 由实测状态派生（布尔值，不是固定 `true`），并携带 `channelPersisted`：核心安装/更新及其内置资源同步成功、但请求的渠道未能写入 `cli.toml` 时仍返回 200，`channelPersisted === false` 且 `message` 明确“渠道配置未能持久化”，不声称已切换。core 命令成功后的失败按失败步骤归因：资源状态无法确认返回 `AGENT_MAA_UPDATE_RESOURCE_FAILED`（`details.failedStep === 'resources'`、`coreUpdated === true`，实测 `runtime` 一并返回），版本刷新失败返回 `AGENT_MAA_UPDATE_CORE_FAILED`（`details.failedStep === 'runtime'`、`coreUpdated === true`）；只有 core 命令本身失败才写 `failedStep: 'core'` 与 `coreUpdated: false`。客户端据此在 core 已更新但资源未确认时提供资源重试入口。

资源热更新在同一时间只执行一次，但不排队也不复用首个请求的结果：已有 `hot-update-resources` 进行中时，后到请求会先创建本次 Run，再立即以 409 `AGENT_MAA_RESOURCE_UPDATE_IN_PROGRESS`（`retryable: true`）失败，而不是等待首个更新结束后才报错。`error.details.activeRunId`/`activeRunState` 指向正在进行的 Run，`error.details.runId`/`run` 是本次被拒绝并写入 `failed` 的 Run，`message` 给出可读提示；首个更新结束（成功、失败或停止）后可用同一请求重新发起。

维护端点还包括更新渠道与资源源配置。它们只读写 maa-cli 的 `cli.toml`，属于配置读写而不是执行动作：

```bash
# 读取已保存的更新渠道；cli.toml 缺失时回落到 stable，损坏或不可读时带 degraded 标记
curl 'http://localhost:3000/api/agent/update-channels'

# 保存更新渠道：scope 为 core（stable/beta/alpha）或 cli（stable/beta/nightly）
curl -X POST http://localhost:3000/api/agent/actions/update-channel \
  -H 'Content-Type: application/json' \
  -d '{"scope":"core","channel":"beta"}'

# 读取资源源配置、官方 Git 地址与 MirrorChyan 凭据形态
curl 'http://localhost:3000/api/agent/config/resource-source'

# 保存资源源配置，省略分支与 MirrorChyan CDK 时保留已保存值
curl -X POST http://localhost:3000/api/agent/config/resource-source \
  -H 'Content-Type: application/json' \
  -d '{"autoUpdate":false,"warnOnUpdateFailure":true,"source":"git","git":{"backend":"git"},"mirrorchyan":{"checkInterval":600}}'
```

`GET /api/agent/update-channels` 返回 `{ core, cli }`。`POST /api/agent/actions/update-channel` 保存成功后返回同一形状。`cli.toml` 缺失时返回缺省值，文件损坏或不可读时额外携带 `degraded: true` 并记录错误日志。`GET /version` 的 `updateChannels` 沿用该形状，其 `resource` 在部分候选资源目录读取失败但仍有可用信息时也携带 `degraded: true`。全部候选目录都不可读时，资源版本信息回退为 `unknown`。

`GET/POST /api/agent/config/resource-source` 读写同一文件的 `[resource]`。响应的 `git.url` 固定为 `https://github.com/MaaAssistantArknights/MaaResource.git`。请求的 `git` 对象只接受必填的 `backend` 和可选的 `branch`。省略 `git.branch` 会保留已有分支配置，提交 `null` 或空白字符串会清除它。提交 `url`、`useSshAgent`、`sshKey` 或 `passphrase` 会返回 400 `AGENT_RESOURCE_SOURCE_INVALID`，`error.details.field` 指向请求字段，响应省略传入的值。MirrorChyan 仍可作为独立来源，`mirrorchyan.cdkKind` 只回显 CDK 形态（`none`/`plain`/`env`/`command`/`prompt`）。省略或留空 `mirrorchyan.cdk` 会保留已保存的 CDK，`mirrorchyan.clearCdk: true` 会清除它。

执行租约被占用时，保存返回 409 `MAA_EXECUTION_BUSY`，防止执行期间切换已核验的资源源。当前任务结束后可重试。

这四个配置端点的契约以本节为准，供设置页和手动调用使用。

更新相关端点另有参数错误码：`AGENT_MAA_UPDATE_CORE_CHANNEL_INVALID`（400，`details.version`，仅当显式传入且不是 `stable`/`beta`/`alpha`；校验先于读取 `cli.toml`）来自 `update-core`；`AGENT_MAA_UPDATE_CLI_CHANNEL_INVALID`（400，`details.channel`）与 `AGENT_MAA_UPDATE_CLI_UNSUPPORTED`（409，`retryable: false`，`details.channel`/`source`；`dryRun` 不拦截不支持的安装来源）来自 `update-cli`；`AGENT_UPDATE_CHANNEL_SCOPE_INVALID`（400，`details.scope`）、`AGENT_UPDATE_CHANNEL_INVALID`（400，`details.scope`/`channel`）与 `AGENT_RESOURCE_SOURCE_INVALID`（400，`details.field`，`retryable: false`）来自渠道与资源源写入。

理智作战按关卡逐条执行：`stages` 中每一项生成一次 `maa-cli fight <stage> [--times <n>]` 调用，共享 `medicine`/`medicineExpireDays`/`stone`/`series` 选项。`medicineExpireDays` 使用 `--medicine-expire-days` 按“过期天数”选择临期理智药；旧调用方仍可传 `expiringMedicine`（按瓶数），映射到已弃用但仍可用的 `--expiring-medicine`。`series` 范围为 `-1~10`，旧资源只接受 `-1~6`。参数超出范围或不是整数时返回 400 `AGENT_VALIDATION_FIGHT_OPTIONS_INVALID`；多个关卡不会拼接成逗号分隔的单个参数，含逗号的旧式关卡串仍会拆成逐关调用。整个 Run 由逐关执行结果统一结算，任一关真实失败或收到停止都会阻止后续关卡并写入终态；`waitForCompletion=false` 在首关取得执行权后返回 202，期间 Run 保持 `running`；按目标 `runId` 停止会终止当前关，最终为 `stopped`。同步完成响应与 Run 终态的 `result.stages` 逐关给出 `status`（`success`/`skipped`/`stopped`/`pending`）、`message` 与该关输出，`result.stopped` 表示整个 Run 是否因停止结束。关卡未开放记为 `skipped` 并继续下一关，理智耗尽记为 `skipped` 并跳过所有剩余关卡；活动代号映射（`hd-N`）与关卡开放预检属于日常流程任务，本入口按请求中的关卡代号原样下发。`dryRun` 的 `plan.stages` 列出每一关的完整参数，`plan.args` 保留首关参数以兼容既有读取方。

所有标准响应都包含 `success`、`message` 和 `meta`。真实执行响应还包含稳定的 `runId`、`run`、`pollUrl` 和 `stopUrl`；后台接受执行时返回 HTTP `202`。Dry-run 响应会设置 `meta.dryRun: true`；失败响应的 `error` 包含稳定的 `code`、`details` 与 `retryable`，执行器忙碌时返回 HTTP `409`。API 错误经过统一错误出口：`/api` 下未匹配的路径返回 404 `AGENT_ROUTE_NOT_FOUND`；无法解析的 JSON 请求体返回 400 `AGENT_REQUEST_BODY_INVALID`，超过大小限制返回 413 `AGENT_REQUEST_BODY_TOO_LARGE`，字符集不支持返回 415 `AGENT_REQUEST_CHARSET_UNSUPPORTED`；路径参数解码失败返回 400 `AGENT_REQUEST_PATH_INVALID`；用户配置写接口（`POST /api/agent/config/user/{configType}` 与 `POST /api/agent/notifications/config`）的请求体必须是 JSON 对象，其他顶层类型返回 400 `AGENT_CONFIG_DATA_INVALID`。错误状态限制在 400–599；携带业务状态的错误保留其公开 `code`、`message`、`details` 与 `retryable`，`retryable` 只来自错误本身，不按 5xx 推导；未知内部错误统一返回 500 `AGENT_INTERNAL_ERROR`，不泄露内部 message、details 或堆栈。错误响应与错误日志不回显请求查询串。日常流程的 Agent 入口是 `POST /api/agent/actions/run-daily-flow`；Web UI 另使用未在 manifest 中广告的 `/api/agent/schedules/{scheduleId}/execute`，两者共用 `run_daily_flow`，旧同步响应字段保持不变。Run 状态机与终态、同步与后台接受（202）响应的对应、执行身份、唯一状态来源、停止语义和断线/占用/刷新等边界的完整约定见[执行身份与生命周期契约](../architecture/execution-lifecycle.md)。

作业集入口 `/api/agent/copilot-sets/{setId}/execute` 由 Web UI 使用，未在 Agent manifest 中广告；它使用 `run_copilot_set`。`mode` 可取 `continuous`（默认，旧 `app`/`cli` 也映射到这里）或 `manual`。计划查询与执行的 `raid` 都接受 `normal`（接口默认）、`raid`、`both` 或 `auto`。`continuous` 默认同步返回旧字段并新增 `runId`、`run`、`mode`、`summary`；`waitForCompletion=false` 在取得执行租约后返回 202。`manual` 只执行第一个待办条目然后返回 `waitingForNext: true`、`nextEntry` 与逐项 `summary`，run 进入 `waiting`；随后调用 `POST /api/agent/actions/continue-copilot-set` 携带该 `runId` 执行下一项。`waiting` 期间的租约与占用、停止与逐项状态汇总、服务重启后转 `interrupted` 等集合 Run 行为的完整约定见[执行身份与生命周期契约](../architecture/execution-lifecycle.md)。

显式作业队列入口 `/api/agent/copilot-queues/execute` 同样由 Web UI 使用、未在 Agent manifest 中广告；它使用 `run_copilot_queue`，按提交顺序逐条执行，不依赖作业集计划，也不写 `copilot-progress.json`。`continuous` 一次执行全部条目，`manual` 在每项后进入 `waiting`；继续与跳过分别使用 `/api/agent/actions/continue-copilot-queue` 与 `/api/agent/actions/skip-copilot-queue-entry`。逐项状态、`failurePolicy`、停止、会话丢失与重启语义见上文「作业队列执行」及[执行身份与生命周期契约](../architecture/execution-lifecycle.md#43-显式作业队列-run)。

请求关联与日志：请求头 `x-request-id` 可选，合法值为 1–64 位字母、数字与 `.`、`_`、`:`、`-`，首字符必须是字母或数字。合法值原样出现在响应头 `x-request-id`、响应 `meta.requestId` 与同一请求的 API 错误日志中；缺失、超长或含其他字符时服务端生成新 id 并在上述三处使用该新 id，非法输入不会回显。执行日志（含 MAA 子进程输出与响应返回后的后台收尾）在纳入 Run 时记录 `runId` 与 `operationId`，未纳入 Run 的直接调用不冒用其他执行的 id；HTTP 请求结束不代表执行完成，仍需以 run 终态或实际进程结果为准。API 错误按级别记录：携带状态且已归类的 4xx 为 WARN，未知内部 5xx 为 ERROR。日志不输出 Authorization、cookie、token、信令 ticket、密码与签名等凭据字段，也不回显请求查询串或请求体。

`GET /api/agent/logs/recent` 仍返回最近记录数组，每条包含采集时间、原级别、脱敏消息及可用的执行归属，并增加稳定 `id` 与递增 `sequence`。清空缓冲不重用身份，服务重启生成新的实例前缀；该接口没有游标、完整 Run 归档或缺口回补能力。`POST /api/agent/logs/recent/clear` 清除服务端共享缓冲，是影响所有观察者的维护动作；Web 日志页的“清屏”只维护本地可见边界。

`runs/current` 返回运行快照：`run` 是当前活动 run，`activeRuns` 列出全部活动意图，`lastRun` 是最近终态，`occupancy` 说明设备由 `run` 还是未纳管执行（`external`）占用，或只是 `pending`、`idle`、`unknown`；旧字段 `isRunning`、`taskName`、`schedule`、`recentLogs` 保持原样，`schedule.runId` 为 `null` 表示该流程没有 Run 身份。活动的肉鸽/生息演算 `run_task` 在 `run.progress.roguelike` 暴露实时进度（`mode`、局数、当前局、结算支持、当前动作、最近 5 局、最近事件与 `degraded`/`observed`）；观察到 `BlackFlow*` 回调时同一快照带 `blackflow` 子投影（楼层、当前节点、行动力、最近路由与节点完成、里程碑、策略结果），普通集成战略与生息演算为 `null`。`stopping` 期间进度仍可读取；终态最终快照位于 `result.summary.progress`，失败时位于 `error.details.summary.progress`，`lastRun` 不追加 `progress`。快照各字段、占用与租约投影、进度投影及“进程 idle 不代表流程完成”等判定规则的完整约定见[执行身份与生命周期契约](../architecture/execution-lifecycle.md)。

目标停止按 `runId` 保护：未开始的 run 直接取消且不发送设备命令，`running` 的当前 run 转入 `stopping`，旧终态 run 返回 `alreadyTerminal`，不会影响新执行；重复停止保持成功。请求体可带 `mode`：`now`（缺省，原有行为）或 `after-combat`；后者只对正处于战斗的肉鸽/生息演算当前 run 延后受理，响应保留 `run.state=running`、返回 `pendingStop`（`mode`、`requestedAt`、`deadline`、`combat`）并在进度中给出同一 `stopIntent`，设备停止等本场战斗结束或 600 秒上限后才下发，其余情况一律退化为立即停止；重复请求返回同一 `pendingStop` 与 `alreadyPending: true`。响应中的 `stopRequested` 表示停止意图已记录，`deviceStopRequested` 表示是否真的发出了设备停止命令；按目标状态区分的完整停止矩阵与取消语义见[执行身份与生命周期契约](../architecture/execution-lifecycle.md)。

`Idempotency-Key` 是可选请求头，适用于启动游戏、理智作战、通用任务与今日流程；Web UI 专用的作业集入口、显式作业队列入口和 `/api/agent/schedules/{scheduleId}/execute` 也支持。相同 key、相同输入重试时返回原 `runId`，对象键顺序不影响比较，但显式参数差异会被视为不同输入。幂等键按 `operationId` 分区、同键不同输入的拒绝、重放与键释放规则，以及 Run 与幂等记录的持久化、重启 `interrupted` 语义和终态保留期限的完整约定见[执行身份与生命周期契约](../architecture/execution-lifecycle.md)。


Run 存储以单个 La Pluma Next 服务实例为边界，需要修改路径时可设置 `LA_PLUMA_AGENT_RUN_STORE`；默认存储位置、单实例读写约束与保留策略见[执行身份与生命周期契约](../architecture/execution-lifecycle.md)。

## 通用任务

优先使用 `fight`、`run-daily-flow` 等语义化动作。只有明确知道 MAA CLI 参数时，才使用高风险的通用白名单入口：

```bash
# 执行白名单 maa-cli 子命令
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -d '{"command":"reclamation","args":["Tales","-m","1"],"taskName":"生息演算","waitForCompletion":true}'

# 执行动态任务配置
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -d '{"command":"run","args":["agent-award"],"taskConfig":{"name":"领取奖励","type":"Award","params":{"award":true}},"waitForCompletion":true}'
```

`command` 只接受 maa-cli 子命令；`Award`、`Depot`、`OperBox`、`Infrast`、`Recruit`、`Mall` 等 Core 任务类型没有对应的 CLI 子命令，必须使用 `command: "run"` 与 `taskConfig` 走动态任务通路，`args` 首项用作临时任务文件名前缀。

如果设置了 `LA_PLUMA_TOKEN`，Agent API、其它 `/api/*` 以及 WebRTC 同源网关的票据入口都需要 `Authorization: Bearer <token>` 或 `X-La-Pluma-Token`。未设置时认证关闭。

认证失败返回 401 `AGENT_AUTH_REQUIRED`，失败限流返回 429 `AGENT_RATE_LIMITED`，未设置令牌时信令票据入口拒绝跨源请求并返回 403 `AGENT_SIGNALING_ORIGIN_FORBIDDEN`。令牌比较、按来源限流与信令来源规则的完整约定见[部署指南](../guides/deployment.md#跨域与访问来源)；信令凭据与上游账号的迁移要求见[部署指南](../guides/deployment.md#信令凭据与上游端口边界)。

### 游戏内培养与游戏主题

`OperProgress`（游戏内培养）与 `SwitchTheme`（游戏界面主题更换）使用 maa-cli 0.7.8+ 的动态任务通路。页面在“日常”的任务目录中提供两项配置，可加入已有流程；Agent 通过 `run_task` 提交，不使用专用 CLI 子命令。

```bash
# 在游戏内执行培养，会消耗材料与龙门币
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: operator-progress-01' \
  -d '{"command":"run","taskConfig":{"name":"游戏内培养","type":"OperProgress","params":{"plans":[{"role":"Warrior","name":"银灰","elite":2,"skill_level":7,"skill_mastery":[0,0,1]}]}},"waitForCompletion":false}'

# 多个候选主题由 Core 随机选取一个，名称与游戏内显示一致
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: switch-game-theme-01' \
  -d '{"command":"run","taskConfig":{"name":"游戏界面主题更换","type":"SwitchTheme","params":{"themes":["夜间","银凇"]}},"waitForCompletion":false}'
```

培养计划 `plans` 的每项使用游戏内干员名 `name`；`role` 可省略或设为 `Unknown` 由 Core 推断，也可指定 `Pioneer`、`Warrior`、`Tank`、`Sniper`、`Caster`、`Medic`、`Support`、`Special`。可选目标为精英阶段 `elite`（1–2）、技能等级 `skill_level`（2–7）与专精 `skill_mastery`（三个 0–3 的整数，依次对应三个技能，0 表示不处理）。未配置的目标不执行。`plans` 不能为空，每项计划也必须至少选择一个培养目标（`elite`、`skill_level` 或至少一个大于 0 的专精槽位），否则请求在执行前被拒绝。培养可能自动合成材料，缺少双芯片时可能消耗采购凭证购买芯片助剂；专精结果中的“已启动训练”不代表训练完成或最终目标已达成。

Core 每轮执行最多启动一项专精训练。本次已经启动训练，或训练室在本轮开始前已被占用时，同一计划剩余的专精槽位与后续计划的专精目标本轮都不会执行。已发出的训练结果仍保留在 `details`；没有回调的剩余目标以动作的 `deferredMastery` 与 `deferredCount` 标出，需在后续运行中再次提交。

两类任务沿用现有 Run 身份、幂等、轮询与目标停止。结果动作的 `action` 分别为 `operprogress`、`switchtheme`，保留 `success`、`failed`、`skipped` 区别。独立任务成功或跳过的明细在 `run.result.actions`；确认游戏任务失败时返回 `AGENT_GAME_TASK_FAILED`（HTTP 422，`retryable: false`），Run 为 `failed`，明细保留在 `run.error.details.actions`。日常流程将动作合并到现有结果摘要，按步骤分别计数。

`operprogress` 动作的 `details` 逐条保留干员名、职业、培养结果与原因，以及该条的精英阶段、技能等级或专精目标；执行详情按干员展示这些条目，`deferredMastery` 列出没有回调的剩余专精目标，`deferredCount` 为其数量。`Completed` 在精英化与技能等级条目中表示目标已达成，在专精条目中只表示目标等级的专精训练已启动，训练完成仍需游戏内时间，展示时不能当作已完成。`switchtheme` 不产生逐条明细。

培养会读取 Core 汇总，部分培养失败不会仅因 CLI 正常退出而报告成功；缺少完整有效回调时 `observed: false`，仅确认进程已结束，游戏结果仍未确认。事件粒度取决于实际 Core 与资源组合，不能仅凭静态契约确认设备侧可用。

### 动态多任务与 variants

`taskConfig` 仍支持旧的单任务对象；需要按数组顺序执行多个任务时，改为 `{tasks:[...]}`。每项与单任务同形，并可使用 maa-cli 上游的 `strategy` 与 `variants`：

```bash
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: dynamic-tasks-01' \
  -d '{"command":"run","args":["daily"],"taskConfig":{"tasks":[
    {"name":"领取奖励","type":"Award","params":{"award":true}},
    {"name":"基建换班","type":"Infrast","params":{"mode":10000},"strategy":"merge","variants":[
      {"condition":{"type":"Time","start":"18:00:00","end":"04:00:00"},"params":{"plan_index":0}},
      {"condition":{"type":"Weekday","weekdays":["Mon","Thu"]},"params":{"plan_index":1}},
      {"params":{"plan_index":2}}
    ]}
  ]},"waitForCompletion":true}'
```

- `tasks` 为非空数组，数组顺序即执行顺序。每项必须提供 `name` 与 `type`，`params` 可省略；可选 `strategy` 为 `first`（默认）或 `merge`，`variants` 为上游变体数组。
- `condition` 是上游 `variants` 项的字段，只能写在 `variants[i].condition`；任务对象或 `tasks` 容器顶层出现 `condition`、未知字段或非法 `strategy` 都会在创建 Run 前返回 400。条件本身由 maa-cli 在每个任务开始时求值，La Pluma Next 只校验结构并透传。
- 每个任务使用独立临时任务文件执行，但整个数组共享同一执行租约。结果按索引归档到 `run.result.tasks[i]`，字段为 `index`（0 基）、`name`、`type`、`status`（`success`/`failed`/`stopped`/`pending`）、`message`、`stdout`、`stderr`；游戏任务项另带 `actions`。顶层 `run.result.actions` 按顺序汇总所有任务的游戏动作。
- 部分失败不会吞掉其它任务结果：某个任务失败后仍继续执行后续任务；全部结束后 Run 为 `failed`，错误码 `AGENT_DYNAMIC_TASKS_FAILED`，`error.details.taskIndexes` 给出失败任务索引，`error.details.tasks` 保留逐项结果（已成功、失败与未执行项）。为限制持久化的错误体积，`error.details.tasks[i].stdout`/`stderr` 每项截断到 4096 字符，并在被截断时带 `stdoutTruncated`/`stderrTruncated: true`；完整输出保留在同一次 Run 的 `result.tasks[i]`（后台执行经终态结果返回）。单任务失败仍沿用原有错误码（如 `AGENT_GAME_TASK_FAILED`）与结果字段。
- 停止以 Run 为目标并保持幂等：正在执行的任务收到设备停止并记为 `stopped`，后续任务不再启动并保持 `pending`；重复停止沿用 Run 层的 `stopping`/终态保护。`waitForCompletion=false` 时任务链在后台继续，202 只表示首个任务已启动，终态仍以 Run 为准。
- 变体条件全部不匹配的任务不会产生设备动作，maa-cli 正常退出时该项按成功结算。`variants` 与 `strategy` 只作用于动态任务通路，不改变 `fight`、`copilot` 等语义化动作的参数语义。
- `StartUp`、`Fight`、`CloseDown` 可以设置 `client_type`；maa-cli 会把 Run 顶层 `client_type`（任务 `params.client_type`，缺省取连接 profile）强制写回这三类任务，任务或 variant 里的不同取值只会得到警告并被覆盖。为避免静默覆盖，`params.client_type` 或 `variants[i].params.client_type` 与 Run 顶层值不一致时会在生成任务文件前返回 400 `AGENT_VALIDATION_TASK_CONFIG_INVALID`；只在 variant 里写 `client_type` 而任务 `params` 未声明时，预检无法确认连接 profile 的值，同样返回 400 并要求统一写在任务 `params.client_type`。取值必须是 `Official`/`Bilibili`/`Txwy`/`YoStarEN`/`YoStarJP`/`YoStarKR` 之一。
### 肉鸽与生息演算的高级参数

`roguelike` 与 `reclamation` 的 CLI 参数只覆盖 maa-cli 0.7.8 支持的子集。MaaCore 新增的主题、模式与参数使用 `command=run` 加 `taskConfig` 动态任务下发，与 `OperProgress`/`SwitchTheme` 走同一通路：

```bash
# 黑流树海刷开局：准备局培育襁褓猫，目标局期望未编号物与调查预付款
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -d '{"command":"run","args":["roguelike"],"taskConfig":{"name":"集成战略","type":"Roguelike","params":{"theme":"BlackFlow","mode":30003,"blackflow_start_animals":["swaddled_cat"],"blackflow_start_rewards":3,"roles":"稳扎稳打","stop_when_investment_full":true}},"waitForCompletion":false}'

# 生息演算重启锚点 RA-1（maa-cli 没有该主题）
curl -X POST http://localhost:3000/api/agent/actions/run-task \
  -H 'Content-Type: application/json' \
  -d '{"command":"run","args":["reclamation"],"taskConfig":{"name":"生息演算","type":"Reclamation","params":{"theme":"RelaunchAnchor","mode":16}},"waitForCompletion":false}'
```

- `Roguelike.params.theme` 可为 `Phantom`、`Mizuki`、`Sami`、`Sarkaz`、`JieGarden` 或 `BlackFlow`；`mode` 必须属于主题：通用 `0`/`1`/`4`/`6`/`7`，萨米额外 `5`（刷坍缩范式），萨卡兹额外 `10001`（快速通过第一层），界园额外 `20001`（刷常乐节点），黑流树海为 `0`/`1`/`30001`（刷襁褓动物）/`30003`（刷开局并保留目标局）。
- `mode=20001` 必填 `find_playTime_target`（`1` 令、`2` 黍、`3` 年）；`mode=30003` 必填 `blackflow_start_animals`（0 至 2 项，羽蛇最多一项）与 `blackflow_start_rewards`（0 至 4095 位掩码），启用 `blackflow_start_utopia` 时还需非空且不重复的 `blackflow_start_reward_priority`。
- `Reclamation.params.theme` 可为 `Tales` 或 `RelaunchAnchor`；沙洲遗闻模式为 `0`/`1`，重启锚点为 `16`（RA-1）/`32`（RA-15）/`48`（RA-4）。沙洲遗闻模式 `1` 必须显式提供非空的 `tools_to_craft` 工具名数组：MaaCore 的 `ReclamationCraftTaskPlugin` 直接读取该键，省略会让 MaaCore 抛出未捕获异常并中止 CLI；预检会在创建 Run 前返回 `AGENT_VALIDATION_TASK_CONFIG_INVALID`。`increment_mode` 只能是 `0`/`1`，`num_craft_batches` 必须是正整数（缺省由 Core 取 16），`clear_store` 是布尔值。
- CLI 通路在创建 Run 之前预检：主题、模式或加号点击方式超出 maa-cli 能力时返回 HTTP 400 `AGENT_VALIDATION_TASK_ARGS_INVALID`，并提示改用动态任务；沙洲遗闻模式 `1`（显式或 `-m` 缺省时）缺少 `--tools-to-craft` 同样返回 `AGENT_VALIDATION_TASK_ARGS_INVALID`，避免 maa-cli 用默认的 16 批荧光棒静默接管。动态任务参数非法返回 `AGENT_VALIDATION_TASK_CONFIG_INVALID`。两条通路都不会把非法组合静默透传给 CLI/Core。
- 肉鸽/生息演算执行在检查点建立后注册进度跟踪器：活动期从 `GET /api/agent/runs/current` 的 `run.progress.roguelike` 读取实时 `mode`、局数、当前局、结算支持、当前动作、最近 5 局与最近事件；观察到 `BlackFlow*` 回调时同一进度带 `blackflow`（楼层、当前节点、行动力、最近路由与节点完成、里程碑、策略结果），未观察到时为 `null`。终态最终快照写入 `run.result.summary.progress`，失败写入 `run.error.details.summary.progress`，`summary.observed` 与进度观察合并。目标局数优先取请求 `taskConfig.params.starts_count` 或 CLI `--starts-count`/`--start-count`，否则取 `StartExplore.max_times`；`2147483647`（无限）按未知处理。`settlementSupported=false` 表示该模式不提供结算数据，不能把 0 当作已结算；`null` 表示无法确定。

## 养成材料筹备队列与任务流程

`/training/*` 管理培养目标所需的材料筹备与刷关计划，不在游戏内执行精英化、技能升级或专精。游戏内培养使用上面的 `OperProgress` 动态任务。

添加目标和生成预览不会首次应用任务流程。先调用 `POST /api/agent/training/plan`（`mode` 为 `current` 或 `all`），再将返回的计划原样放入 `POST /api/agent/actions/apply-training-plan` 的 `plan` 字段。计划响应的 `summary` 携带计划判定所用的 `gameDate`、`clientType`、`todayOpenResourceStages` 与 `todayClosedResourceStages`；客户端应用时必须原样保留 `queueRevision`、`openStages` 与 `summary`。计划不落盘，服务端不保存计划版本，也没有持久化迁移。应用时先校验 `queueRevision`：队列已变化或缺少版本返回 HTTP `409`，消息与既有行为不变；随后按当前 profile 的客户端类型、当前游戏日和实时关卡开放状态重算计划打算应用的关卡。游戏日不一致、客户端类型不一致或任一打算应用的关卡当前关闭时返回 HTTP `409` `AGENT_TRAINING_PLAN_STALE`，`error.details` 为 `{ reason: 'game_day' | 'client_type' | 'stage_closed', gameDate, planGameDate, clientType, planClientType, closedStages }`，客户端需要重新预览。旧计划缺少 `summary` 时按 `openStages`/`stages` 重算，全部仍开放则允许应用；`openStages` 存在（包括空数组）即为权威，不回落 `stages`。上下文校验失败发生在任何 automation 配置、队列或定时写入之前，不创建 Run，也不影响已有 Run/cron。应用成功后服务端会按更新后的 automation 配置重新注册已存在的默认定时任务；响应中的可选 `scheduleSync` 为 `{ attempted, success, message, missingTimes? }`；`attempted: true, success: false` 表示配置与队列已应用但定时注册失败（包括只有部分时间点创建成功，`missingTimes` 列出未注册时间点），客户端应保留计划并给出重试入口。普通队列同步（`/training/sync` 或队列写入触发的自动同步）不会创建或重注册定时任务。

养成端点共用同一本地资源错误映射：依赖本地 MAA 游戏资源（`item_table.json` 或 `item_index.json`，路径解析见部署指南的 `MAA_DATA_DIR`/`MAA_RESOURCE_DIR`）的操作在资源缺失或损坏时返回 HTTP `503`，错误码为 `LOCAL_RESOURCE_MISSING` 或 `LOCAL_RESOURCE_INVALID`；`message` 提示先获取游戏资源或检查 MAA 资源目录，`error.details.resourcePath`（字段不符时另有 `details.field`）指出具体文件，补齐资源后重试即可。生成计划是当前主要触发路径；其它训练异常仍走统一 500 出口。可选材料快照、掉落数据等明确可降级的数据仍按既有策略继续（缺失时使用已有快照或经验估算），不阻断计划生成。

`GET /api/agent/training/operators` 返回 `operators`、`count` 与 `recognition`。`recognition.status` 为 `complete`（识别目录内每个干员的拥有状态已确认）、`partial`（存在未确认项）或 `missing`（尚未识别）；`total`/`owned`/`unknown` 为目录、已拥有与未确认数量，`missing` 列出未确认拥有状态的干员 id，`recognizedAt` 为识别快照时间。候选行的 `ownership` 为 `owned`、`unowned` 或 `unknown`；`unknown` 行以 `trainingStatus=unrecognized` 标记且不能加入队列。旧服务端载荷没有 `recognition` 时按未知处理，不得当作完整识别。

`GET /api/agent/training/queue` 返回队列 `revision`、`flowSync` 以及当前计划上下文 `gameDate`（`YYYY-MM-DD`）和 `clientType`。上下文由当前连接 profile 与游戏日历计算，不读取活动表；`clientType` 已按客户端服务区归一化。同步状态为 `not_applied`、`synced` 或 `failed`，并提供实际的 `flowName`、`taskName`。显式应用后，添加、移除和排序会按已应用的计划范围同步智能养成关卡；清空队列会移除智能关卡，保留普通关卡。

队列变更响应中的 `queueUpdated: true` 表示队列已保存。即使请求成功，仍须检查 `flowSync.status`：`failed` 表示任务流程尚未同步，可调用 `POST /api/agent/training/sync` 重试，无需重复添加或删除。添加接口支持从零开始的 `position`，用于原位恢复；排序接口要求 `operatorIds` 包含全部队列项且不能重复。
