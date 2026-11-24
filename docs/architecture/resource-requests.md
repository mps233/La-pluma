# 资源请求错误与取消契约

> [← 返回文档索引](../README.md)

本文说明 `apps/web/src/shared/api/` 的只读资源请求底座，以及各领域只读 API 如何把 `AbortSignal` 传到 `fetch`、校验响应载荷并把失败归类。请求必须支持真实取消与失败分类，领域 Query 才能正确裁决竞态、重试与错误展示。

## 1. 定位与边界

| 能力 | 归属 | 不负责 |
| --- | --- | --- |
| `AbortSignal` → `fetch`、失败分类、领域载荷校验 | `shared/api/readApi.ts` | 业务端点、缓存键、重取策略 |
| 端点路径、查询参数、领域载荷结构 | `features/<domain>/api/` | 页面生命周期、Query 缓存 |
| 响应信封解析、旧格式兼容 | `shared/api/apiResponse.ts` | 只读请求的失败归类 |
| Query 缓存、失效、重试 | [Query 缓存与键规范](query-cache.md) | 本契约不引入 Query |

本契约只覆盖**只读资源读取**：`GET` 端点，以及返回资源快照的读取函数。执行命令、停止、配置提交、通知配置保存、截图等 `POST`/`PUT`/`DELETE` 不在范围内。运行快照（`runs/current`、按 `runId` 查询）由执行控制器观察，`tasks/status` 由 runtime-status 健康探针读取；它们各有 signal 与观察处理，不按普通资源迁移。

## 2. 两层入口

```ts
// 新消费者（Query 迁移）：成功返回数据，失败抛类型化错误，取消抛 AbortError
const { data } = await readApiData<DepotPayload>('/api/agent/data/depot', {
  signal,
  validate: isDepotPayload,
})

// 旧消费者兼容：返回既有 ApiResponse 形状，失败带 errorInfo.kind/code
const result = await getDepotData(signal)

// 把旧信封还原成类型化错误
const depot = unwrapApiResponse(result)
```

| 入口 | 成功 | 失败 | 取消 |
| --- | --- | --- | --- |
| `readApiData` | `{ data, message?, meta? }` | 抛出 `ApiRequestError`（`kind`/`code`/`status`/`retryable`） | 抛出原始 `AbortError` |
| `readApiResponse` | `{ success: true, data, message?, meta? }` | `{ success: false, message, errorInfo }` | 抛出原始 `AbortError` |
| `unwrapApiResponse` | 返回 `data` | 抛出 `ApiRequestError` | 不适用（已是结果） |

`ApiRequestError` 与 `AbortError` 是两件事：前者表示请求失败，后者表示调用方主动放弃本次读取。页面和 Query 都应先判断取消，再展示错误。

## 3. 失败分类

| `errorInfo.kind` | 触发条件 | `code` | `retryable` |
| --- | --- | --- | --- |
| `api` | 非 2xx 响应；或 2xx 且信封 `success=false` | 服务端 `error.code`；无结构化错误码时用 `HTTP_<status>` | 服务端 `retryable`；非 2xx 缺省按 `status >= 500` |
| `contract` | 2xx 但不是 JSON 信封、空响应、坏 JSON，或领域校验拒绝载荷 | `INVALID_API_RESPONSE` / `EMPTY_API_RESPONSE` / `INVALID_DOMAIN_PAYLOAD` | `false` |
| `transport` | 请求没有拿到 HTTP 响应（断网、连接失败、响应体读取失败） | `NETWORK_ERROR` | `true` |
| 取消 | `signal.aborted` / `fetch` 抛出 `AbortError` | 不产生 `errorInfo` | 不适用 |

关键规则：

