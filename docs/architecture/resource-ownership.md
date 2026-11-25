# 共享资源归属与失效端口

> [← 返回文档索引](../README.md)

本文说明共享资源归属与跨域失效端口。它说明仓库、持有干员与干员目录的唯一所有者，以及 training / statistics 的依赖方向、写后失效作用域与各页面的刷新方式。

相关契约：[资源请求错误与取消契约](resource-requests.md)、[Query 缓存与键规范](query-cache.md)、[配置持久化协调器](config-persistence.md)。

## 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 仓库、持有干员、干员目录的只读端点、载荷类型与 query key | `features/game-data` | 非页面微域；`shared/api` 不新增业务端点 |
| 物品图标/干员头像 URL 与缓存版本 | `features/game-data` | 纯 URL 构造，不发起请求、不进入 Query；epoch 持久化在 localStorage，资源更新成功后推进 |
| 跨域资源失效发布/订阅 | `features/resource-invalidation` | 只传资源作用域，不持有资源数据 |
| 养成队列、设置、计划、材料刷新端点 | `features/training` | 队列/设置/计划的写入与领域语义仍归 training；材料刷新的命令编排归 statistics |
| 掉落统计、今日掉落、今日开放关卡、识别/材料命令所有者 | `features/statistics` | 只读掉落/关卡供 Dashboard 使用；统计页使用领域 Query，识别/材料命令所有者及失效范围见[统计识别命令与失效联动](../frontend/domains/statistics.md#识别命令) |
| 设备采样 | `features/device-mirror` | `device-stats` 只读轮询资源；总览只订阅样本并写入自己的投影 |
| 预览会话、截图采样与基础设施操作 | `features/device-mirror` 的 `PreviewSessionProvider` | 应用级单例，位于页面 `Activity` 之外；页面只绑定/解除视频，总览只投影同一状态源；不进入 Query |
| Query 客户端、默认策略 | `shared/query` | 见 [Query 缓存与键规范](query-cache.md) |

关键约束：

- **一个共享资源只有一份 API/类型/key 归属。** 页面不得各自声明同义端点或手写 key 数组。
- **共享资源域不是通用后端层。** `game-data` 只收跨页面共享的读取；掉落、开放关卡、队列与计划仍归各自领域。
- **失效端口不是 Query 总线。** 它不保存资源、不自动重取，也不向 `shared/query` 增加全局失效机制；订阅者自行决定刷新或失效范围。
- **不在 Query 与页面状态中维护同一资源的双份可写真相。** 统计页由 Query 持有唯一缓存；training 的队列、候选列表与状态计数由领域 Query 与串行命令持有，设置由 `features/training/model/settingsCommands.ts` 的模块级所有者持有，计划生成/应用/同步由 `features/training/model/planCommands.ts` 的模块级所有者持有；Dashboard 的完整快照归 `features/dashboard/model` 的协调器与纯模型，五路资源各自保留领域 Query，`dashboardStore` 仍是展示与持久化投影；设备采样由 `device-mirror` 的 Query 与轮询 hook 持有，总览只做投影。

## 2. 资源与缓存策略

`game-data` 的 public surface：

```ts
import {
  depotQueryOptions,
  gameDataKeys,
  getAllOperators,
  getDepotData,
  getItemIconUrl,
  getOperBoxData,
  operBoxQueryOptions,
  operatorCatalogQueryOptions,
} from '@/features/game-data'
```

| 资源 | 唯一所有者 | 当前读取方 |
| --- | --- | --- |
| 仓库、持有干员、干员目录 | `game-data` | StatisticsWorkspace、TrainingWorkspace；识别后影响养成与总览 |
| 物品图标/干员头像 URL 与 epoch | `game-data` | 仓库、掉落记录、养成材料；不建立 Query |
| 养成队列（含材料进度） | `training` | TrainingWorkspace、Dashboard 快照 |
| 掉落/今日开放关卡 | `statistics` | StatisticsWorkspace、Dashboard 快照 |
| 设备采样 | `device-mirror` | Dashboard |
| 预览会话、transport 与截图采样 | `device-mirror` 的 `PreviewSessionProvider` / `usePreviewSessionOwner` / `usePreviewSnapshotOwner` | 七个共享画面的页面经 `usePreviewSession` 绑定视频；Dashboard 经同一会话投影状态 |

Query key、参数与缓存策略集中见[Query 缓存与键规范](query-cache.md)。物品图标与干员头像由浏览器 HTTP/图片缓存；`getItemIconUrl` / `getOperatorAvatarUrl` 带 `?v=<epoch>`，epoch 存储在 `laPlumaItemIconVersion`，使用 `useItemIconCacheVersion()` 的组件随 epoch 重渲染。

统计页的仓库、持有干员、目录与掉落读取由所属领域 Query 持有，页面不保存第二份资源副本；识别与材料命令通过第 4 节的端口发布失效。训练页的候选列表和状态计数使用 `training` 领域 Query，查询内经 `game-data` 公开面读取目录与持有干员；队列使用 `training/queue` Query，并由串行命令负责写入（见[养成队列命令与写后刷新](../frontend/domains/training.md#队列命令)）。Dashboard 经各领域 Query 读取五路业务数据，由 `features/dashboard/model` 协调完整快照（见[总览完整快照与设备采样](../frontend/domains/dashboard.md#完整快照与设备采样)）。识别命令与完成条件见[统计识别命令与失效联动](../frontend/domains/statistics.md#识别命令)。

跨页一致性不依靠各页面互相轮询：识别、队列修改、计划应用或资源更新在写入确认后发布精确作用域；接收方通过自身 Query 或会话协调器重读。失败的命令不发布成功失效，部分成功仍需保留草稿与失败条件。Dashboard 接收 `dashboard-snapshot` 后重读全部五路业务资源，单路失败保留上一份完整快照；具体规则见[总览完整快照与设备采样](../frontend/domains/dashboard.md#完整快照与设备采样)。

## 3. 公开面与依赖方向

| 域 | 公开面 | 对共享资源的依赖 |
| --- | --- | --- |
| `game-data` | 共享读取、类型、query 定义与 `gameDataKeys` | 无；只依赖 `shared/api`、`shared/query` |
| `resource-invalidation` | 端口、hook、作用域词汇 | 无业务端点 |
| `training` | 页面、队列读取、材料刷新、计划生成/应用/同步 | 经 `game-data` 读取持有干员/目录/图标；应用成功经失效端口通知 automation 与总览 |
| `statistics` | 页面、掉落/开放关卡读取、掉落 query 定义与 `statisticsKeys` | 经 `game-data` 读取仓库/持有干员/目录/图标；保留对 training 队列与材料命令的单向调用 |
| `dashboard` | 页面、快照读取 | 经 automation/training/statistics 的领域 Query 组合完整快照；经端口接收失效；设备采样归 device-mirror |

避免领域相互依赖的关键边界：

- `training → statistics`：`getOperBoxData`、`getItemIconUrl` 已迁到 `game-data`，training 不再 import statistics。
- `statistics → training`：`getAllOperators` 已迁到 `game-data`；`getTrainingQueue`、`fetchOperatorMaterials` 仍是 training 拥有的队列/材料命令，statistics 保持单向依赖。

因此 training 与 statistics 不再为共享资源互相 import 页面域公开面；statistics → training 是“使用另一个领域的队列/材料命令”，不是共享资源的第二份归属。护栏以功能域依赖无环为准，不要求页面域之间零 import；`statistics → training` 这条单向边由[依赖与职责护栏](../development/guardrails.md)记录为允许方向。

兼容与移除：

- `getDepotData`、`getOperBoxData`、`getItemIconUrl`、`getAllOperators` 的函数名、位置参数和 `ApiResponse` 形状不变，只更换归属模块。
- statistics/training 不再转发这些共享读取，消费者统一通过 `@/features/game-data` 公开面导入；数据格式、端点与存储保持兼容。
- 若未来再次迁域，必须保留旧 key 的失效范围并给消费者迁移窗口，不能在同一资源上新建第二个 domain key。

## 4. 资源失效端口

```ts
import {
  publishResourceInvalidation,
  subscribeResourceInvalidation,
  getResourceInvalidationRevision,
  useResourceInvalidation,
  type ResourceScope,
} from '@/features/resource-invalidation'

publishResourceInvalidation({
  resources: ['depot', 'materials', 'training-queue', 'dashboard-snapshot'],
  cause: 'recognition',
})
```

| 能力 | 行为 |
| --- | --- |
| `publishResourceInvalidation` | 写入确认成功后发布；空资源列表被忽略；重复作用域合并；同步通知当前订阅者 |
| `subscribeResourceInvalidation` | 注册监听器，返回注销函数；监听器异常不影响其他订阅者 |
| `getResourceInvalidationRevision` | 返回给定作用域中最近一次发布的序号；用于判断隐藏期间是否错过发布 |
| `useResourceInvalidation` | Effect 内订阅；Activity 隐藏/卸载时注销；恢复时若期间有发布，补发一次 `cause: 'activity-resume'` 合成事件；首次挂载不补发 |

作用域：

| 作用域 | 含义 |
| --- | --- |
| `depot` | 仓库识别结果或仓库相关资源变化 |
| `operbox` | 持有干员识别结果变化 |
| `catalog` | 干员目录或资源元数据变化 |
| `materials` | 养成材料数据/派生进度变化 |
| `training-queue` | 队列顺序、成员或进度变化 |
| `training-plan` | 已生成计划的前提（队列版本、设置、材料、游戏日与客户端类型）变化 |
| `automation-config` | 自动化任务流程配置变化 |
| `automation-schedule` | 服务端定时配置变化 |
| `drops` | 今日掉落记录变化 |
| `open-stages` | 今日开放关卡变化 |
| `dashboard-snapshot` | 总览完整业务快照需要重新取得 |

规则：

1. **写成功后才发布。** 部分失败只发布已确认受影响的作用域；失败本身不发布。
2. **精确列举影响范围。** 不用 `dashboard-snapshot` 代替所有领域作用域；发布者同时列出直接资源与需要完整刷新的聚合入口。
3. **不携带资源数据。** 端口只表达“哪些资源已变化”；`detail` 仅用于提示等附加信息，订阅者必须自行校验。
4. **订阅者不轮询。** 页面挂载时的首屏读取与既有定时刷新保持不变；端口只在写入完成后补一次刷新。
5. **Dashboard 仍原子提交。** Dashboard 只订阅 `dashboard-snapshot`，收到后调用完整快照刷新；五路读取全部有效才提交，单路失败保留旧快照。

## 5. 触发与影响映射

写入方按下表发布；表同时约束 `dashboard-snapshot` 必须随影响总览的写入一起发布。发布方以第三列为准。

| 触发 | 应发布作用域 | 发布方 |
| --- | --- | --- |
| 仓库识别成功并解析完成 | `depot`、`materials`、`training-queue`、`dashboard-snapshot` | `statistics` 识别命令 |
| 干员识别成功并解析完成 | `operbox`、`catalog`、`materials`、`training-queue`、`dashboard-snapshot` | `statistics` 识别命令 |
| 材料刷新成功 | `materials`、`training-queue`、`dashboard-snapshot` | `statistics` 材料命令 |
| 队列增删/排序/撤销成功 | `training-queue`、`materials`、`training-plan`、`dashboard-snapshot`；任务流程确认 synced 时额外 `automation-config`（自动同步不重注册 cron，不发布 `automation-schedule`） | 养成队列命令 |
| 养成设置保存成功 | `training-plan`（设置值参与计划应用前提） | `training` 设置所有者 |
| 应用养成计划成功 | `automation-config`、`automation-schedule`、`dashboard-snapshot` | `training` 计划所有者 |
| 资源/热更新成功 | `catalog`、`materials`、`training-plan`、`dashboard-snapshot` | `settings` 更新所有者 |

`detail` 可选，例如应用计划时携带 `{ stageCount }`；接收方不得依赖未声明字段。队列命令的 `detail.source = 'training-queue-command'` 与设置所有者的 `detail.source = 'training-settings-owner'` 是各自领域协议约定的字段，供本页忽略自己的发布；外部发布不需要携带它。

资源更新由 `features/settings` 的 `SettingsUpdateOwner` 在服务端确认成功后发布：core 更新与渠道切换在服务端同时同步资源，和“更新资源”一样发布上表四个作用域，并推进物品图标缓存 epoch 使同一路径的新图换用新 URL；CLI 更新只改变 CLI 版本，不发布任何资源作用域，也不推进图标 epoch。失败、取消与参数校验失败不发布。版本刷新由同一适配层失效 `settings/version`，不经过该端口。

## 6. 各消费页面的失效接收

| 页面 | 订阅作用域 | 收到后的最小动作 |
| --- | --- | --- |
| `OperatorTraining` | `depot`、`operbox`、`catalog`、`materials`、`training-queue`、`training-plan` | 计划前提变化时作废本地预览；仓库/材料/外部队列变化时重读队列；仓库/持有干员/目录/材料变化时失效 `training` 的 `candidates`/`counts` 领域 query；队列失效不重取候选/计数；忽略带 `detail.source='training-queue-command'` 的自发布 |
| `AutomationTasks` | `automation-config`、`automation-schedule` | 等到配置通道空闲后 `reload({ force: true })`；pending 失败草稿保留本地并提示；采用服务端副本时保留本设备独有的禁用时间点 |
| `Dashboard` | `dashboard-snapshot` | 调用完整快照刷新（`force`），五项全部有效才提交；单路失败保留旧快照与 `lastUpdate`；设备采样由 `device-mirror` 独立轮询 |
| `StatisticsWorkspace`（统计页） | `depot`、`operbox`、`catalog`、`drops` | 按作用域 `invalidateQueries` 对应资源；识别命令由 `features/statistics` 的命令所有者提交，`hooks/useStatisticsCommands.ts` 把解析快照写入 Query 并发布作用域 |

计划应用返回 409 过期属于应用响应分支，不是失效订阅动作：计划所有者清空预览并重读队列，详见[养成设置与计划有效期](../frontend/domains/training.md#设置与计划有效期)。

队列写入、计划应用与设置提交的命令生命周期分别见[养成队列命令](../frontend/domains/training.md#队列命令)和[养成设置与计划有效期](../frontend/domains/training.md#设置与计划有效期)；本页第 5–6 节统一维护其跨域发布与接收映射。

Activity 语义：隐藏会清理订阅 Effect，期间发布不会直接刷新；恢复时 hook 补发一次合成事件，避免“隐藏期间资源已变化但页面仍显示旧值”。真正卸载后重挂载由页面首屏读取负责，不重放历史事件。

## 7. 本层回归入口

| 文件（相对于 `apps/web/src/`） | 覆盖 |
| --- | --- |
| `features/resource-invalidation/model/resourceInvalidation.test.ts` | 去重发布、空发布忽略、revision、注销、监听器异常隔离 |
| `features/resource-invalidation/hooks/useResourceInvalidation.test.tsx` | 作用域过滤、首挂载不补发、Activity 隐藏/恢复补发、卸载注销、最新 handler |
| `features/settings/model/updateCommands.test.ts`、`pages/settings/ConfigManager.layout.test.tsx` | 资源/渠道/core 更新的作用域；失败不发布；CLI 只失效版本 |
| `pages/statistics/DataStatistics.layout.test.tsx` | 统计按作用域失效；识别快照写入与发布 |
| `pages/automation/AutomationTasks.config.test.tsx` | 失效重读等待在途保存、Activity 恢复补发、本地禁用时间点保留 |
| `pages/training/OperatorTraining.test.tsx` | 外部队列/目录/识别作用域、自发布忽略、计划应用发布 |
| `pages/dashboard/Dashboard.test.tsx` | 完整快照失效刷新、单路失败保旧、隐藏期间失效恢复 |

针对性命令（仓库根目录）：

```sh
pnpm --filter la-pluma-next-client exec vitest run src/features/resource-invalidation
```

端点与 signal 回归见[资源请求契约](resource-requests.md)，key 与缓存回归见[Query 规范](query-cache.md)，领域命令测试由对应领域契约维护。完整检查使用 `pnpm --filter la-pluma-next-client verify`，视觉检查范围与方式见[开发指南](../development/README.md)。

## 关联

- [资源请求错误与取消契约](resource-requests.md)：signal、失败分类与载荷校验。
- [Query 缓存与键规范](query-cache.md)：key 规范、默认策略与接入要求。
- [养成队列命令与写后刷新](../frontend/domains/training.md#队列命令)：队列唯一可写真相、串行命令与写后失效。
