# Query 缓存与键规范

> [← 返回文档索引](../README.md)

本文说明应用级 TanStack Query 基础设施：客户端与 Provider 的创建位置、默认重取/重试策略、领域 query key 约定、失效方式，以及它与 Zustand、配置草稿、执行控制器和 Dashboard 完整快照的边界。

当前统计、养成队列与候选/计数、设置连接与系统资源、作业搜索/预览、自动化活动与通知配置以及总览快照和设备采样均使用所属领域 Query；配置与执行写入仍由专门的命令所有者管理。资源请求的取消、信封与载荷校验契约见[资源请求错误与取消契约](resource-requests.md)，配置草稿与运行身份分别见[配置持久化协调器](config-persistence.md)与[前端执行客户端与控制器](execution-client.md)，作业搜索/预览的取消与选段语义见[作业搜索与预览](../frontend/domains/combat.md#搜索与预览)，总览快照与设备采样见[总览完整快照与设备采样](../frontend/domains/dashboard.md#完整快照与设备采样)。

## 1. 定位与边界

Query 缓存只保存**服务端只读资源**的最近一次成功结果，不拥有任何可写状态。

| 内容 | 唯一归属 | 与 Query 的关系 |
| --- | --- | --- |
| Query 客户端、默认策略、key 工厂与 Provider | `shared/query/`、`app/providers/` | 本文 |
| 各域资源的 query key、queryFn、启用条件与失效触发 | 资源所属 feature 或跨域微域 | 用 `defineQueryKeys` 创建 key，经域公开面导出 |
| 配置草稿、pending 标记、提交队列 | `features/user-config/` 协调器 | 不进入 Query；提交成功后再失效相关资源 |
| 运行身份、快照观察、停止与恢复 | `features/task-execution/` 控制器 | 不进入 Query；`runs/current`、`tasks/status` 不是普通资源 |
| 跨页客户端状态（主题、连接健康、运行投影、预览偏好、面板选择） | 对应 Zustand store 或域内状态 | 不复制 Query 数据 |
| Dashboard 完整业务快照 | Dashboard 刷新协调器 + `dashboardStore` | 可读取 Query，但只在完整快照通过校验后原子提交 |
| 实时日志、历史日志读取、WebRTC 信令等会话 | 对应会话所有者（日志见[实时日志流生命周期](../frontend/domains/logs.md#实时流生命周期)与[历史日志与清理协调](../frontend/domains/logs.md#历史会话与清理)） | 不因接入 Query 改变暂停/恢复、取消与选择裁决语义 |

关键约束：

- **同一服务端资源只有 Query 缓存一份可写真相。** 页面可以派生筛选、展开、选中项等 UI 状态，但不得把资源数据复制进 Zustand 或第二份组件状态后分别修改。
- **配置草稿不是资源缓存。** 编辑中的草稿属于 user-config 协调器；Query 中的服务端副本不参与草稿合并，提交成功后才由适配器或页面失效相关 key。
- **Query 不接管长任务。** 执行提交、停止、轮询观察和恢复仍归 task-execution 控制器；不要把 Run 快照放进 Query 缓存当作运行状态机。
- **写入不依靠 Query mutation 自动重试。** 默认 `mutations.retry = false`；配置与执行写入继续走既有协调器/控制器。

## 2. 应用级客户端与 Provider

| 入口 | 位置 | 行为 |
| --- | --- | --- |
| `getQueryClient()` | `shared/query/queryClient.ts` | 懒创建并复用应用级唯一客户端；页面、Activity 或 Provider 重建都不换客户端（缓存是否过期由 `staleTime`/`gcTime` 决定） |
| `createQueryClient()` | 同上 | 每次返回独立客户端；只用于测试或隔离环境 |
| `QueryProvider` | `app/providers/QueryProvider.tsx` | `QueryClientProvider` 注入应用级客户端 |
| `AppProviders` | `app/providers/AppProviders.tsx` | 在 `MotionConfig` 外组装 `QueryProvider`，整个应用只有一个 Provider |

规则：

- 页面、领域 hook 与微域**不得**自行 `new QueryClient()` 或嵌套 `QueryClientProvider`；需要测试隔离时使用 `createQueryClient()` 并显式注入测试树。
- 应用级 hook（执行观察、运行状态投影、后端探针）在 `AppShell`/`AppProviders` 内运行；后续接入 Query 时可直接使用客户端上下文，不得在 Provider 外的根组件调用 `useQuery`。
- 页面卸载、Activity 隐藏/恢复与浏览器刷新不调用 `queryClient.clear()`；缓存按 `gcTime` 自然回收，只有测试或明确的全局重置入口可以主动清空。
- 客户端内部使用 TanStack Query 的默认 query hash 与结构共享，不额外包装 key 序列化。

回归：`app/providers/QueryProvider.test.tsx` 验证 Provider 重建、页面 remount，以及 Activity 隐藏后观察者注销、新鲜数据直接复用、过期数据重取与超过 `gcTime` 后重新加载。

## 3. 默认查询策略

默认值在 `shared/query/queryClient.ts` 的 `queryDefaultOptions` 中集中定义，测试锁定这些数值：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `staleTime` | 30s | 新鲜期内 remount、Activity 恢复与重连不重复请求；过期不等于清空缓存 |
| `gcTime` | 5min | 最后一个观察者离开后保留缓存；Activity 隐藏会注销观察者并开始计时，隐藏超过该时长后缓存被回收 |
| `refetchOnMount` | `true` | 页面 remount 或 Activity 恢复后重新订阅时，过期数据后台重取；新鲜则直接使用缓存 |
| `refetchOnWindowFocus` | `false` | 文档重新可见时不自动重取；Activity 隐藏已清理观察者，恢复取数由 `refetchOnMount`/显式 refetch 负责 |
| `refetchOnReconnect` | `true` | 网络恢复时重取过期资源，并继续被暂停的读取 |
| `retry` | `shouldRetryQuery` | 最多 2 次重试（共 3 次尝试），只重试可恢复失败 |
| `retryDelay` | 500ms 指数退避 | 单次等待上限 4s |
| `networkMode` | `online` | 离线时暂停读取，恢复在线后继续 |
| `mutations.retry` | `false` | 写请求不自动重试 |

重试分类与[资源请求错误与取消契约](resource-requests.md)一致：

| 失败 | 是否重试 |
| --- | --- |
| `ApiRequestError.kind === 'transport'` | 是，且不超过次数上限 |
| `kind === 'api'` 且 `retryable === true` | 是，且不超过次数上限 |
| `kind === 'contract'` | 否；载荷或信封错误重试不会变好 |
| `kind === 'api'` 且 `retryable === false` | 否 |
| 非 `ApiRequestError` 的未知错误 | 否，避免掩盖程序错误 |
| `AbortError`（调用方取消） | 否；取消不记为失败，也不触发重试 |

说明：

- TanStack Query 5.104 的“窗口焦点”实际监听文档可见性（`visibilitychange`）；切换应用内 tab 不产生该事件。React 19.3 的 Activity 隐藏会清理 Effects（见[前端架构与所有权](../frontend/README.md)的 Activity 说明），Query 观察者随之注销，因此 `refetchOnWindowFocus: false` 只避免浏览器切回时自动重取仍挂载的查询，不能阻止 Activity 恢复后的按需重取。
- Activity 隐藏/恢复与页面卸载对 Query 订阅是等价的：隐藏清理观察者，缓存从最后一个观察者离开时开始按 `gcTime` 计时；显示后重新订阅。数据仍新鲜则直接用缓存，已过期则按 `refetchOnMount` 后台重取，已被回收则重新加载。
- 网络在线状态来自浏览器 `navigator.onLine`，不代表本地后端可用；后端健康仍由 runtime-status 监测。后端不可用表现为传输失败，由重试与页面错误边界处理。
- 需要更短或更长新鲜期的资源可在自己的 `useQuery` 中覆盖 `staleTime`，但必须在所属域说明理由；不得在页面里改动全局默认值。
- 轮询资源（例如设备采样）如果使用 Query，必须由所属域显式设置 `refetchInterval` 与可见性/暂停条件，不能依赖全局默认值产生后台轮询；实时日志等会话的生命周期由对应领域契约维护。
- 需要强制读取最新值的流程（例如 Dashboard 的强制刷新、计划生成前重读 queue）使用 `staleTime: 0` 的 `fetchQuery` 或显式 `refetch`，不能依赖默认 `staleTime`。

## 4. Query key 约定

所有资源 key 统一为：

```
[domain, resource, ...params]
```

| 段 | 含义 | 规则 |
| --- | --- | --- |
| `domain` | 资源所属域 | 与 feature/微域标识一致，是域级失效作用域；资源迁域时必须给出旧 key 兼容与失效范围 |
| `resource` | 域内资源名 | 稳定语义名（如 `depot`、`queue`、`version`），不用函数名、端点路径或页面名 |
| `params` | 影响响应内容的输入 | 按固定顺序展开；缺失值统一为 `null` 或省略，不能同时出现 `undefined` 与省略两种身份 |

域内用 `defineQueryKeys` 创建 key，不从调用点手写数组：

```ts
import { defineQueryKeys } from '@/shared/query'

// 键模块位于资源所属域，经该域 index.ts 导出。
export const statisticsKeys = defineQueryKeys('statistics')

statisticsKeys.all                      // ['statistics']：整域作用域
statisticsKeys.resource('drops')        // ['statistics', 'drops']：资源作用域
statisticsKeys.query('drops', 7)        // ['statistics', 'drops', 7]：具体缓存身份
```

key 中只放服务端资源身份：筛选/排序等会改变响应的输入放在 `params`，展开、选中、弹层、分页游标等纯 UI 状态不进入 Query key。`domain` 与 `resource` 必须唯一归属一个域；同名资源在两个域各建缓存属于两个真相，必须避免。

当前领域资源及其缓存身份如下。本文集中维护 key、参数与 Query 策略；领域契约维护业务规则，跨域写后失效映射见[资源所有权](resource-ownership.md)。未列覆盖项的资源沿用第 3 节默认值，不得为同一资源另起 key。

| 资源 / query 定义 | 完整缓存身份 | Query 覆盖或读取方式 |
| --- | --- | --- |
| 仓库 `depotQueryOptions()` | `['game-data','depot']` | 默认；保留 `null` 空快照 |
| 持有干员 `operBoxQueryOptions()` | `['game-data','operbox']` | 默认；保留 `null` 空快照；快照可带识别目录与 `recognition` 概要 |
| 干员目录 `operatorCatalogQueryOptions()` / `operatorCatalogWithSourceQueryOptions()` | `['game-data','catalog']` | 两者共用同一 key，缓存值为 `{ operators, source }`，`source` 为 `remote` 或 `snapshot`：`operatorCatalogQueryOptions()` 用 `select` 只取 `operators`（仅供 `useQuery` 观察者），`operatorCatalogWithSourceQueryOptions()` 返回完整 tagged 形状（需要区分远端或快照来源时使用，如统计页观察者与 training 的 `fetchQuery`）。远端目录读取失败或为空时回退到 operbox 快照的 `allOpers`：快照已在 Query 缓存中则直接取用，未命中才单次 `fetchQuery` 读取快照（`retry: false`）；远端失败且快照也为空时抛出远端错误，远端成功但为空且快照也为空时返回空列表（`source: 'snapshot'`） |
| 掉落 `dropStatisticsQueryOptions(days)` | `['statistics','drops',days]` | `placeholderData: keepPreviousData` |
| 今日掉落 `todayDropsQueryOptions()` | `['statistics','today-drops']` | 默认；总览协调读取时强制新鲜且不重试 |
| 今日开放关卡 `openTodayStagesQueryOptions()` | `['statistics','open-stages']` | 同上 |
| 队列 `trainingQueueQueryOptions()` | `['training','queue']` | 默认；计划所有者的权威重读使用 `staleTime: 0` |
| 候选 `trainingCandidatesQueryOptions(filters)` | `['training','candidates',status,rarity,needsElite2]` | `rarity` 缺省为 `null`，`needsElite2` 缺省为 `false`；载荷附带 `recognition` 概要，不进入 key |
| 计数 `trainingStatusCountsQueryOptions(filters)` | `['training','counts',rarity,needsElite2]` | 同上缺省值；`placeholderData: keepPreviousData`，`structuralSharing` 合并计数 |
| connection `connectionConfigQueryOptions(profileName)` | `['settings','maa-config',profileName]` | 默认；快照采用须通过 owner 的读取令牌 |
| 实例选项 `instanceOptionsQueryOptions(profileName)` | `['settings','maa-instance-options',profileName]` | 默认；面板不可见时 `enabled: false` |
| 资源源 `resourceSourceQueryOptions()` | `['settings','resource-source']` | 默认；面板不可见时 `enabled: false`；保存成功后主动重取同一 key |
| 版本 `versionQueryOptions()` | `['settings','version']` | 默认 |
| 配置目录 `configDirectoryQueryOptions()` | `['settings','config-directory']` | 默认；目录卡片是唯一观察者 |
| 普通搜索 `copilotSearchQueryOptions(request)` | `['combat','copilot-search',keyword,level,[included],[excluded],orderBy,page,limit]` | 显式搜索 `fetchQuery({ staleTime: 0 })`；默认请求在进入作战页时预取并缓存 5 分钟，打开发现时后台刷新 |
| 关卡目录 `copilotStageCatalogQueryOptions()` | `['combat','copilot-stages']` | 30 分钟 `staleTime`；发现弹窗打开时按需读取 |
| 悖论搜索 `paradoxSearchQueryOptions(name)` | `['combat','paradox-search',name]` | 同上 |
| 单作业 `copilotInfoQueryOptions(id)` | `['combat','copilot',id]` | 默认；强制预览读取 `staleTime: 0` |
| 作业集 `copilotSetQueryOptions(id)` | `['combat','copilot-set',id]` | 同上 |
| 作业集计划 `copilotSetPlanQueryOptions(id, raid)` | `['combat','copilot-set-plan',id,raid]` | 同上；重置进度后按 id 前缀失效 |
| 活动 `activityQueryOptions(clientType?)` | `['automation','activity',clientType ?? 'profile']` | 不传时由服务端连接 profile 解析，不硬编码 `Official`；目前只由总览完整快照消费 |
| schedule 投影 `scheduleExecutionQueryOptions()` | `['automation','schedule-execution']` | 供总览协调读取 |
| 通知配置 `notificationConfigQueryOptions()` | `['automation','notification-config']` | 默认 30s `staleTime`；`retry: false`；保存成功后由 `NotificationSettings` 用 `setQueryData` 写回同一 key |
| 完整快照 `dashboardSnapshotQueryOptions()` | `['dashboard','snapshot']` | `staleTime: 0`、`gcTime: 0`、`retry: false`；五路领域读取同样 `staleTime: 0`、`retry: false` |
| 设备采样 `deviceStatsQueryOptions()` + `useDeviceStatsSample` | `['device-mirror','device-stats']` | hook 设置 5s `refetchInterval`、`staleTime: 0`、`retry: false`、`refetchOnMount: 'always'` |
| 预览服务状态词汇 | `['device-mirror','webrtc-status']` | 保留资源 key，当前没有独立 Query 观察者 |

实时与历史日志由领域会话持有，不建立 Query key；WebRTC 信令、设备发现/连接测试、打开目录、配置草稿与执行命令同样不进入 Query。共享游戏数据的端点、载荷类型与 key 唯一归 `game-data`，training 的候选补齐与计数读取不另建同义缓存。

## 5. 失效方式

失效是写入成功后的显式动作，不由页面 remount 或 Activity 显示自动触发；Activity 显示可能按新鲜度重取数据，但不会把缓存标记为失效。

```ts
// 只失效一个资源的所有参数变体
await queryClient.invalidateQueries({ queryKey: statisticsKeys.resource('drops') })

// 仅当该域全部资源都受影响时使用域级作用域
await queryClient.invalidateQueries({ queryKey: statisticsKeys.all })
```

规则：

1. **精确优先。** 能定位到资源时用 `keys.resource(...)`，不要用 `keys.all` 或 `queryClient.clear()` 代替。
2. **写成功后失效。** 只有服务端写入确认成功才失效受影响 key；失败保留旧缓存，页面展示自己的错误。部分成功的域（如配置已保存、schedule 失败）只失效已确认的资源，并保留 pending 草稿。
3. **跨域影响由领域端口发布。** 识别、应用计划、资源更新等跨域影响由 `features/resource-invalidation` 的失效发布/接收端协调（见[共享资源归属与失效端口](resource-ownership.md)），Query 层不增加全局失效总线或页面间轮询。
4. **失效失败不阻塞写入。** `invalidateQueries` 的重取失败保留旧数据；页面需要区分“旧数据 + 重取失败”和“从未加载”。
5. **不写入部分快照。** 只有响应是权威完整资源时才允许 `setQueryData`；不做覆盖多个 key 的逐块乐观写入。唯一例外是养成队列命令在**写入已成功、写后刷新失败**时写入的本地 fallback：它不是服务端快照，必须携带 `uncertain` 标记与已知 revision，下次权威读取会清除标记（见[养成队列命令与写后刷新](../frontend/domains/training.md#队列命令)）。

## 6. Activity、重连与生命周期

| 事件 | Query 行为 | 页面责任 |
| --- | --- | --- |
| Activity 隐藏 | 清理 Effects，Query 观察者注销；缓存保留并从最后一个观察者离开时开始按 `gcTime` 计时。若 queryFn 使用了 `signal`，最后一个观察者离开时在途读取被取消并保留上一份数据 | 不得假设隐藏期间观察者仍存活或缓存一定保留；需要跨隐藏持续观察的资源由应用级所有者持有 |
| Activity 显示 | 重新订阅；数据仍新鲜则直接用缓存，已过期则按 `refetchOnMount` 后台重取，已被 `gcTime` 回收则重新加载 | 需要最新快照时显式 `refetch`；不能依赖隐藏期间的观察者 |
| 浏览器文档隐藏/可见 | `refetchOnWindowFocus: false`，不自动重取 | 实时会话按既有可见性规则暂停/恢复 |
| 页面真正卸载后重挂载 | 观察者注销，缓存保留到 `gcTime`；新鲜则直接用缓存，过期则后台重取，已回收则重新加载 | 不得在 effect cleanup 清空 queryClient 或删除其他页面的 key |
| 浏览器刷新 | 内存缓存丢失；Dashboard 持久化快照仍按自身规则恢复 | 首屏骨架与旧数据展示保持各页现有行为 |
| 网络离线/恢复 | 离线读取暂停；恢复后重取过期资源 | 连接健康仍由 runtime-status 展示，不从 Query 状态推断任务完成 |
| 调用方取消 | `AbortError` 不重试、不记为失败 | 页面只在真正失败时展示错误 |

Activity 隐藏/显示与页面卸载都不改变资源所有权；Query 缓存按 key 共享，但观察者随 Effect 清理而注销。使用 Query 的 `signal` 读取在最后一个观察者离开时会被取消（Query 以 revert 方式保留上一份数据）；未使用 signal 的请求可能继续完成并写入缓存。接入契约要求 `queryFn` 传递 `signal`，因此应按“隐藏/卸载即取消本地读取、旧数据保留”设计。显式 `cancelQueries` 用于切换资源或放弃缓存写入，不作为 Activity 生命周期的替代。

## 7. 聚合快照边界

Dashboard 通过领域 Query 取得五路业务资源，由刷新协调器校验并原子提交 `dashboardStore`；禁止五个 `useQuery` 分别写 store。`dashboard/snapshot` 只用于协调读取，设备采样独立。完整提交条件、失败保旧、单飞与恢复行为统一见[总览完整快照与设备采样](../frontend/domains/dashboard.md#完整快照与设备采样)，Query 覆盖值见第 4 节。

## 8. 新增资源的接入规范

新增资源读取时：

```ts
const result = await readApiData<DepotPayload>('/api/agent/data/depot', {
  signal,
  validate: isDepotPayload,
})
// queryFn 返回 result.data；失败抛出 ApiRequestError，取消保持 AbortError
```

或保留旧端点函数：

```ts
queryFn: async ({ signal }) => unwrapApiResponse(await getDepotData(signal))
```

- `queryFn` 必须把 Query 的 `signal` 传到 `fetch`，不能只丢弃响应；取消、失败分类与载荷校验沿用[资源请求错误与取消契约](resource-requests.md)。
- 接入 Query 后由 Query 的 signal、取消与 revert 裁决请求竞态，不要在页面另建一套 request id/generation guard；迁移既有读取时须先有竞态与取消回归。
- `enabled` 只表达“当前是否应读取该资源”（例如依赖参数或可见性），不用它替代权限、写入协调或运行状态。
- 配置提交与执行命令继续使用 user-config 协调器和 task-execution 控制器，不新增 Query mutation 作为第二写入路径。
- 新增或调整资源时须覆盖：同 key 共享缓存、失效范围、失败保留旧数据、Activity 隐藏/恢复与真正 remount 的回归。

## 9. 数据统计读取

统计页四路读取的并行启用、错误边界、掉落周期切换与筛选状态由[统计页面与面板](../frontend/domains/statistics.md#页面与面板)维护；识别快照写入与命令生命周期见该文的[识别命令](../frontend/domains/statistics.md#识别命令)。缓存身份与覆盖策略统一见第 4 节。

## 10. 养成候选与状态计数

候选补齐、计数来源、失败展示与筛选竞态由[养成页面与面板](../frontend/domains/training.md#页面与面板)维护；队列写入、`uncertain` fallback 与计划门禁见该文的[队列命令](../frontend/domains/training.md#队列命令)和[设置与计划有效期](../frontend/domains/training.md#设置与计划有效期)。缓存身份、参数默认值与覆盖策略统一见第 4 节，跨域失效映射见[资源所有权](resource-ownership.md)。

## 11. 领域消费边界

| 消费领域 | 本文之外的权威契约 |
| --- | --- |
| 设置 connection | [设置配置编辑与保存](../frontend/domains/settings.md#配置编辑与保存)：快照采用令牌、草稿、保存、重置与 section 生命周期 |
| 设置版本与目录 | [设置设备连接与系统资源](../frontend/domains/settings.md#设备连接与系统资源)：载荷归一、失败展示、配置目录唯一观察者是目录卡片（`settings/config-directory`）与设备命令 |
| 设置更新 | [设置组件更新与自动更新](../frontend/domains/settings.md#组件更新与自动更新)：显式命令、互斥与成功确认；失效映射见[资源所有权](resource-ownership.md) |
| 作业搜索与预览 | [作业搜索与预览](../frontend/domains/combat.md#搜索与预览)：计划优先、成员回退、会话取消、选段与终态刷新；预览不新建 key |
| 总览与设备采样 | [总览完整快照与设备采样](../frontend/domains/dashboard.md#完整快照与设备采样)：完整提交、失败保旧、刷新协调与设备样本投影 |

活动 key 与 Query 覆盖值统一见第 4 节；Read 与失败处理见[总览完整快照与设备采样](../frontend/domains/dashboard.md#完整快照与设备采样)。通知配置读取使用 `notificationConfigQueryOptions()`，保存成功后用 `setQueryData` 写回同一 key，不建立模块级快照。

## 12. 本层回归入口

| 文件 | 覆盖 |
| --- | --- |
| `apps/web/src/shared/query/queryClient.test.ts` | 默认 staleTime/gcTime/重取/网络模式、重试分类与上限、退避、写请求不重试 |
| `apps/web/src/shared/query/queryKeys.test.ts` | `[domain, resource, ...params]` 形状、同域 key 结构一致 |
| `apps/web/src/app/providers/QueryProvider.test.tsx` | Provider 重建保留同一缓存、同 key 单次请求与共享缓存、页面卸载/重挂载；Activity 隐藏后观察者注销、新鲜数据复用、超过 staleTime 重取、超过 gcTime 回收后重新加载；文档焦点不重取、重连重取过期资源 |
| `apps/web/src/app/App.test.tsx` | Activity 保活、隐藏工作区错误边界与恢复 |
| `apps/web/src/features/automation/components/NotificationSettings.test.tsx` | 通知配置 Query 读取与失败、保存成功后 `setQueryData` 回写、测试通知命令与会话清理 |

基础设施的针对性复现命令（仓库根目录）：

```sh
pnpm --filter la-pluma-next-client exec vitest run \
  src/shared/query \
  src/app/providers/QueryProvider.test.tsx \
  src/app/App.test.tsx
```

领域 Query、页面接线、命令与会话回归由第 9–11 节链接的领域契约维护；跨域失效测试见[资源所有权](resource-ownership.md)。完整检查使用 `pnpm verify`，浏览器与视觉检查范围见[开发指南](../development/README.md)。

## 关联

- [资源请求错误与取消契约](resource-requests.md)：signal、失败分类与载荷校验。
- [养成队列命令与写后刷新](../frontend/domains/training.md#队列命令)：队列唯一可写真相、串行命令、写后刷新与不确定 fallback。
- [配置持久化协调器](config-persistence.md)：草稿、pending 与完整提交。
- [前端执行客户端与控制器](execution-client.md)：Run 身份、观察与停止。