- **错误响应当失败，不当成功数据。** 2xx 但 `success=false` 的响应不会进入 `data`；部分路由把服务层错误信封包进 `success=true` 时，领域校验会把它识别为 `INVALID_DOMAIN_PAYLOAD`。
- **`success=true` 但 HTTP 非 2xx 仍是失败。** HTTP 状态优先，避免代理或网关的 5xx 页面配错信封时被当成成功。
- **载荷校验属于领域。** 每个端点只校验本域必需字段，允许既有空值和旧形状（如仓库/设备状态 `null`、配置目录字符串或 `{ path }`、今日掉落的记录数组、缺少 `dailyTrend` 的掉落统计），但不接受明显错误的类型。
- **取消不展示为失败。** `readApiData` 与 `readApiResponse` 都把 `AbortError` 原样抛出；`fetchWithAuth` 也不能把取消改写成“无法连接后端服务”。

## 4. 取消、停止与撤销

| 操作 | 是否调用服务端 | 是否改变后台状态 | 入口 |
| --- | --- | --- | --- |
| 取消读取 | 否；只放弃本地 HTTP 响应 | 否 | `AbortController.abort()` / Query 的 `signal` |
| 停止后台运行 | 是，`POST /agent/actions/stop?runId=…` | 记录停止意图并停止设备任务 | `stopTrackedRun()` |
| 取消本地观察 | 否；停止轮询和定时器 | 否，保留快照 | `abortObservation()` |
| 撤销 mutation | 当前协议没有提供 | 否；abort 只放弃本地响应，服务端可能已提交 | 需要显式补偿或重试，不依赖 signal |

因此：

- 读取的 `signal` 不得接到停止端点，也不得用于判断服务端是否仍在执行。
- 页面隐藏或 `Activity` 清理只取消本地读取，不调用 `stopTrackedRun()`。
- 提交请求的 `AbortSignal` 只表示调用方不再等待响应，不表示撤销已经发出的写入。

## 5. 候选只读端点

以下端点已接入 signal 传递和领域载荷校验。所有函数保留原来的位置参数，只在末尾追加 `signal?: AbortSignal`，因此旧调用无需修改。

### Game data（`features/game-data/api/index.ts`）

仓库、持有干员与干员目录是 training/statistics 共享的服务端读取，由 `features/game-data` 唯一持有。物品图标与干员头像不是端点：`getItemIconUrl` / `getOperatorAvatarUrl` 只生成同源 `/game-assets` URL，由浏览器缓存，不进入 Query；URL 带 `?v=<图标缓存 epoch>`，资源更新成功后推进 epoch 以避开旧图片缓存。

图片由服务端读取本地 MAA 资源：物品图标来自 `template/items/`，文件按**物品 id** 命名（`<itemId>.png`）；干员头像来自 `template/avatar/`，按**干员 id** 命名（`<operatorId>.png`）。变体头像以 `_1`、`_2` 后缀命名，但 MAA 标准资源只提供基础头像，变体需由 `LA_PLUMA_GAME_ASSET_DIR` 指向的自定义目录提供。`getItemIconUrl` 的物品键使用物品 id；服务端同时接受 `item_table.json` 的 `iconId`（如 `GOLD`），并与物品 id 双向解析（大小写不敏感、重复 iconId 逐个尝试），因此沿用 iconId 的旧调用与按 iconId 命名的图片目录也能命中。本地 `item_table.json` 缺失或不可解析时改用 `item_index.json` 的 `icon` 文件名建立同样的映射（MAA 默认资源只带该文件）；两类元数据都不可用时只按文件名直连，未知键返回空 404，客户端隐藏该图并显示占位。`LA_PLUMA_GAME_ASSET_DIR` 可指向含 `item/`、`avatar/` 的自定义目录，文件名规则相同。

| 函数 | 端点 | 载荷校验 |
| --- | --- | --- |
| `getDepotData(signal?)` | `GET /agent/data/depot` | `null` 或 `items` 数组 |
| `getOperBoxData(signal?)` | `GET /agent/data/operbox` | `null` 或 `data` 数组；`allOpers`、`operTotal`、`recognition` 为可选附加字段 |
| `getAllOperators(signal?)` | `GET /agent/data/operators` | 数组 |
| `getItemIconUrl(key, version?)` | 无请求 | 只拼 URL、编码物品键（物品 id）并附加图标缓存 epoch |

### Statistics（`features/statistics/api/index.ts`）

