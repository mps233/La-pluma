# 统计与识别

> [← 返回前端架构](../README.md) · [文档索引](../../README.md)

统计页的资源读取由领域 Query 持有，识别与材料刷新由命令所有者协调；面板保留筛选、周期等局部状态。

- [页面与面板](#页面与面板)
- [识别命令](#识别命令)
- [回归与关联](#回归与关联)

## 页面与面板

页面负责组合，面板持有交互状态与纯模型派生结果；服务端资源不复制为第二份缓存，识别/材料命令统一由 `features/statistics/model/commandOwner.ts` 持有。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 页面壳与工作区组合 | `pages/statistics/DataStatistics.tsx` | 只渲染 `app-page`/`app-stack-section` 与工作区；工作区内容经 `DeviceMonitorLayout(standard)` 与设备画面并列，设备画面类名与材质归 device-mirror 域 |
| 当前 tab、命令投影与失效订阅 | `features/statistics/components/StatisticsWorkspace.tsx` | 跨面板唯一容器；tab 由 URL 查询串 `?tab=` 承载 |
| tab 分段控件的键盘与高亮 | `features/statistics/components/StatisticsTabs.tsx` | 组合共享 `SegmentedTabNav`：tablist/tab 语义、方向键移动焦点、Enter/Space 激活与流体高亮 |
| 干员读取、筛选/排序、筛选菜单、头像缓存 | `features/statistics/components/OperatorPanel.tsx` | 读取 `operbox` 与 `catalog` 两路 Query |
| 仓库读取、失败图标与分类展示 | `features/statistics/components/DepotPanel.tsx` | 汇总结果由纯模型派生 |
| 掉落周期与掉落读取 | `features/statistics/components/DropPanel.tsx` | `DropRecords` 退为纯视图 |
| 筛选菜单的 DropdownMenu 组合、焦点与键盘 | `features/statistics/components/OperatorFilterMenu.tsx` | 规则跟随组件，面板只传值与选项 |
| 筛选、排序与阿米娅形态规则 | `features/statistics/model/operatorFilters.ts` | 已实现 |
| 仓库分类标签、分组与概览 | `features/statistics/model/depotSummary.ts` | 纯模型 |
| 掉落材料/关卡排序与展示上限 | `features/statistics/model/dropRecords.ts` | 纯模型 |
| 识别/材料命令生命周期 | `model/commandOwner.ts` + `hooks/useStatisticsCommands.ts` | 所有者是模块级单例；hook 只订阅、投影并写回解析快照 |
| 四类资源读取 | `game-data` 与 `statistics` 的 query 定义 | key、失效作用域与重取策略均未变 |

维护约束：

- 不改变四路读取的首屏时机、失效作用域与 Query key。
- `activeTab` 只由 URL 查询串承载，不写入配置、Query 或 localStorage；筛选、排序与掉落统计周期仍不持久化。
- 保持 tab/panel 的 `data-statistics-tab-*` / `data-statistics-panel-*` id、`aria-controls`/`aria-labelledby` 配对、表单 `id` 与默认态视觉；筛选菜单、tab 导航、URL 同步与局部状态由下列回归测试覆盖。

### 2. 组合与状态边界

```
DataStatistics（app-page > app-stack-section > StatisticsWorkspace）
└─ StatisticsWorkspace（当前 tab、命令投影、资源失效订阅）
   └─ SegmentedTabs（tab 受控上下文）
      ├─ StatisticsTabs（共享 SegmentedTabNav + 高亮）
      ├─ SegmentedTabPanel(operbox, keepMounted) → OperatorPanel（operbox/catalog 读取 + 筛选/排序/菜单/头像缓存）
      ├─ SegmentedTabPanel(depot, keepMounted) → DepotPanel（depot 读取 + 汇总展示 + 图标失败缓存）
      └─ SegmentedTabPanel(drops, keepMounted) → DropPanel（掉落读取 + 统计周期）→ DropRecords（视图）
```

- **三个面板随页面挂载而常驻**：三个 `SegmentedTabPanel` 都使用 `keepMounted`；非当前 tab 时面板在跑完 hooks 后返回 `null`，因此四路读取仍在页面首屏并行启动，与迁移前一致；tab 切换不会重建 Query 观察者，也不会丢失筛选、排序、打开菜单、掉落周期或图标缓存。面板的 `null` 渲染保证同一时刻只有当前 tab 的内容存在，文本查询与像素结果不变。
- **tab 语义**：`StatisticsTabs` 使用共享 `SegmentedTabNav`，id 保持 `data-statistics-tab-*` 与 `data-statistics-panel-*`；方向键/Home/End 只移动 roving focus，Enter/Space 或点击才切换。隐藏面板保留 `role="tabpanel"` 与 `hidden` 属性。
- **当前 tab** 由 URL 查询串 `?tab=` 决定，是跨页深链与浏览器前进/后退的唯一来源；缺失或未知值回落默认的 `operbox`，默认值不写入查询串。切换 tab 用 `replace` 更新当前历史项，不在历史里堆积同页 tab 记录；筛选等面板局部状态仍留在面板。总览掉落摘要使用 `statisticsTabRoute('drops')` 直达掉落记录。
- **识别/材料命令**只有一份页面投影：`useStatisticsCommands()` 在工作区调用一次 `useStatisticsCommandState()`，把 `isRunning`、`activeTask`、`activeKind`、按钮文案与两个动作投影给干员/仓库面板。面板不创建第二份状态机；按钮的 loading/disabled 都从该投影派生，跨面板互斥仍由命令所有者的单飞保证。
- **解析快照**由该 hook 写回 `gameDataKeys.resource('depot')` / `('operbox')`；跨域失效仍由命令所有者发布，工作区只订阅 `depot`/`operbox`/`catalog`/`drops` 四个作用域并按 key 失效。
- **掉落视图** `DropRecords` 只接收 `dropStatistics`、`dropDays`、`setDropDays`、`onRefresh`、loading 与错误文案；周期状态与 Query 归 `DropPanel`。
- 面板可调用所属领域 hooks；筛选菜单的定位、焦点与键盘规则不外溢到面板。
- 工作区不保存资源副本、loading 或 request id；四路 Query 的启用不依赖当前 tab。

读取失败时，各资源独立展示并恢复：

| 资源 | 失败展示与恢复 |
| --- | --- |
| 仓库快照 | 独立错误面板，不阻塞干员/掉落；重试按钮 `refetch` |
| 持有干员、干员目录 | 合并为干员面板错误；重试 `refetch` |
| 掉落统计 | 独立错误面板；同 key 刷新失败保留旧数据；天数切换期间用旧周期占位，新 key 首次失败只展示错误，不伪造上个周期数据 |

### 3. 筛选菜单规则

`OperatorFilterMenu` 以 shadcn `DropdownMenu` 承接原筛选规则：

- 打开状态与当前值由面板持有，组件只接收 `open`/`value`/`options`；单开由面板共享的 `openMenu` 保证，打开时聚焦当前已选项（不存在则第一项）。
- 菜单由 Base UI portal 与 positioner 负责视口碰撞与翻转；手机端行尾菜单使用 `mobileAlign="end"` 对齐触发器右缘，`menuWidth` 保持 112/128px，菜单项保持 44px 最小触达。
- 键盘打开或进入菜单后，`ArrowUp`/`ArrowDown` 首尾环绕、`Home`/`End` 跳转；`Escape` 关闭并把焦点还给触发器；选择后关闭并归还焦点；外部点击或焦点移出菜单关闭。
- 触发器由 Base UI 提供 `aria-haspopup`、`aria-expanded`、`aria-controls`，菜单使用 `role="menu"` 与 `role="menuitemradio"` 的 `aria-checked`。

### 4. 纯模型

| 模块 | 导出 | 规则 |
| --- | --- | --- |
| `model/operatorFilters.ts` | `selectOperators`、`buildOwnedOperatorIdSet`、`buildKnownOperatorIdSet`、`isOwnedOperator`、`isUnknownOperator`、`hasActiveOperatorFilters` 等 | 阿米娅形态共享持有状态；未拥有视图只收录识别快照确认未拥有的干员，快照未覆盖的按未知展示且不计入未拥有；未拥有视图忽略精英/潜能筛选；非已拥有视图按星级与中文名排序 |
| `model/operatorRecognition.ts` | `describeOperBoxRecognitionHint` | 完整识别不占位；旧快照缺少识别目录时提示未列出的干员拥有状态未确认 |
| `model/depotSummary.ts` | `summarizeDepot`、`summarizeDepotTypes`、`getDepotTypeLabel` | 分类按库存件数降序，件数相同保留首次出现顺序；`itemCount` 用服务端快照值；空快照返回全零 |
| `model/dropRecords.ts` | `sortDropItems`、`sortDropStages`、`DROP_ITEM_DISPLAY_LIMIT` | 材料按数量、关卡按战斗次数降序；并列保留服务端键顺序；最多展示 20 种材料 |

这些模块不访问 React、Query、命令所有者或网络，可用纯 Node 测试覆盖。

### 5. Activity 与卸载

- `Activity` 隐藏会清理页面与面板的 Effects（筛选菜单的 Base UI 弹层监听、Query 观察者、共享 `SegmentedTabNav` 内 `useFluidTabIndicator` 的 ResizeObserver/resize 监听），但保留 React state：筛选、打开状态、掉落周期与图标缓存不变；当前 tab 随 URL 保留。恢复时 Query 按 `staleTime` 决定是否重取；筛选菜单若仍处于打开状态会按当前 `open` 重新挂载。
- 命令所有者不随页面生命周期重建或中止：隐藏期间识别/材料命令继续完成，解析快照写入应用级 QueryClient；恢复后按失效 revision 补一次读取。页面不会因隐藏或重挂载重复提交设备命令。
- 真正卸载或刷新会销毁面板局部状态；当前 tab 从 URL 恢复，Query 缓存（`game-data` 的 depot/operbox/catalog 与 `statistics` 的 drops）由应用级 QueryClient 持有，可在新鲜期内复用。
- 页面不使用业务 localStorage；执行控制器持久化的是 Run 身份，不属于本页。

### 6. 兼容与维护约束

- 四路 Query key、失效作用域、`staleTime`/`gcTime`/重试策略未变；首屏仍同时启动四路读取。
- 识别/材料命令的端点、幂等键、超时与失效发布未变；材料刷新仍不重读干员目录。
- 保持 tab/panel id、`aria-controls`/`aria-labelledby`、表单 `id` 与默认态视觉；掉落记录视图保留 `h2` → 两个 `h3` 的标题层级。筛选菜单、tab 导航、URL 同步与局部状态由下列回归测试覆盖。

## 识别命令

`commandOwner.ts` 负责仓库/干员识别与材料刷新的启动、等待、超时、取消和继续；执行控制器保留设备命令身份，解析成功后才写入快照并发布失效。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 仓库识别、干员识别、材料刷新的启动与完成条件 | `features/statistics/model/commandOwner.ts` | 非 React 的域内所有者；页面只订阅状态并应用结果 |
| 设备命令提交、幂等键、Run 身份 | `features/task-execution` 控制器 | 识别通过 `beginExecutionIntent('run_task', { scope: 'statistics' })` 提交 |
| 识别日志解析 | `features/statistics/api` 的 `parseDepotData` / `parseOperBoxData` | 解析端点只读 MAA 日志并写本地缓存，不占设备执行租约 |
| 材料刷新脚本 | `features/training/api` 的 `fetchOperatorMaterials` | 不产生 Run；由 statistics 单向调用 |
| 失效发布 | `features/resource-invalidation` | 命令确认成功后发布；失败不发布 |
| Query 缓存 | `features/game-data`、`features/statistics` 的 query 定义 | 识别快照以页面 `setQueryData` 写入，读取仍归 Query |

约束：

- **命令不是 query。** `run-task`、识别解析和材料刷新都不进入 TanStack Query；它们不会被 Query 的自动重试或焦点重取重新提交。
- **等待不是固定延迟。** 识别完成后不等待固定秒数，而是轮询解析端点，直到返回可用快照或超时。
- **命令成功与刷新成功分开。** 设备命令成功只代表可以解析；解析成功才写入快照并发布失效。
- **页面不是命令所有者。** Activity 隐藏、页面卸载和重新挂载都不会重建命令状态、取消等待或重新提交设备命令。

### 2. 命令与完成条件

| 命令 | 端点/任务 | 执行身份 | 完成条件 | 超时（默认） |
| --- | --- | --- | --- | --- |
| 仓库识别 `depot` | `POST /agent/actions/run-task`，`command=run` + `taskConfig`（`Depot`），`waitForCompletion=true` | `run_task` Run（`scope=statistics`） | 同步响应成功；若响应带活动 Run 则等终态 `succeeded`；随后解析端点返回带 `itemCount` 与 `items` 的快照 | 命令 5min / Run 5min / 解析 30s |
| 干员识别 `operbox` | `POST /agent/actions/run-task`，`command=run` + `taskConfig`（`OperBox`），`waitForCompletion=true` | 同上 | 同步响应成功；Run 终态成功；解析端点返回带 `operCount` 与 `data` 的快照（附加 `allOpers` 识别目录与 `recognition` 概要） | 同上 |
| 材料刷新 `materials` | `POST /agent/actions/fetch-training-materials` | 无 Run（脚本入口） | 响应 `success=true`；材料缓存由服务端刷新 | 5min |

解析端点的成功判定：

- `success=true` 且 `data` 是包含 `itemCount: number`、`items: array`（仓库）或 `operCount: number`、`data: array`（干员）的对象；干员快照的 `allOpers`（含 `owned` 标记与多语言名称）与 `recognition`（`complete`/`partial`）是附加字段，旧快照缺少识别目录时按 `partial` 提示；`recognition` 不是 `complete` 时，快照目录以外的干员按未知展示，不进入未拥有视图，卡片角标为“未知”而不是“未拥有”；
- 未找到有效结果时，服务端返回 HTTP 422 和可重试的 `AGENT_RECOGNITION_NO_RESULT`，保留已有识别缓存。前端收到失败信封、旧服务端的 `data: null`、坏载荷或传输失败时，在超时前继续轮询解析端点；
- 解析请求携带调用方 `AbortSignal`；取消只结束本地等待，不撤销服务端已完成的解析。

### 3. 执行控制器与幂等

识别命令通过控制器 intent API 提交 `run_task`，使用 `scope: 'statistics'`。intent、幂等键与 Run 身份的通用规则以《前端执行客户端与控制器》为准。

本域恢复只推进尚未完成的阶段：命令确认成功后，Run 等待与解析中断都不再发送 `run-task`；幂等回放返回活动 Run 时按 `runId` 等终态；只有 `succeeded` 或无 Run 身份的旧同步成功响应进入解析，`failed`/`interrupted`/`stopped` 不解析、不发布。取消只中止本地等待，不发送停止命令。

### 4. 超时、取消与继续

所有者状态：

| 阶段 | 含义 |
| --- | --- |
| `running` | `run-task` 或材料刷新请求在途（含幂等回放确认） |
| `waiting` | 命令已接受，等待 Run 终态 |
| `parsing` | 轮询识别解析端点，等待日志可解析 |
| `succeeded` / `failed` | 终态 |
| `timed-out` / `cancelled` | 本地等待结束，可能仍可继续 |

继续方式：

| 中断点 | `resumeMode` | 继续时的动作 | 是否重新执行设备命令 |
| --- | --- | --- | --- |
| 命令超时、取消或传输失败 | `command` | 复用同一幂等键确认已有 Run；若首次请求未到达则只执行一次 | 否（幂等回放） |
| Run 终态等待超时/取消 | `parse` | 按 `runId` 继续读取终态，再解析 | 否 |
| 解析超时/取消 | `parse` | 只重新轮询解析端点 | 否 |
| 材料刷新超时/取消 | `null` | 没有 Run 身份可确认；用户主动重试是一次新的显式操作 | 是（仅用户显式触发） |

页面对 `resumeMode=parse` 的按钮显示“继续解析”，对 `resumeMode=command` 显示“重试识别”；`failed` 且不可继续时恢复“立即执行”。所有者本身不自动重试任何阶段。

### 5. 识别成功后的失效联动

命令确认成功且解析完成后，由所有者发布一次失效（`cause: 'recognition'`）；各命令的作用域与接收方映射以《共享资源归属与失效端口》为准。

规则：

- **写成功才发布。** 命令失败、Run 失败、解析失败与超时都不发布。
- **快照是权威结果。** 页面把解析出的完整快照写入 `game-data` 的 `depot`/`operbox` key；跨域接收方各自刷新，不复制页面副本。
- **发布自身资源会带来一次后台重读。** 统计页订阅 `depot`/`operbox`，收到自己发布的失效后会按默认 Query 策略重取一次；服务端此时已保存解析结果，因此不会用旧快照覆盖新结果。若页面在 Activity 隐藏期间完成，恢复时由失效 hook 补发一次并重取。
- **材料刷新不再触发目录重读。** 干员目录端点不包含材料进度；材料刷新的影响由 `materials` 作用域表达，养成页据此重读候选与计数。

### 6. 页面与生命周期

- `StatisticsWorkspace` 通过 `hooks/useStatisticsCommands.ts` 订阅一次命令状态：`isRunning`、当前任务、按钮 loading 与 resume 文案都从同一份 `useStatisticsCommandState()` 快照派生；干员/仓库面板只接收该投影，不再各自维护 `isRunning`/`activeTask`。
- 命令所有者是模块级单例，寿命不跟随页面。Activity 隐藏会清理页面 Effects，但不会中止所有者；页面重挂载时按钮仍显示进行中，不会重复提交。
- 点击处理器在 Activity 隐藏后仍会继续完成；解析成功时会把快照写入应用级 QueryClient，因此隐藏期间完成也不会丢失权威快照。
- 所有者不持有服务端资源副本；页面与 Query 仍按《Query 缓存与键规范》读取和失效。
- 命令状态不写入 Zustand、localStorage 或 URL；跨刷新恢复的是服务端 Run 身份（由执行控制器持久化），不是识别命令本身。刷新后不会自动重新发起识别。

### 7. 兼容与维护约束

- `parseDepotData`、`parseOperBoxData`、`fetchOperatorMaterials` 新增可选末位 `AbortSignal`；原有调用与响应形状不变。识别端点仍是 POST，解析仍只读本地日志。
- 识别命令的请求参数、任务类型、端点与快照形状保持不变；服务端数据格式未变。
- 行为变化：移除命令成功后的固定 2s 等待，改为解析可用性轮询；不再为提示文案读取一次养成队列；材料刷新后不再重读干员目录（目录不含材料数据）。这些都在命令所有者范围内，不改变页面布局。
- 超时值是可注入的域内常量，生产默认值见本专题第 2 节；没有暴露为用户设置。

## 回归与关联

### 回归测试

以下路径相对于 `apps/web/src/`：领域回归在 `features/statistics` 与 `pages/statistics`；跨域联动回归在 `features/training/api/index.test.ts`、`pages/training/OperatorTraining.test.tsx`、`pages/dashboard/Dashboard.test.tsx` 与 `features/resource-invalidation/**`。入口命令见[验证命令](#验证命令)。

关键不变量：

- 命令所有者是模块级单例且单飞：Activity 隐藏/重挂载不重建、不重复提交设备命令；继续路径只确认、等待或轮询（幂等回放与“继续解析”），不重新执行设备命令。
- 解析轮询：`data: null`、失败信封与坏载荷视为“尚未可用”，超时前继续轮询；取消只结束本地等待。
- 解析成功才写入 `game-data` 快照并发布失效；命令失败、Run 失败、解析失败与超时都不发布。
- 当前 tab 跟随 URL：`?tab=drops` 直接打开掉落记录，未知取值回落默认 tab，选择默认 tab 时移除查询串。
- 非当前 tab 面板仍启动首屏读取（`null` 渲染）；掉落周期切换进入 Query key，首次失败只展示错误，不伪造上个周期数据。

### 验证命令

在仓库根目录执行：

```sh
pnpm --filter la-pluma-next-client exec vitest run src/features/statistics src/pages/statistics
```

完整验证与视觉回归入口见[开发指南](../../development/README.md)。

### 关联契约

- [前端执行客户端与控制器](../../architecture/execution-client.md)：intent、幂等键、Run 身份与本地中止。
- [共享资源归属与失效端口](../../architecture/resource-ownership.md)：作用域词汇、发布规则与接收端。
- [Query 缓存与键规范](../../architecture/query-cache.md)：缓存身份、重取策略、识别快照写入与失效后的缓存行为。
- [资源请求错误与取消契约](../../architecture/resource-requests.md)：解析与材料的 signal、失败分类。
- [配置持久化协调器](../../architecture/config-persistence.md)：配置草稿与提交的独立所有权。
- [前端架构与所有权](../README.md)：页面、领域、纯模型与 Activity 的总体边界。
