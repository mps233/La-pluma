# 养成

> [← 返回前端架构](../README.md) · [文档索引](../../README.md)

养成页以工作区汇合队列、设置与计划版本；领域所有者负责写入与计划编排，面板保留筛选、搜索和展示范围等局部状态。

- [页面与面板](#页面与面板)
- [队列命令](#队列命令)
- [设置与计划有效期](#设置与计划有效期)
- [回归与关联](#回归与关联)

## 页面与面板

页面与工作区负责组合，面板和选择器管理局部交互；队列、设置、计划仍由领域所有者和 Query 持有，不增加缓存、命令状态或存储。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 页面壳与工作区组合 | `pages/training/OperatorTraining.tsx` | 渲染 `app-page` 页面壳与 `app-stack-section`，并组合工作区 |
| 工作区布局与共享版本边界 | `features/training/components/TrainingWorkspace.tsx` | 队列读取、计划/设置/队列命令适配、失效订阅、选择器开关与操作错误 |
| 队列列表、行内操作与撤销提示 | `features/training/components/TrainingQueuePanel.tsx` | 操作成功后把焦点还给队列标题；`TrainingUndoToast` 跟随该面板渲染 |
| 当前目标材料 | `features/training/components/TrainingMaterialsPanel.tsx` | 只从队列首位派生，不读取资源 |
| 刷图计划展示与范围选择 | `features/training/components/TrainingPlanPanel.tsx` | 持有 `current`/`all` 这一局部状态；生成/应用/同步仍调用工作区回调 |
| 自动化设置开关 | `features/training/components/TrainingSettingsPanel.tsx` | 只把开关变化组成完整设置交给设置所有者 |
| 添加干员选择器 | `features/training/components/OperatorPicker.tsx` | 候选/计数 Query、状态筛选、职业、稀有度、未精二、搜索、分批渲染与头像缓存 |
| 材料表格与合成树 | `features/training/components/MaterialViews.tsx` | 纯展示；图标失败时隐藏图片保留占位 |
| 撤销提示 | `features/training/components/TrainingUndoToast.tsx`、`shared/components/UndoToastCard.tsx` | `TrainingUndoToast` 通过 sonner 挂载；`UndoToastCard` 负责 8 秒自动关闭、悬停/焦点/pending 暂停 |
| 干员行规则 | `features/training/model/operatorRows.ts` | 搜索匹配、分批、空态文案与卡片动作 |
| 材料规则 | `features/training/model/materials.ts` | 龙门币追加、缺口筛选与当前目标摘要 |
| 计划展示规则 | `features/training/model/planDisplay.ts` | 当日开放关卡投影、次数/理智与焦点干员 |
| 队列写入、设置提交、计划编排 | `model/queueCommands.ts`、`model/settingsCommands.ts`、`model/planCommands.ts` | 已有所有者，当前未改协议 |

维护约束：

- 不改变队列、候选、计数三类 Query 的 key、读取时机、失效作用域与失败语义。
- 不持久化筛选、搜索、分批游标、计划范围或选择器开关；真正卸载/刷新后回到默认值。
- 不改变队列、材料、计划、设置与选择器面板的渲染结构、DOM 类名、CSS 或默认态视觉；不更新视觉基线。
- 不新增页面级 `useTrainingPage` 之类的整页 hook；读取仍由各面板各自的 hook/Query 持有。

### 2. 组合与状态边界

```
OperatorTraining（app-page > app-stack-section > TrainingWorkspace）
└─ TrainingWorkspace（队列读取、共享版本边界、失效订阅、选择器/错误/撤销快照）
   ├─ TrainingQueuePanel（队列列表 + 行内操作 + TrainingUndoToast）
   ├─ TrainingMaterialsPanel（当前目标材料）→ MaterialViews
   ├─ TrainingPlanPanel（计划范围 + 计划展示 + 生成/应用/同步入口）
   ├─ TrainingSettingsPanel（自动切换/完成通知）
   └─ OperatorPicker（候选/计数读取 + 筛选/搜索/分批 + Dialog）
```

- **页面无请求。** `OperatorTraining` 不导入 API、Query、领域命令或 localStorage；它只组合页面壳与工作区，页面标题由顶栏统一提供。选择器开关仍在工作区；添加入口位于队列空态的“选择干员”与非空队列页脚的“继续添加”。首次读取中或首次读取失败时队列面板不提供添加入口，需等待读取完成或重试成功。
- **设备画面由共享布局渲染。** 工作区内容放在 `DeviceMonitorLayout(standard)` 的 main 列，`DeviceMonitorPanel` 由布局放在 monitor 列；工作区不自建设备画面网格或画面卡片，设备画面类名与材质归 device-mirror 域。
- **共享版本边界在工作区。** 工作区是唯一同时持有队列快照、设置 revision 与计划 basis 的位置：队列供队列面板/材料面板/计划面板/选择器共用，`queueRevision` 与 `settingsRevision` 的合流只在这里发生一次。
- **队列写入仍归领域命令。** 工作区把 QueryClient 注入 `useTrainingQueueCommands()`，并把 `add`/`remove`/`undo`/`reorder` 的意图交给模块级命令所有者；写后刷新、重复合并、`uncertain` fallback 与失效发布都不在组件里。
- **面板可调用所属领域 hook；展示组件只接 props。** 选择器持有候选/计数 Query 与自身交互状态；计划、设置、队列面板只接收工作区投影与回调。计划范围切换、队列行操作、撤销提示关闭等局部交互都在最近的使用点。
- **错误显示位置保持原样。** 队列区显示 `operationError`，选择器内也显示同一份错误；错误状态由工作区持有，避免两个面板各存一份互相覆盖。

### 3. 共享版本边界与失效

| 事件 | 工作区动作 | 计划结果 |
| --- | --- | --- |
| 队列命令开始（增删/排序/撤销） | 立即 `invalidatePlan()`，再入队命令 | 旧预览立刻不可应用 |
| 设置开关编辑 | 立即 `invalidatePlan()`，再调用设置所有者 `update` | 写入失败也不复活旧计划 |
| 队列权威读取 revision 变化 | `useTrainingPlan` 观察快照并作废旧计划 | 外部客户端/识别造成的队列变化被发现 |
| 设置写入/权威重读采用新值 | 设置所有者推进 revision，工作区按 revision 判定 basis | 旧计划失效 |
| 外部 `training-plan` 失效 | 工作区订阅并 `invalidatePlan()` | 识别/材料刷新后需重新预览 |
| 队列写入自己的失效发布 | 忽略（权威快照已写入同一 key） | 不重复重读 |
| 设置所有者自己的 `training-plan` 发布 | 忽略（编辑时已按 revision 作废） | 写入期间生成的预览不被清空 |

失效订阅仍只在工作区建一次：

- `depot`/`operbox`/`catalog`/`materials` → 失效候选与计数 Query（按 key）；
- `depot`/`materials`/`training-queue` → 重读队列；
- `depot`/`materials`/`training-plan` → 作废旧计划。

`OperatorPicker` 不订阅失效端口，只作为候选/计数 Query 的观察者跟随缓存变化。

### 4. 面板局部状态与生命期

| 状态 | 所有者 | Activity 隐藏/恢复 | 真正卸载/刷新 |
| --- | --- | --- | --- |
| 选择器开关 | 工作区 | 保留；恢复后仍打开 | 回到关闭 |
| `operationError` | 工作区 | 保留 | 清空 |
| 移除后的撤销快照 | 工作区 | 保留；提示重新计时 8 秒 | 清空 |
| 状态筛选/职业/稀有度/未精二 | `OperatorPicker` | 保留 | 回到默认（可养成、全部职业、全部稀有度、未精二） |
| 搜索词、分批游标 | `OperatorPicker` | 保留 | 回到默认（空搜索、72 行） |
| 头像加载缓存 | `OperatorPicker` | 保留 | 清空 |
| 计划范围（`current`/`all`） | `TrainingPlanPanel` | 保留 | 回到 `current` |
| 队列、设置、计划、pending | 领域所有者/Query | 不随页面重建；Query 观察者随 Effect 注销/恢复 | 队列与设置所有者、缓存继续存在；计划状态保留到所有者在动作中重置 |

- 选择器关闭只卸载 Dialog 内容；选择器组件本身常驻，因此搜索、筛选与分批游标在再次打开时保留，与迁移前页面状态的行为一致。
- 候选/计数 Query 在选择器挂载时就启动，因此仍随页面首屏并行读取；选择器关闭不会取消已完成的读取，也不会在打开时重新建立 key。
- 状态筛选切换仍会把“未精二”重置为 `false`（`status === 'all'` 时），与迁移前一致。
- 计划范围被清空只发生在真正卸载；切换范围仍会立即作废旧预览。

候选与状态计数使用领域 Query 的唯一 key；筛选参数默认值、`keepPreviousData` 与结构共享的 Query 配置见文末的《Query 缓存与键规范》。业务读取规则如下：

- 候选失败时清空列表并展示可重试错误；计数失败不提示，同 key 保留上次成功值。共享目录读取失败同样会使候选读取失败；仅计数失败时保留候选列表。
- 候选 `status=all` 且端点返回空列表时，在同一 queryFn 内读取 `game-data` 的目录与持有干员公开端点补齐；其它状态直接使用端点行，不建立第二套 key。
- 候选端点同一响应返回 `recognition`（`status`、`total`、`owned`、`unknown`、`missing`）。服务端按快照写入时的识别完整度计算覆盖范围：完整识别才把识别目录内的条目算作确认未拥有，部分识别只确认已识别拥有的干员，其余归入 `missing` 并作为 `unknown` 返回。非 `complete` 时选择器展示识别提示，未确认拥有状态的候选行显示“未识别”且不可加入队列；旧服务端缺少该字段时保持静默，不伪造完整识别。
- `trainable`/`owned` 计数取候选端点行数，`owned` 为空时回退持有干员快照；`all` 取目录按稀有度过滤后的行数，不应用“未精二”。
- 新 `all` 为 0 时不覆盖旧值；`mergeTrainingStatusCounts` 通过结构共享保持引用稳定，避免 `keepPreviousData` 占位反复通知。
- 筛选切换由 key 隔离，旧 key 的迟到响应只写旧 key；职业筛选在客户端按候选行过滤，不新增 Query key。候选行的 `profession` 在材料数据中为中文职业名、目录回退时为英文枚举，筛选统一归一后匹配。Activity 隐藏/恢复按 Query 生命周期注销/恢复观察者。

### 5. 纯模型

| 模块 | 导出 | 规则 |
| --- | --- | --- |
| `model/operatorRows.ts` | `filterOperatorRows`、`paginateOperatorRows`、`nextOperatorRenderLimit`、`resolveOperatorEmptyState`、`describeOperatorRow` | 搜索去空白并忽略大小写；空搜索返回新数组；每次渲染 72 行；空态优先搜索/职业/稀有度，再按状态；已入队优先于未识别/未拥有/缺数据文案 |
| `model/recognition.ts` | `describeRecognitionHint` | 完整识别不占位；`missing` 提示先完成识别；`partial` 按未确认数量提示；识别概要缺失（旧服务端）时静默 |
| `model/materials.ts` | `getQueueMaterials`、`selectMissingMaterials`、`summarizeTargetMaterials` | 龙门币追加在普通材料之后并作为缺口计数；空队列返回固定标题与说明；进度保持服务端原值 |
| `model/planDisplay.ts` | `getOpenStagePlan`、`selectTodayStages`、`getOpenStageCount`、`summarizeTodayPlan`、`getPlanFocusName` | `openStages` 优先（包括空数组），否则按 `isOpen !== false` 过滤；理智回查完整 `stages` 的 `sanityPerRun`；焦点顺序为计划焦点 → 计划首位 → 队列当前 → 未设置 |

`getOpenStagePlan` 由 `planCommands.ts` 迁到展示模型，供页面渲染与应用提交共用；`planCommands` 仍负责应用编排并从这里导入，行为不变。这些模块不访问 React、Query、命令所有者或网络，可用纯 Node 测试覆盖。

计划中的 `isOpen` 与 `summary.todayOpenResourceStages`/`todayClosedResourceStages` 由服务端按连接 profile 的客户端服务区游戏日（时区 + 每日 04:00 日界）判定，与总览、执行跳过同源；`summary.gameDate`/`summary.clientType` 标明本次判定的游戏日与客户端类型。资源收集全开放活动期间（MAA 活动表 `StageActivityV2.json` 的 `resourceCollection` 窗口），服务端把该服务区的所有资源本按开放处理；计划生成未显式传入客户端类型时读取连接 profile，队列变更与 `POST /training/sync` 的自动同步因此不会退回连接默认时区。

### 6. 选择器焦点、键盘与弹层

- `Dialog`（Base UI）负责 portal、背景 `aria-hidden`/滚动锁定、Tab 循环、Escape 关闭与触发器焦点归还；空队列的“选择干员”与非空队列页脚的“继续添加”是同一个选择器入口。
- 状态分段保留 `role="toolbar"`、`aria-pressed`、`tabIndex` 与方向键/Home/End 导航；高亮测量仍由 `useFluidTabIndicator` 持有。
- 搜索框 `aria-label="搜索干员名称"`、职业 `select[aria-label="职业"]`、稀有度 `select[aria-label="稀有度"]`、添加按钮的 `aria-label`/禁用/加载文案均保持。
- 分批按钮仍显示 `继续显示 N 个` 与 `已显示 X / Y`；搜索或筛选变化会把游标复位到 72。
- 空态、列表失败与队列失败仍使用可重试的 `TrainingLoadError`，不把失败呈现为空列表。

### 7. Activity 与卸载

- `Activity` 隐藏只清理 Effects：队列/候选/计数 Query 观察者注销，撤销提示计时器清理；React state（筛选、搜索、分批游标、头像缓存、计划范围、选择器开关、操作错误、撤销快照）保留。恢复后 Query 按新鲜度重取，撤销提示重新计时 8 秒。
- 队列命令、设置写入与计划生成/应用/同步都是模块级所有者：隐藏或真正卸载不会重建串行链、取消写请求或清空 pending；恢复时工作区重新订阅所有者状态。
- 真正卸载会销毁面板局部状态并由新页面从默认值开始；应用级 QueryClient 中的队列/候选/计数缓存和所有者状态继续可用。

### 8. 兼容与维护约束

- Query key、读取时机、失效作用域、失败保旧与 `uncertain` 语义未变；选择器关闭不改变候选/计数读取的启动时机。
- 队列/设置/计划的所有者 API、端点与失效发布未变；`training-plan-applied` window 事件仍未恢复。
- 保持工作区内部渲染结构、DOM 类名、表单 `id` 前缀、`aria-*` 与默认态视觉；页面壳统一为 `app-page > app-stack-section > Workspace`；选择器焦点、标签和交互由下列组件/页面回归测试覆盖。
- `getOpenStagePlan` 归 `planDisplay.ts`；它不是 feature 公开面成员，供渲染层与计划所有者使用。

## 队列命令

队列增删、排序与撤销经模块级命令所有者串行执行；写入后读取权威队列，刷新失败则保留带 `uncertain` 标记的本地结果，并发布已确认的资源变化。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 养成队列快照 | `features/training/model/queries.ts` 的 `trainingQueueQueryOptions` | `['training', 'queue']` 是队列唯一的可写真相；页面与后续消费者只读取 |
| 队列增删、排序、撤销 | `features/training/model/queueCommands.ts` | 非 React 命令所有者；串行执行、写后刷新、fallback 与失效发布都在此 |
| 页面 pending 标记与命令发起 | `features/training/hooks/useTrainingQueueCommands.ts` | 薄适配层，把应用级 QueryClient 注入命令上下文 |
| 训练设置 | `features/training/model/settingsCommands.ts` | 目前设置提交、本地 revision 与旧响应裁决由领域所有者持有；队列命令不写设置。见“设置与计划有效期”专题 |
| 训练计划 | `features/training/model/planCommands.ts` | 目前由模块级 `TrainingPlanOwner` 持有生成/应用/同步、版本前提与失效发布；页面只订阅 |
| 跨域失效发布 | `features/resource-invalidation` | 命令写入成功后发布；失败不发布 |
| 总览快照 | `features/dashboard` 的完整快照协调器 | 收到 `dashboard-snapshot` 后强制刷新，不复制队列缓存 |

约束：

- **不在页面和 Query 中各存一份可写队列。** 页面从 `queueQuery.data.queue` 派生列表；写入只能经领域命令。
- **命令不是 Query mutation。** 增删、排序与撤销不走 Query 的自动重试，也不使用乐观写入覆盖服务端；它们显式串行、显式刷新。
- **写成功与刷新成功分开。** 服务端已保存但本地无法重新读取时，不回滚写入，也不把结果伪装成最新；页面显示带 `uncertain` 标记的 fallback。
- **命令寿命不跟随页面。** Activity 隐藏或页面重挂载都不会重建串行链或取消已发出的写入。

### 2. 命令与完成条件

| 命令 | 端点 | 写入后刷新 | 刷新失败 fallback |
| --- | --- | --- | --- |
| `add` | `POST /agent/training/queue` | 重新 `GET /agent/training/queue` | 在最新缓存末尾补入本地构造的队列项 |
| `remove` | `DELETE /agent/training/queue/:operatorId` | 同上 | 从最新缓存移除该干员；保留 `{ item, index }` 供撤销 toast |
| `undo` | `POST /agent/training/queue`（带 `position`） | 同上 | 在最新缓存的原索引（按当前长度夹紧）插回被移除项 |
| `reorder` | `PUT /agent/training/queue/order` | 同上 | 在最新缓存上把该干员移动到目标索引 |

完成条件：

1. 写入响应的 `success === true`；
2. 随后的队列读取成功，并用该权威快照覆盖 `training/queue`；
3. 只有 1、2 都成立才是 `applied`。

只有 1 成立、2 失败时是 `uncertain`；1 失败时是 `failed`，缓存和页面保持原样；重复命令被合并或目标已达成时是 `ignored`。`ignored` 不产生提示或错误。

### 3. 串行、重复合并与版本裁决

命令所有者维护一条模块级 Promise 串行链：

```
add / remove / undo / reorder → 排队 → 前一条写入并刷新完成 → 下一条读取最新快照 → 计算并写入
```

规则：

1. **执行时读取最新快照。** 命令参数只表达意图（操作哪个干员、目标索引、撤销哪一项），排序 payload 在真正执行时由最新队列生成，不在点击时冻结旧顺序。前一条命令的移除/排序会进入后一条命令的输入。
2. **重复添加/移除/撤销被合并，排序不合并。** 同一干员的 pending `add` / `remove` / `undo` 只保留一个请求；`reorder` 总是排队执行，并在执行时按最新位置判断是否仍需写入，因此同一干员的后续排序目标不会被丢弃。
3. **无快照时不做乐观写入。** 命令在写入前与写入后各取消一次在途的队列读取（`cancelQueries`，读取函数必须传 `AbortSignal`），避免“读取开始于写入之前、却在写入之后提交”的旧快照覆盖新结果；写入失败且此前没有快照时页面重新发起首屏读取。
4. **版本裁决在读取侧。** 队列快照携带服务端 `revision`（成员与精英目标）与 `lastUpdated`；页面比较读取到的 revision，变化时作废旧计划。`revision` 不包含设置，设置版本由领域设置所有者另外维护（见“设置与计划有效期”专题）。命令不发送条件写请求，跨客户端同时写入仍由服务端串行化，前端只保证本客户端的写入不互相覆盖。
5. **排序目标失效时明确失败。** 目标干员已不在最新队列时返回“队列已变化，请重新排序”，不发送可能回退他人更新的全量顺序。

### 4. 写后刷新与不确定状态

```
写入成功
  ├─ 重新读取队列成功 → 提交权威快照 → applied → 发布失效
  └─ 重新读取队列失败 → 在最新缓存上应用命令效果 → 标记 uncertain → 发布失效
```

- fallback 以**命令完成时**缓存中的最新队列为基准，而不是点击时的副本；期间到达的外部刷新不会被丢弃。
- fallback 快照保留 `settings`、`revision`（优先取写入响应中的 `queueRevision`）与 `flowSync`（优先取写入响应），并写入 `uncertain` 文案。
- `uncertain` 是快照字段而不是独立页面状态：下一次权威读取返回的快照不带该字段，状态自然清除；Query 的默认结构共享会因字段差异替换为权威数据。
- 页面在 `uncertain` 或“有数据但重取失败”时显示警告条与“重新加载”，并禁用计划预览/应用；重新加载成功后警告消失。
- 写入成功但刷新失败仍然发布失效：服务端已经变化，其他页面应刷新；本页不再为自己的发布做第二次重读。

### 5. 失效联动

队列写入确认成功后发布一次失效；完整作用域与跨域接收方映射以《共享资源归属与失效端口》为准。只有写入响应确认任务流程 `synced` 时才包含 `automation-config`；自动同步不会重注册已存在的 cron，因此不发布 `automation-schedule`。

发布参数为 `cause: 'training-queue'`，并携带 `detail: { source: 'training-queue-command' }`：

- 目前由 `TrainingWorkspace` 忽略带该 `detail` 的发布，因为权威快照已写入同一 Query key；外部发布的 `training-queue`（不带该标记）仍会触发重读。
- 候选列表与状态计数不因队列写入而失效；材料刷新/识别命令仍按 `materials` / `operbox` / `depot` 作用域触发候选与计数重取。
- 计划失效路径：命令开始时立即作废旧预览（包括撤销；即使用户随后取消或失败，见既有回归），读取到 revision 变化时作废，以及设置版本变化时作废。前者保证“点击排序后旧计划按钮立即不可应用”，后两条覆盖识别、材料刷新、外部设置修改和另一客户端造成的队列变化。

### 6. 页面与生命周期

- 目前 `TrainingWorkspace` 用 `useQuery(trainingQueueQueryOptions())` 读取队列，用 `useTrainingQueueCommands()` 发起命令并派生 `pendingOperatorIds` / `queueMutationPending`；页面只组合页面壳与工作区。
- 队列命令所有者为模块级单例；Activity 隐藏只注销页面 Effect，不中断串行链与写后刷新。隐藏期间完成的命令仍会写入应用级 Query 缓存，恢复时按新鲜度使用。
- 真正卸载后重挂载：命令继续完成（请求没有 AbortController 绑定页面），新页面从 Query 缓存读取结果；pending 提示是否仍显示取决于命令是否完成，不再由旧页面闭包维护。
- 页面首屏：`useTrainingPlan()` 把队列快照交给计划所有者，由其采用 `flowSync` 并把 `settings` 交给设置所有者 hydrate；若用户先编辑设置，则不采用迟到的首屏值。`TrainingPlanOwner` 的权威重读在读取期间本地设置未变化时采用服务端值（外部设置变化由此被发现）。
- 生成计划前、应用后/失败后、重试同步后与显式“重新加载”都通过所有者强制重取队列；重读比较快照 revision 与设置版本，作废过期预览。
- 队列命令的同步发布遵循本专题第 5 节；显式计划应用的发布由 `TrainingPlanOwner` 持有，见“设置与计划有效期”专题。`training-plan-applied` window 事件已移除。

### 7. 兼容与维护约束

- 端点、请求体、响应体、服务端存储与 `flowSync` / `revision` 形状均未改变；`getTrainingQueue`、`addToTrainingQueue`、`removeFromTrainingQueue`、`updateTrainingQueueOrder` 的位置参数与 `ApiResponse` 信封保持兼容。
- 队列只保存在领域 Query 缓存中；key 与缓存策略以《Query 缓存与键规范》为准。
- 新增的 `uncertain` 字段只存在于前端 Query 缓存，不写入服务端，也不进入任何持久化存储。
- 目前 synced 队列写入额外发布 `automation-config`（不含 `automation-schedule`），并移除 window 事件；不需要服务端迁移，旧订阅者若仍在监听 window 事件会失去通知（本仓库内已全部迁移）。
- `detail.source` 是协议中的可选字段；不了解该字段的订阅者按普通 `training-queue` 发布处理，行为安全。

## 设置与计划有效期

设置所有者串行提交并裁决旧响应；计划所有者按队列与设置版本判断预览有效期，编排生成、应用、同步以及成功后的 automation/总览失效。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 设置值、已确认值、本地 revision、串行写链 | `features/training/model/settingsCommands.ts` 的 `TrainingSettingsOwner` | 非 React 所有者；页面卸载与 Activity 隐藏不重建 |
| 计划状态、生成/应用/同步编排、失效发布 | `features/training/model/planCommands.ts` 的 `TrainingPlanOwner` | 非 React 所有者；同时只允许一个写操作 |
| 设置所有权状态订阅与编辑入口 | `features/training/hooks/useTrainingSettings.ts` | 薄适配层，不含请求或竞态逻辑 |
| 计划版本前提与可用性判断 | `features/training/model/planValidity.ts` | 纯函数：basis 捕获、版本比较、生成/应用可用性 |
| 计划生成/应用/同步编排与跨域失效 | `features/training/model/planCommands.ts` 的 `TrainingPlanOwner` | 目前为模块级所有者；页面只发起动作并渲染状态 |
| 队列快照与队列写入 | `features/training/model/queries.ts`、`queueCommands.ts` | 队列 revision 由服务端提供；设置不进入队列写命令 |

约束：

- **设置只有一份可写真相。** 页面不再持有 `settings` 独立 state、request id 或写队列；显示值与提交值都来自所有者。
- **提交在模块级串行。** 同一时刻只有一次 `PUT /agent/training/settings` 在途；后续编辑排在它之后，执行时提交自己的完整设置对象。
- **只有最新编辑的响应能改变页面值。** 旧响应成功只更新内部 `persisted`，供后续失败回滚；旧响应失败不会回滚新草稿，也不产生提示。
- **计划前提是版本而不是快照副本。** 页面不保存生成时的队列/设置副本，只保存 `{ queueRevision, settingsRevision }`；前提变化即作废旧计划。

### 2. 设置版本与提交模型

服务端没有独立的设置 revision：`PUT /agent/training/settings` 返回归一化后的设置，`GET /agent/training/queue` 的 `revision` 只覆盖队列成员与精英目标。因此设置版本由客户端所有者维护：

| 事件 | 页面值 | `persisted` | `revision` |
| --- | --- | --- | --- |
| 一次内容不同的编辑 | 立即变为新值 | 不变 | +1 |
| 最新写入成功 | 采用响应中的归一化值 | 更新 | 值变化时 +1 |
| 旧写入成功 | 不变 | 更新 | 不变 |
| 最新写入失败 | 回滚到 `persisted` | 不变 | 值变化时 +1 |
| 旧写入失败 | 不变 | 不变 | 不变 |
| 首次成功快照 hydrate | 采用服务端值 | 更新 | 值变化时 +1 |
| 显式重新加载采用服务端值 | 采用服务端值 | 更新 | 值变化时 +1 |

`revision` 只表示可观察设置值变化，不表示请求次数；内容相同的编辑返回 `ignored`，不写请求、不递增。

每次写入确认成功都发布一次 `{ resources: ['training-plan'], cause: 'training-settings', detail: { source: 'training-settings-owner' } }`；失败不发布。本页的旧计划已由编辑与 revision 立即作废，该发布供同一应用内的其他订阅者使用；本页忽略带该 `detail` 的发布，避免清空用户在写入期间重新生成的预览。

写入失败时页面显示“设置保存失败，已恢复原设置”，不把失败静默成已保存。网络失败无法区分“服务端未写入”和“已写入但响应丢失”：当前先按未写入回滚，下一次权威队列读取若返回不同设置会采用服务端值并使计划失效。

### 3. 加载、外部变化与生命周期

- **首次 hydrate**：首个成功队列快照到来时采用其中的 `settings`。若用户已经编辑过（无论写入是否完成），不再采用迟到的首屏值。
- **队列命令快照不覆盖本地设置**：增删/排序/撤销的写后快照与 Query 缓存更新只更新队列与计数，不改变设置显示值。
- **权威重读可发现外部设置变化**：`TrainingPlanOwner` 的权威重读在读取完成时，若读取期间本地设置没有在途写入、也没有 revision 变化，则采用服务端 `settings`。因此“重新加载”、生成计划前的强制读取、外部 `training-queue`/材料/仓库失效都能发现另一客户端的设置修改，并使旧计划失效。
- **Activity 与卸载**：所有者为模块级单例；隐藏/恢复只影响订阅，不影响写链。页面真正卸载后重挂载仍读取同一设置值与 `persisted`，旧提交先于新提交执行。已 hydrated 的设置所有者不会因重挂载后的首个队列快照再次采用外部值；外部变化仍需一次权威重读（生成前读取、显式“重新加载”或外部失效）。
- **失败重试**：没有单独的设置重试按钮；用户再次切换即产生下一份完整提交。失败的 `syncState` 与错误原因保留到下一次成功写入或采用不同的服务端值。

限制：队列 `revision` 不包含设置，因此设置单独变化不会通过 revision 被其他客户端感知；本客户端需要一次队列重读（刷新、生成前读取或显式重新加载）才能采用外部值。跨客户端同时写入仍是最后写入生效，客户端只保证本客户端的写链不互相覆盖。

### 4. 计划有效期

一次预览在生成时冻结：

```ts
interface TrainingPlanBasis {
  queueRevision: string | null      // 生成前权威队列快照的服务端 revision
  settingsRevision: number          // 生成前的设置版本
}
```

以下任一情况使 basis 失效：

- 队列 revision 变化：本页增删/排序/撤销（命令开始时立即作废）、识别/材料刷新、另一客户端造成的成员或精英目标变化；
- 设置 revision 变化：编辑、写入归一化、失败回滚、权威重读采用外部设置；
- 计划范围切换、应用失败、同步重试发现新 revision 等既有路径仍直接清空预览。

作废同时清空计划与计划错误，页面回到“队列变更后需重新预览”的占位；不会保留一个仍显示“可应用”的旧计划。

#### 4.1 生成

```
检查：有队列、非 busy、队列刷新未失败
  → TrainingPlanOwner 强制读取权威队列（失败则报错，不生成）
  → 冻结 basis = { freshQueue.revision, 当前 settings revision }
  → POST /agent/training/plan
  → 响应 queueRevision 与 freshQueue.revision 不符：刷新队列并提示重新预览
  → 响应期间 basis 变化：丢弃响应并提示“计划前提已变化”
  → 通过：提交 plan + basis
```

生成前的重读可能采用外部设置并推进设置 revision。所有者在重读完成后重新取号再冻结 basis，
因此“采用外部设置”本身不会取消刚发出的生成；此后任何版本变化（包括页面尚未渲染的队列
revision）都会在响应返回时按实时版本再次校验，旧计划不会进入可应用状态。

刷新失败（包括不确定 fallback 与“有旧快照但重取失败”）时预览按钮禁用，所有者也会再次
拒绝，避免用旧快照生成计划。重复点击在生成期间返回 `ignored`，只产生一个请求。

#### 4.2 应用

应用按钮只在 `plan` 存在、`basis` 与当前队列/设置版本一致、非 busy 且队列刷新未失败时可用。
所有者提交前按以下顺序执行：

1. 通过 `userConfigCoordinator.settle([USER_CONFIG_KEYS.automationTasks])` 等待本设备
   automation 配置通道中已入队的保存完成；仍有未确认草稿时拒绝应用并提示先同步配置。
   这保证旧保存先落盘、计划应用后到，旧保存不会覆盖刚应用的计划。
2. 排空等待结束后重新校验 basis 与刷新状态，再读取设置所有者最新值提交：

```ts
applyTrainingPlan({ plan: getOpenStagePlan(plan), settings: 所有者当前 settings })
```

3. 服务端确认后发布 `automation-config` / `automation-schedule` / `dashboard-snapshot`
   （`cause: 'plan-applied'`，`detail` 含关卡数、流程名与可选任务名），然后强制重读队列。
4. 服务端会以更新后的 automation 配置重新注册已存在的默认定时任务；若注册失败（包括只有
   部分时间点创建成功），响应中的 `scheduleSync` 标记为 `attempted: true, success: false`，
   所有者保留已应用的计划并显示可重试的部分成功提示。重读队列失败同样返回 `partial`，
   不会重复提交应用请求。

队列刷新失败警告中的“重新加载”会先作废旧预览；恢复后用户需要重新预览。部分成功提示中的
“重新加载”只重读队列，不清除已应用计划或定时失败提示。应用成功后保留预览；应用失败则
清空计划并重读队列。

### 5. 页面接线

- 设置开关调用 `handleUpdateSettings`：先立即作废旧计划，再 `updateSettings`；失败且未被后续编辑取代时显示全局错误。
- `useTrainingPlan()` 订阅所有者状态，注入应用级 QueryClient、设置所有者与队列命令 pending；
  队列快照变化统一交给所有者观察（revision 变化作废旧计划、空闲时采用 `flowSync`）。
- 队列 revision、设置 revision、计划范围切换、撤销开始、外部 `training-plan` 失效都走同一
  `invalidate()`；渲染层用 `plan && basisCurrent` 决定是否展示详情与“应用到…”按钮。
- 失效订阅忽略设置所有者自己的 `training-plan` 发布（`detail.source = 'training-settings-owner'`）；外部 `training-plan` 发布仍作废旧计划。
- 队列命令同步 `flowSync` 后由所有者更新横幅；synced 时队列命令只发布 `automation-config`，
  重试同步发布 `automation-config` / `dashboard-snapshot`。自动同步不重注册 cron，因此这两条
  路径都不发布 `automation-schedule`；只有显式应用计划会发布它。`training-plan-applied`
  window 事件已移除。
- 部分成功（服务端 schedule 注册失败或应用后重读失败）使用页内 warning：读取失败可用“重新加载”，
  定时注册失败保留计划并可直接重试应用；失败不自动重试写请求。

### 6. 兼容与维护约束

- 端点路径、请求体与服务端存储未改变；设置仍写入训练队列文件中的 `settings` 字段，`PUT /agent/training/settings` 的返回形状不变。应用计划的响应新增可选 `scheduleSync` 字段，其余响应形状不变，旧客户端会忽略新字段。
- 未新增 localStorage、Query key 或持久化版本；设置 revision 与计划 basis 只存在于模块内存，刷新页面随计划一起丢失。
- 默认态页面结构、DOM 与 CSS 未改变。新增的“计划已应用但读取/定时刷新失败”提示条与
 “重新加载”入口只在部分成功状态出现；计划失效时隐藏详情是当前行为。
- 新的应用发布复用既有作用域与 `detail` 可选字段；automation 与 Dashboard 不依赖 window 事件。
  它不跨浏览器标签页，也不替代服务端 revision。
- 设置提交、计划有效期与编排继续由设置/计划所有者持有；hooks 与 `TrainingWorkspace` 只适配订阅和交互，不另建本地计划 state 或写入链。

## 回归与关联

### 回归测试

以下路径相对于 `apps/web/src/`：领域回归在 `features/training` 与 `pages/training`；跨域联动回归在 `pages/dashboard/Dashboard.test.tsx`、`pages/automation/AutomationTasks.config.test.tsx` 与 `features/resource-invalidation/**`。入口命令见[验证命令](#验证命令)。

关键不变量：

- 队列命令串行且执行时读取最新快照：重复添加合并、排序不合并，写成功与刷新成功分开（`uncertain` fallback），写前取消在途读取，目标干员消失时拒绝排序。
- 设置所有者串行提交并裁决旧响应：只有最新编辑能改变页面值，最新失败回滚到 `persisted`，首次 hydrate 只采用一次。
- 计划有效期：`{ queueRevision, settingsRevision }` 任一变化即作废旧计划，队列命令开始即作废；应用前等待 automation 配置排空并在 pending 时拒绝；部分成功（schedule 注册失败、应用后重读失败）保留计划并提示。
- 失效发布：写成功才发布，本页忽略自己的 `detail.source` 发布；显式应用发布 automation/调度/总览三类作用域，synced 队列写入只发布 `automation-config`。

### 验证命令

在仓库根目录执行：

```sh
pnpm --filter la-pluma-next-client exec vitest run src/features/training src/pages/training
```

完整验证与视觉回归入口见[开发指南](../../development/README.md)。

### 关联契约

- [Query 缓存与键规范](../../architecture/query-cache.md)：队列/候选/计数的 key、参数默认值、缓存策略与写后失效规则。
- [共享资源归属与失效端口](../../architecture/resource-ownership.md)：候选/计数/队列的归属与触发映射。
- [配置持久化协调器](../../architecture/config-persistence.md)：计划应用前的 automation 配置写入屏障。
- [资源请求错误与取消契约](../../architecture/resource-requests.md)：请求 signal、失败分类与载荷校验。
- [前端架构与所有权](../README.md)：页面、领域、纯模型与 Activity 的总体边界。