| 函数 | 端点 | 载荷校验 |
| --- | --- | --- |
| `getTodayDrops(signal?)` | `GET /agent/drops/today` | 日记录对象（`records` 数组 + `summary` 对象）或旧版记录数组；拒绝业务错误信封 |
| `getDropStatistics(days?, signal?)` | `GET /agent/drops/statistics?days=` | `total` 必须为对象且必含 `sanity`/`battles`/`medicine`/`stone` 四个数值；`items` 必须为对象；`stages` 必须为对象且每项必含数值 `battles` 与对象 `items`；`dailyTrend` 为可选数组；拒绝业务错误信封 |
| `getOpenTodayStages(signal?)` | `GET /agent/stages/open-today` | `open`/`closed` 数组 |

识别解析命令 `parseDepotData(signal?)` / `parseOperBoxData(signal?)` 仍是只写命令，留在 statistics；启动、等待日志可解析、超时与取消由[统计识别命令与失效联动](../frontend/domains/statistics.md#识别命令)的命令所有者接线。取消只结束本地等待，不撤销服务端解析。

### Training（`features/training/api/index.ts`）

| 函数 | 端点 | 载荷校验 |
| --- | --- | --- |
| `getOperatorList(filters?, signal?)` | `GET /agent/training/operators` | `operators` 数组，或旧版顶层数组；`recognition` 概要可选 |
| `getTrainingQueue(signal?)` | `GET /agent/training/queue` | `queue` 数组 |
| `fetchOperatorMaterials(signal?)` | `POST /agent/actions/fetch-training-materials` | 脚本摘要对象；`signal` 只结束本地等待，不占设备租约 |

### Automation（`features/automation/api/index.ts`）

| 函数 | 端点 | 载荷校验 |
| --- | --- | --- |
| `getActivity(clientType?, signal?)` | `GET /agent/activity`（省略 clientType 时不带查询串） | 活动 DTO：`status`/`clientType`/`available`/`message`、可空 `code`/`name`/`source`/时间戳、`stages`、`failure` 与可选 `completion` |
| `getScheduleExecutionStatus(signal?)` | `GET /agent/schedules/execution` | 对象 |

### Settings（`features/settings/api/index.ts`）

| 函数 | 端点 | 载荷校验 |
| --- | --- | --- |
| `getVersion(signal?)` | `GET /agent/version` | `cli`/`core`/`raw` 为字符串；服务端另返回 `updateChannels`（`{ core, cli }`），旧服务端可能缺失，不参与载荷校验 |
| `getConfigDir(signal?)` | `GET /agent/config-directory` | 非空字符串或含非空 `path` 的对象；返回类型 `string \| { path: string }` |
| `getConfig(profileName?, signal?)` | `GET /agent/config/maa/:profileName` | `{ connection, instance_options }`：`connection` 为对象且已知字段出现时为正确类型（`adb_path`/`address`/`config` 字符串，`auto_reconnect` 布尔），`instance_options` 出现时为对象；兼容旧版直接返回 connection 段的扁平载荷；缺失字段允许；`preset` 不在客户端校验范围内，由服务端读取时归一、保存时校验 |
| `getResourceSource(signal?)` | `GET /agent/config/resource-source` | `{ autoUpdate, warnOnUpdateFailure, source, git, mirrorchyan }`：布尔开关、`source` 为 `git`/`mirrorchyan`、两个来源为对象 |
| `discoverDevices(adbPath, signal?)` | `GET /agent/actions/discover-devices` | 对象（保留内层 `success=false` 的设备发现结果） |
| `testConnection(adbPath?, address?, signal?)` | `POST /agent/actions/test-connection` | 命令；由调用方归一 `success`/`message`，不进入 Query |

设备发现与连接测试虽然带 `signal`，都是有副作用的显式命令：目前由设置域 `DeviceConnectionOwner` 持有，不建立 Query，也不自动重试。打开配置目录是 POST 命令，不接收 `signal`，不进入 Query。版本与配置目录读取由 `settings/version`、`settings/config-directory` Query 消费。

### Logs（`features/logs/api/index.ts`）

| 函数 | 端点 | 载荷校验 |
| --- | --- | --- |
| `getRealtimeLogs(lines?, signal?)` | `GET /agent/logs/recent` | 数组 |
| `getLogFiles(signal?)` | `GET /agent/logs/files` | 数组 |
| `readLogFile(filePath, lines?, signal?)` | `GET /agent/logs/files/:path` | `content` 为字符串 |

目前实时轮询由 `features/logs/model/realtimeLogStream.ts` 持有，`getRealtimeLogs` 的函数签名、端点与返回形状不变；缓冲是最近行快照而非 Query 资源。目前历史文件列表与读取由 `features/logs/model/historyLogSession.ts` 持有：列表与读取各自使用请求序号与 `AbortSignal`，切换选择、返回实时、Activity 隐藏/卸载都会取消旧请求；历史读取仍不进入 Query，协议也没有 cursor。历史清理请求传递可选 `signal`，页面卸载时只取消本地等待，服务端已收到的删除不会被撤销；日志页的清屏只改变实时流的本地可见边界，不调用服务端共享缓冲清空接口。完整生命周期见[实时日志流生命周期](../frontend/domains/logs.md#实时流生命周期)与[历史日志与清理协调](../frontend/domains/logs.md#历史会话与清理)。

### Combat（`features/combat/api/index.ts`）

| 函数 | 端点 | 载荷校验 |
| --- | --- | --- |
| `searchCopilot(request, signal?)` | `GET /agent/copilot/search` | `copilots` 数组；请求含 `keyword`/`level`/`includedOperators`/`excludedOperators`/`orderBy`/`page`/`limit`，映射为 `document`/`level`/`operator`（`~` 前缀排除）/`orderBy`/`page`/`limit` |
| `getCopilotStages(signal?)` | `GET /agent/copilot/stages` | `data` 数组；关卡目录条目 |
| `searchParadoxCopilot(operatorName, signal?)` | `GET /agent/paradox/search` | `copilots` 数组 |
| `getCopilotInfo(copilotId, signal?)` | `GET /agent/copilots/:id` | PRTS 代理对象；服务端按资源追加 `stage`/`stageId` 展示关卡投影 |
| `getCopilotSet(copilotId, signal?)` | `GET /agent/copilot-sets/:id` | PRTS 代理对象 |
| `getCopilotSetPlan(copilotId, raid?, signal?)` | `GET /agent/copilot-sets/:id/plan` | `items`/`entries` 数组 |

目前这些读取由 `combat` 域 Query 消费，页面不再保留独立的 preview/search request id；所有 `queryFn` 都把 Query 的 `signal` 传到上述函数，切换输入或 Activity 隐藏时真正取消 fetch。计划优先、成员回退、旧响应裁决与选段语义见[作业搜索与预览](../frontend/domains/combat.md#搜索与预览)。

### Device mirror（`features/device-mirror/api/index.ts`）

| 函数 | 端点 | 载荷校验 |
| --- | --- | --- |
| `getWebrtcStatus(signal?)` | `GET /agent/webrtc/status` | 对象 |
| `getDeviceStats(address?, signal?)` | `GET /agent/device-stats` | `null` 或对象 |

未纳入的读取：

- 运行快照与按 `runId` 查询归执行控制器，`tasks/status` 归健康探针读取；已有 signal，不建立 Query 缓存。
- `loadUserConfig` / `saveUserConfig`：配置协调器通道已有 signal 与适配器 `decodeDraft` 校验，配置草稿也不是普通资源缓存。
- 所有 `POST`/`PUT`/`DELETE` 命令与截图：不属于只读资源。

通知配置是 automation 域的只读资源：`features/automation/components/NotificationSettings.tsx` 读取 `automation/notification-config` Query；组件只保留编辑草稿，保存成功后用 `setQueryData` 回写同一 key。测试通知仍是显式命令，不与 task flow/schedule 配置作为同一提交单元。

## 6. 旧消费者兼容

- `parseJsonResponse` 保持宽松：合法 JSON 即使不是 Agent 信封也会原样返回，operator-quotes、PRTS 代理等旧消费者不受影响。严格信封/载荷判断只在新只读入口中做。
- 候选端点的函数名、位置参数和 `ApiResponse` 返回形状不变；`errorInfo.kind`/`status` 是新增字段，旧页面只读 `success`/`message`/`error`/`data` 时行为不变。
- 把 `getDepotData`/`getOperBoxData`/`getAllOperators` 的归属迁到 `features/game-data`，函数签名、端点与载荷校验不变；仓库内消费者全部改为经该域公开面导入后，statistics/training 不再转发这些函数。图标 helper 同域持有，借助缓存 epoch 与订阅 hook 触发图片重新加载，不建立 Query key 或额外数据请求。
- `fetchWithAuth` 现在按结构判断 `AbortError`，不再要求 `instanceof Error`。这修复了 `DOMException` 被改写成连接失败的问题；非取消路径不变。
- 配置 key/格式、执行协议与存储保持兼容；取消与领域校验是读取端的维护要求。

## 7. 领域 Query 接入要求

已实现应用级 Query 客户端、默认策略与 key 工厂，具体约定见[Query 缓存与键规范](query-cache.md)。新增资源按以下方式接入：

1. `queryFn: ({ signal }) => readApiData(...)`，或在保留旧端点函数时 `unwrapApiResponse(await getX(signal))`。
2. 只对 `kind === 'transport'` 或 `kind === 'api' && retryable` 的失败启用自动重试；`contract` 失败不重试，`AbortError` 不计入失败。
3. 既有页面的 request id / generation guard 仅在接入 Query 之前保留，但 Query 的 `signal` 必须真正取消网络，不能只丢弃响应。
4. 失效与重取策略由[共享资源归属与失效端口](resource-ownership.md)约束，不在传输层增加跨域失效。

## 8. 回归证据

| 文件 | 覆盖 |
| --- | --- |
| `apps/web/src/shared/api/readApi.test.ts` | signal 传到 fetch、`success=false`、坏载荷、非信封 JSON、2xx 以外状态、`HTTP_502` 描述、取消保持 `AbortError`、已取消不请求、传输失败分类、旧信封形状、`unwrapApiResponse` |
| `apps/web/src/shared/api/client.test.ts` | 离线/后端不可用文案；`DOMException` 取消不被改写 |
| `apps/web/src/shared/api/apiResponse.test.ts` | 空响应、非 JSON、结构化 Agent 错误；非信封原始载荷保持原样 |
| `apps/web/src/features/game-data/api/index.test.ts` | 仓库/持有干员/目录 signal、旧空值、坏载荷、取消；图标 URL 编码、携带 epoch 且不发请求 |
| `apps/web/src/features/statistics/api/index.test.ts` | 掉落/开放关卡 signal、空值与坏载荷、路由误包错误信封、取消不追加停止请求 |
| `apps/web/src/features/training/api/index.test.ts` | 候选列表信号与旧数组形状、队列坏载荷、revision/flowSync 保留 |
| `apps/web/src/features/automation/api/index.test.ts` | 活动与调度状态 signal、坏载荷、服务端失败码、既有执行参数与幂等键 |
| `apps/web/src/features/settings/api/index.test.ts` | 版本/配置目录/配置/设备发现 signal、旧字符串目录、空目录拒绝、connection 已知字段校验、缺失字段与未知字段保留 |
| `apps/web/src/features/logs/api/index.test.ts` | 实时轮询 signal、文件列表与内容 signal、坏内容、取消保持 `AbortError` |
| `apps/web/src/features/combat/api/index.test.ts` | 搜索/详情/计划 signal、PRTS 代理对象、坏计划载荷、404 错误码 |
| `apps/web/src/features/device-mirror/api/index.test.ts` | WebRTC 状态 signal 与坏载荷、设备状态 signal 与 `null` 保留、既有组合启动 |

运行上述对应测试可验证传输层取消、错误分类与领域载荷校验；Query 生命周期、领域会话和命令接线的回归由各自契约维护。
