# 作业

> [← 返回前端架构](../README.md) · [文档索引](../../README.md)

本文集中维护本领域的面板、模型与命令约定；通用契约通过链接引用。

- [页面与面板](#页面与面板)
- [搜索与预览](#搜索与预览)
- [回归与关联](#回归与关联)

## 页面与面板

配置草稿仍由 `user-config` 协调器持有，搜索/预览仍由 `combat` 域 Query 与 `CopilotPreviewSession` 持有，执行仍归 `task-execution` 控制器；队列条目与勾选由 `useCopilotQueue` 持有并持久化，预览恢复选择由工作区投影到队列。页面/面板分别持有组合、视图派生与会话存储，不新增第二份配置、预览或运行状态。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 页面壳与工作区组合 | `pages/combat/CombatTasks.tsx` | 只渲染 `app-page`/`app-stack-section` 与工作区；不调用搜索/预览/执行 hook，不持有请求生命周期 |
| 模式、配置订阅、预览/搜索入口、执行订阅、作业集选择、队列实例、同步反馈与重置弹层 | `features/combat/components/CombatWorkspace.tsx` | 跨面板唯一容器；`activeCombatMode`、`selectedCopilotIndexes`、`useCopilotQueue` 实例与面板会话存储在这里创建 |
| 任务目录与模式展示项 | `features/combat/components/CombatTaskCatalog.tsx` | 任务条目的名称、命令、占位与高级字段标记，以及模式展示项的标题；模式标题由 `COMBAT_TASKS[id].name` 派生，普通作业的页签与卡片标题统一为「普通作业」；`taskName` 只是展示字符串，改名不迁移进行中/历史 Run 的旧文案；不读取配置/Query/执行状态 |
| 模式分段控件的键盘与高亮 | `features/combat/components/CombatModeTabs.tsx` | 组合共享 `SegmentedTabNav`：tablist/tab 语义、方向键移动焦点、Enter/Space 激活与流体高亮 |
| 执行设置、编队/突袭/作业集模式与高级字段 | `components/CombatSettingsPanel.tsx`、`components/CombatAdvancedFields.tsx` | 受控表单；选项表来自 `model/combatCommands.ts`。单作业且队列为空时隐藏只对队列/作业集生效的「执行方式」与「队列策略」，隐藏不改变配置值。 |
| 作业来源栏（链接输入、预览、JSON 导入、识别方式、发现与说明） | `components/CombatCopilotSourceBar.tsx` + `components/CombatCopilotInputPanel.tsx` | 输入值来自配置草稿；JSON 导入按钮位于链接输入框内、识别方式下拉左侧，文件选择与从文件管理器复制后粘贴的 JSON 文件走同一上传通道；识别方式保存在面板会话存储；“发现”只打开独立弹窗，不在来源栏内嵌搜索 |
| 发现作业弹窗（关键词、关卡、干员、排序、视图与结果卡片） | `components/CombatCopilotDiscoveryDialog.tsx` + `CombatCopilotSearchBar.tsx`、`CombatCopilotDiscoveryCard.tsx`、`CombatCopilotStageSelect.tsx` | 工作区在页面挂载时按已保存的干员偏好后台预取默认热度列表并缓存；打开弹窗先展示缓存，再在后台刷新，刷新不显示 loading、不阻塞输入；关键词/关卡/排序每次打开重置，干员包含/排除、匹配设置与视图按界面偏好恢复；请求统一经 `normalizeCopilotSearchRequest`，关卡/干员/排序变化立即重搜，视图与匹配模式只影响本地展示；关键词输入框在有关键词时显示右侧清除按钮，清空后焦点回到输入框；整张卡片可点击打开该条目的详情预览，不改写主输入，也不标记“已选中”；搜索在途优先显示搜索占位，显式搜索或默认列表读取失败时在弹窗内显示错误与「重试」，不再回退到旧结果、默认热度列表或「暂无作业」空态 |
| 干员包含/排除与匹配设置 | `components/CombatCopilotOperatorFilterDialog.tsx`、`components/CombatCopilotMatchDialog.tsx` + `model/operatorFilter.ts` | 包含/排除互斥，选项来自识别快照的已拥有/未拥有干员并支持中文名、全拼与首字母；包含区按已拥有 + 练度降序、排除区按未拥有 + 练度升序（先精英等级再干员等级），选项区最多三行并随滚动自动追加；干员按钮内的电源开关可临时停用筛选而不清空选择；“记住筛选结果”决定下次是否恢复选择（关闭时只保留开关状态）；匹配是客户端过滤，服务端 `match` 缺失时保留卡片并标注未识别；持有快照读取中或失败时，结果卡片统一标记「拥有状态未知」而不是「未拥有」，匹配弹窗对应显示加载或读取失败与重试 |
| 关卡目录与持有干员快照 | `model/queries.ts`（`copilotStageCatalogQueryOptions`）+ `game-data`（`operBoxQueryOptions`） | 工作区在发现弹窗首次打开时按需读取，弹窗只消费投影；不在弹窗内另建数据源；持有干员投影同时提供加载/失败状态，失败时卡片标记未知并可重试 |
| 普通搜索与悖论搜索 | `hooks/useCopilotSearch.ts`、`components/CombatParadoxSearchPanel.tsx` | 普通搜索请求、代次与取消由工作区 hook 持有；悖论干员搜索词在面板侧；悖论结果一次渲染服务端返回的全部条目（最多 10 条），列表、标题与 Toast 数量一致，不再截断 6 条；结果与发现卡统一显示格式化后的「热度 X」，不换算星级；结果与推荐接线由工作区提供 |
| 本次执行的条目位置、当前关卡、执行模式与已用时 | `components/CombatExecutionProgressPanel.tsx` | 只渲染 `deriveExecutionProgress`；不呈现运行状态、停止入口、逐项结果或计划计数 |
| 页面级执行状态区（跨 tab 等待续跑与终态结果） | `components/CombatExecutionStatusPanel.tsx` | 只渲染工作区投影：等待区仅在保全派驻/悖论模拟 tab 提供继续/跳过，终止仍由当前卡片头部的执行按钮提供；普通作业 tab 仍由作业卡与队列面板提供；终态结果跨 tab 常驻，`role="status"`，不新建执行状态、Run 身份或终态契约 |
| 作业队列（唯一列表：勾选、排序、删除、清空、等待续跑/跳过/重试入口） | `components/CombatCopilotQueuePanel.tsx` | 只渲染 `CombatCopilotQueueProjection`；行主体打开详情层；不持有第二份队列模型 |
| 队列模型、本地持久化与操作 | `model/copilotQueue.ts`、`model/copilotQueueStorage.ts`、`hooks/useCopilotQueue.ts` | 条目构造、URI 去重、排序、上限与 `la-pluma-copilot-queue-v1` 读写；勾选为会话状态 |
| 队列 Run 投影 | `model/copilotQueueRun.ts` | 从 `run.progress` 与 `run.result.summary` 读取 `clientId` 状态、下一项、失败原因与计数；不新建执行身份 |
| 作业集摘要（续跑目标、下一关、计数与失败原因） | `components/CombatCopilotSetPanel.tsx`（内部 `CombatCopilotQueueSummary`） | 作业集预览时在详情层内渲染 |
| 作业详情层 | `components/CombatCopilotDetailLayer.tsx` + `model/copilotDetail.ts` | 普通作业预览、作业集摘要和队列行共用详情层。桌面非模态抽屉，手机 Sheet；目标未就绪时先渲染抽屉壳与加载态 |
| 保全派驻 / 悖论模拟卡片 | `components/CombatSpecialTaskPanel.tsx` | 输入、URI 计数、高级字段、搜索与概览；保全派驻只接受单 URI，多 URI 以 warning 语义提示，不按破坏性错误呈现；不创建执行状态 |
| 卡片头部与运行/停止按钮 | `components/CombatTaskHeading.tsx` | 共享两种卡片的标题与执行投影；普通作业卡可在执行按钮下方显示队列执行目标提示 |
| 作业集视图派生 | `model/copilotSetView.ts` | 纯模型：当前 Run 归属、按模式判定完成、待执行求差、续跑目标与下一关 |
| 面板会话状态 | `model/panelState.ts` + `hooks/usePanelState.ts` | 工作区创建、面板订阅；页面卸载时销毁 |
| 命令、URI 与载荷模型 | `model/combatCommands.ts`、`utils/copilotUri.ts`、`model/copilotPayload.ts` | 纯命令与载荷模型，不改变执行协议 |

维护约束：

- 不改变 `/agent/copilot-sets/*` 等既有端点、配置 key、既有本地存储键或执行 wire 形状；`/agent/copilot/search` 保留 `stage` 作为 `level` 别名，新增可选 `document`/`level`/`operator`/`orderBy`/`page`/`limit` 与响应字段（`stageId`/`stageCode`/`stageLabel`/`uploader`/`uploadTime`/`operators`/`match`/`details`/`operatorDetails`/`groupNames`/`recommendedMode`/`total`/`hasNext` 等），旧调用方不传新参数时行为不变。新增的 `/agent/copilot/stages` 是只读关卡目录，`/api/copilot-files` 与 `/agent/copilot-queues/*` 是 Web UI 专用入口，均不进入 Agent manifest。新增的 `la-pluma-copilot-queue-v1` 只服务本地作业队列。
- 不改变三种作业集执行方式的服务端映射：`app`/`cli` → `continuous`，`manual` → `manual`。
- 不把搜索词、关卡、排序或识别方式写进配置或 localStorage；干员筛选（含启用状态与记住开关）、匹配模式与网格/列表视图只作为界面偏好写入 `la-pluma-copilot-operator-filter-v1`、`la-pluma-copilot-operator-match-v1`、`la-pluma-copilot-discovery-view-v1`，不进入配置通道或 Query key；不新增跨页共享。
- 作业输入与搜索的 `name`、状态文案、关键 `aria-*` 契约与配置 key 保持稳定；执行参数中编队与执行方式使用共享 `SegmentedControl`（`role="group"` 与 `aria-pressed`），难度为下拉框，字段语义不变；DOM/CSS 类名随布局调整。作业输入与搜索在前，队列卡居中，执行参数在后，窄容器按阅读顺序纵向排列。
- 页面壳不包含业务状态机；工作区是唯一领域容器，面板只接收投影。

### 2. 组合与状态边界

```
CombatTasks（app-page > app-stack-section > CombatWorkspace）
└─ CombatWorkspace（模式、配置、预览/搜索、执行、选择、同步反馈、重置弹层）
   └─ SegmentedTabs（模式受控上下文）
      └─ DeviceMonitorLayout(standard)（main + monitor）
         ├─ CombatModeTabs（共享 SegmentedTabNav + 高亮）
         ├─ CombatExecutionProgressPanel（本次执行条目位置 / 关卡 / 已用时）
         ├─ CombatExecutionStatusPanel（特殊 tab 等待续跑 / 跨 tab 终态结果）
         ├─ SegmentedTabPanel(copilot)
         │  └─ CombatCopilotTaskPanel（普通作业卡）
         │     ├─ CombatCopilotSourceBar（CombatCopilotInputPanel + CombatCopilotDiscoveryDialog）
         │     │  ├─ CombatCopilotInputPanel（作业链接输入 + JSON 导入图标 + 识别方式下拉 + 预览 / 加入队列 / 发现 / 说明）
         │     │  └─ CombatCopilotDiscoveryDialog（关键词 + 关卡 + 干员 + 排序 + 视图 + 匹配）
         │     │     ├─ CombatCopilotSearchBar / CombatCopilotStageSelect
         │     │     ├─ CombatCopilotDiscoveryCard（网格/列表）
         │     │     ├─ CombatCopilotOperatorFilterDialog（包含/排除）
         │     │     └─ CombatCopilotMatchDialog（匹配模式）
         │     ├─ CombatCopilotQueuePanel（唯一作业列表）
         │     ├─ CombatCopilotDetailLayer（预览 / 队列行详情 / 作业集摘要）
         │     └─ 参数区：CombatSettingsPanel → CombatAdvancedFields
         ├─ SegmentedTabPanel(ssscopilot | paradoxcopilot)
         │  └─ CombatSpecialTaskPanel（保全派驻 / 悖论模拟卡）
         │     ├─ CombatAdvancedFields
         │     ├─ CombatParadoxSearchPanel（悖论干员搜索）
         │     └─ 执行/参数概览
         └─ DeviceMonitorPanel（monitor 列，共享实时会话）
```

- 模式 tab 使用 `combat-mode-tab-*` 与当前渲染面板的 `combat-mode-panel-*` 建立 `aria-controls`/`aria-labelledby` 配对；默认卸载的隐藏模式不输出 `aria-controls`，因此每个渲染出的 `aria-controls` 都指向存在的元素。方向键/Home/End 只移动 roving focus，Enter/Space 或点击才切换。`copilot` 与特殊任务面板使用默认卸载，切换作业类型时卡片 DOM 卸载；活动状态仍只由 `CombatWorkspace` 的 `activeCombatMode` 决定。
- 工作区网格与设备画面由 `DeviceMonitorLayout(standard)` 持有：模式导航、执行进度与当前模式面板进入 main 列，`DeviceMonitorPanel` 位于 monitor 列；页面不再声明 `combat-workspace-grid` 或 monitor aside，设备画面类名与样式归 device-mirror 域。作业页改用 `DeviceMonitorLayout(standard)` 后，standard monitor 在内容宽度超过 48rem 且视口小于 1360px 时使用 `max-width: 48rem` 并居中；这是标准化后的有意变化，1280 视口已有几何断言覆盖。

| 状态 | 所有者 | 切换作业类型 | Activity 隐藏/恢复 | 真正卸载/刷新 |
| --- | --- | --- | --- | --- |
| 当前作业类型 | `CombatWorkspace` | 改变展示卡片 | 保留 | 回到 `copilot` |
| 配置草稿、pending 与提交队列 | `user-config` 协调器 | 不重建 | 保留；不重新读取已 hydrate 的草稿 | 应用级通道继续持有 |
| 预览对象、loading、请求代次 | `CopilotPreviewSession`（工作区实例） | 保留；卡片重建不取消当前预览 | `stop()` 取消在途读取、保留已显示预览；恢复不自动重放 | 新会话；预览清空 |
| 关键词、关卡、排序、识别方式、悖论搜索词 | 工作区创建的面板会话存储 | 保留（存储不随弹窗/卡片卸载） | 保留 | 重置 |
| 干员包含/排除与启用状态、匹配模式、视图 | 工作区 store + `la-pluma-copilot-operator-filter-v1` / `la-pluma-copilot-operator-match-v1` / `la-pluma-copilot-discovery-view-v1` | 保留 | 保留 | 从界面偏好恢复 |
| 关卡目录与持有干员快照 | `copilotStageCatalogQueryOptions` / `operBoxQueryOptions`（工作区订阅） | 保留缓存 | 保留；不自动重放 | 重新读取 |
| 本地作业文件导入（选择文件或粘贴 JSON 文件）在途 | `CombatWorkspace` 本地状态 + ref | 保留 | 保留 | 重置 |
| 显式搜索结果、loading、失败原因、取消代次 | `useCopilotSearch`/`useParadoxSearch`（工作区实例） | 关闭发现弹窗时清空显式结果与失败原因 | 清理取消在途搜索；恢复不自动重放 | 重置 |
| 默认发现列表缓存、后台刷新与失败原因 | `useCopilotSearch` 的默认 Query（工作区实例） | 保留 | 清理取消在途刷新；恢复不自动重放 | 页面挂载时重新预取 |
| 作业队列条目与勾选 | `useCopilotQueue`（工作区实例）+ `localStorage['la-pluma-copilot-queue-v1']` | 保留 | 保留；条目已持久化，勾选为会话状态 | 从本地存储恢复条目并全选 |
| 详情层打开项 | `CombatCopilotQueuePanel` 局部状态（按队列条目 id） | 重置 | 保留 | 重置 |
| 作业集待执行索引 | `CombatWorkspace` 本地状态 + `copilotSetSelections` 配置 | 保留 | 保留 | 重置；预览成功后按计划进度恢复并同步到作业队列 |
| 本次作业集 Run 投影、停止/继续确认 | `useCombatExecution` + `task-execution` 控制器 | 保留 | 计时器停止/重建；运行身份不变 | 控制器按持久化身份恢复 |
| 队列 Run 投影、继续/跳过在途 | `useCombatExecution` + `task-execution` 控制器 | 保留 | 按同一 Run 身份恢复；continue/skip 在途标记重置 | 控制器按持久化身份恢复 |
| 页面级等待投影与终态结果 | 工作区组合 `deriveCopilotSetView().waitingEntry`/`queueRun.waitingForNext` 与 `useCombatExecution().terminalResult` | 保留 | 保留；等待与结果始终从当前 Run 投影读取 | 新提交开始时清空结果；未观察活动态的终态恢复不生成结果 |
| 队列提交批次（本次已提交） | `CombatWorkspace` 本地状态 | 保留 | 保留；不再用于队列 Run 的逐项状态 | 重置 |
| 重置进度弹层与在途标记 | `CombatWorkspace` | 保留 | 保留 | 重置 |
| 续跑/失败/下一关视图 | `deriveCopilotSetView` 每次渲染派生 | — | — | — |

- **配置只有一个订阅。** 工作区调用一次 `useUserConfig(combatConfigAdapter)`，把草稿字段与更新回调传给卡片；面板不直接调用 `saveUserConfig`/`loadUserConfig` 或写配置 localStorage；队列持久化只由 `useCopilotQueue` 负责。
- **配置读取门控。** 工作区消费 `loadState`/`loadError`/`reload`：`idle`/`loading` 渲染固定高度的加载面板，`failed` 且无本地草稿时渲染错误面板与「重新加载」按钮，重试走 `reload({ force: true })` 而不是保存重试 `retry`；只有 `loadState === 'ready'` 才渲染编辑器与执行入口，配置读取中/失败时设备画面仍通过 `DeviceMonitorLayout(standard)` 保留，`ConfigLoadCard` 位于主列。未 ready 时配置更新与终态 reconciliation 不推进草稿 revision，避免把默认草稿当成可编辑或可执行配置。
- **预览/搜索/执行各只有一个实例。** 工作区调用一次 `useCopilotPreview`、两个搜索 hook 与一次 `useCombatExecution`；卡片拿到的都是投影与动作，不创建第二份状态机。
- **队列选择与作业集选择分开。** `useCopilotQueue` 持有队列条目与勾选，列表勾选、排序与执行都读它；`selectedCopilotIndexes` 只在预览作业集时恢复计划待执行项，并通过 `syncQueueSet` 同步到队列，不再直接驱动列表行。
- **详情层不复制业务状态。** 打开项只记队列条目 id；详情目标每次由条目静态字段、`queueRun.statuses`/`queueRun.summaryErrors`、`itemStatuses` 与 `itemErrors` 派生，条目被删除或预览重建后找不到时关闭，不切换到同索引的其他作业。
- **模式不持久化。** `activeCombatMode` 不进入配置、Query、localStorage 或 URL。

### 3. 局部状态与渲染隔离

`model/panelState.ts` 提供最小的会话存储：`get`/`set`/`subscribe`，相同值不通知。工作区用 `useState` 创建十个 store：

| store | 订阅方 | 工作区写入点 |
| --- | --- | --- |
| `copilotPreviewMode` | `CombatCopilotSourceBar` | 无；工作区在预览时读取当前值 |
| `copilotSearchKeyword` | `CombatCopilotDiscoveryDialog` | 无；弹窗内输入 |
| `copilotSearchLevel` | `CombatCopilotDiscoveryDialog` | 无；关卡筛选器写入 |
| `copilotSearchOperators` | `CombatCopilotDiscoveryDialog` | 无；包含/排除弹窗写入 |
| `copilotSearchOperatorsEnabled` | `CombatCopilotDiscoveryDialog` | 无；干员按钮内的电源开关写入 |
| `copilotSearchOperatorsRemember` | `CombatCopilotDiscoveryDialog` | 无；确认筛选时写入 |
| `copilotSearchOrder` | `CombatCopilotDiscoveryDialog` | 无 |
| `copilotSearchMatch` | `CombatCopilotDiscoveryDialog` | 无；匹配设置写入 |
| `copilotSearchView` | `CombatCopilotDiscoveryDialog` | 无；网格/列表切换写入 |
| `paradoxSearchName` | `CombatParadoxSearchPanel` | 无 |

工作区本身**不订阅**这些 store，因此：

- 在发现弹窗输入关键词、切换关卡/干员/排序/视图/匹配，或输入悖论干员名、切换识别方式时，只重渲染对应面板/弹窗；作业队列、配置表单与另一张作业卡不重渲染。
- 工作区挂载即后台预取默认发现列表；打开弹窗时只重置关键词/关卡/排序并触发一次后台刷新，首次打开按需读取关卡目录与持有干员快照，不在来源栏内联搜索。
- 输入变化仍调用搜索 hook 的 `cancel()` 取消在途的显式搜索；默认列表的后台刷新不会被输入或显式搜索打断，也不覆盖显式搜索结果；旧响应只写旧 key。
- 点击搜索结果只打开该条目的详情预览，不改写配置输入、不写入任何会话选中态；预览读取本身需要工作区更新，属于相关更新。
- 切换作业类型会卸载卡片 DOM，但 store 由工作区持有；识别方式与干员/匹配/视图界面偏好保留，关键词/关卡/排序在下次打开发现时重置。

回归：`CombatTasks.test.tsx` 的 “keeps the set list out of local search and recognition-mode renders” 用列表组件渲染计数验证输入不推动列表；同文件的模式切换用例验证局部状态跨卡片卸载保留。`panelState.test.ts` 覆盖通知、相同值与退订。

### 4. 作业集视图派生

`model/copilotSetView.ts` 把三份事实合成面板共用的只读视图：

| 规则 | 行为 |
| --- | --- |
| Run 归属 | 只有 `setRun.setId === preview.id` 且未被重置进度作废（`dismissedRunId`）的 Run 才提供逐项结果 |
| 待执行 | 页面选择减去已满足当前 raid 完成条件的作业（持久化 `completedModes` ∪ 本次成功条目的模式）；失败与未开始保留 |
| 完成条件 | 当前 raid 要求的每个模式都被覆盖才算完成；普通成功、突袭待执行时作业仍是待执行。成功条目的 `mode` 缺失或无法识别时不归属任何模式，保持待执行 |
| 失败/终止/已执行 | 失败、已终止与跳过分别计数，主动终止不计入失败；已执行按条目统计到作业，全部模式跳过或待执行的不计 |
| 下一关 | 仅在 `isWaitingForNext` 且非 `isAutoStopping` 时展示；等待项与作业详情来自服务端投影 |
| 续跑目标 | 等待项索引优先，否则第一个待执行索引，否则 `-1` |
| 续跑/当前项投影 | 优先 Run 当前项，其次续跑目标，否则第一个作业；越界回退第一个作业，供摘要与详情层回退 |
| 完成计数 | `max(0, 选择数 - 待执行数)` |

模型不访问 React、Query、配置通道或执行控制器，规则由 `copilotSetView.test.ts` 直接覆盖。

队列同步与视图输入：

- 预览作业集成功后，工作区调用 `syncQueueSet(setId, buildCopilotQueueEntries(preview), checkedIndexes)` 把计划成员写入唯一队列。同一 `setId` 的既有条目按 `setItemIndex` 复用 id 与加入时间，新成员块放回该 `setId` 原先在队列中的位置，其他来源的条目不动；全部合并结果再按 URI 去重并裁剪到 50 项。
- `checkedIndexes` 来自计划中仍待执行的索引或本页已恢复的选择；历史已通关成员保留在队列中但不勾选，执行时不会被提交。
- `deriveCopilotSetView` 的 `selected` 参数由队列中属于当前作业集且被勾选的 `setItemIndex` 组成；摘要计数、逐项状态与 set-backed 执行判定都消费同一份队列选择。

### 5. 搜索、执行与页面路径

- **默认列表**：进入作业页后由默认 Query 在后台预取热度列表并缓存；打开发现先渲染缓存，再后台刷新同一请求 key，刷新期间不显示 loading、不阻塞输入，失败时保留缓存但显示弹窗内错误与重试，不把旧缓存当作当前结果。关键词、关卡与排序在打开时重置，干员包含/排除、匹配模式与视图按界面偏好恢复。
- **搜索选择**：发现弹窗以关键词（`document`）、关卡（`level`）、干员包含/排除（`operator`，排除项 `~` 前缀）与排序（`hot`/`latest`/`views`）请求作业站；关键词输入框右侧的清除按钮只在有关键词时出现，点击即清空关键词、取消在途搜索并保持焦点在输入框，不自动重搜；点击卡片只打开该条目的详情预览，`copilot.uri` 保持用户输入的原值，推荐标记帮助定位结果。列表条目已带说明、干员练度与分组，点击即以条目数据打开抽屉，随后的详情读取用于校验与补齐；详情未回来前抽屉先出壳与加载态，不用空白等待。卡片不再持有选中态，因此也没有“已选中”标记或高亮；重复点开同一条目只是重新读取详情。弹窗保持打开，详情抽屉以 Sheet 叠在其上（React 嵌套 Dialog，Base UI 管理焦点层序与 Escape 层级）；关闭抽屉后仍停留在原结果列表。结果的「加入队列」动作按 URI 读取作业信息后加入队列。匹配模式只过滤当前已加载结果，不改变服务端排序或结果总数。结果按 `page`/`limit` 分页：首屏请求 30 条，正文滚动近底且 `hasNext` 为真时追加下一页并按 URI 去重合并；新的关键词、关卡、干员或排序搜索丢弃已追加页，「已加载」显示合并后的数量。
- **JSON 作业导入**：链接输入框内的 JSON 导入按钮读取本地 JSON 文件；从文件管理器复制 JSON 文件后在输入框粘贴，文件交给同一导入通道。两条路径都提交 `POST /api/copilot-files`，成功后清空旧预览，并把 `doc.title`、`opers`、`groups` 解析成队列条目的标题与干员信息，关卡优先使用上传响应里的 `stage`/`stageId`（服务端按资源解析出的代号与原始标识），缺失时才回退文件里的 `stage_name`；解析失败仍按导入文件名入队，上传接口拒绝非法 JSON 时提示错误且不加入队列。本地文件与从作业站加入的单条作业都按与服务端一致的规则判定预设编队（无 `opers`/`groups` 且 `stage_name` 匹配 `_s<数字>` 结尾），命中时队列条目带 `presetFormation`，全局突袭设置下仍按普通模式提交。输入框只承载作业链接与 JSON 文件粘贴，不再接受服务端可见的文件路径。队列 Run 提交 `source: 'file'` 与服务端受管路径，由服务端重新读取受管文件并写入队列计划目录；受管路径不参与 PRTS 预览。
- **执行设置**：页面提供连续执行与手动逐关，旧配置的 `app` 与 `cli` 都映射到 `continuous`，`manual` 保留逐步等待。难度选择 `auto` 时，作业集计划与显式队列由服务端读取作业的 `difficulty`；预览和详情保留可用的标注。手动指定难度使用用户的选择。单作业且队列为空时，只对队列/作业集生效的「执行方式」与高级设置中的「队列策略」不渲染；队列非空或预览作业集带成员时恢复显示。隐藏只影响渲染，已保存的 `executionStrategy` 与执行方式仍随配置提交，不清空。
- **队列执行**：只勾选当前预览作业集的成员，且其 `setItemIndex` 严格递增时，走作业集提交（`submitSet` → `run_copilot_set`）：连续模式一次提交整组，手动模式等待服务端 `nextEntry`；`selectedIndexes` 来自队列勾选。混合来源、重排后的集合成员或本地文件走 `submitQueue` → `run_copilot_queue`。客户端按队列顺序提交 `{ clientId, source, copilotId|filename, mode }`，每个作业的 `mode` 来自全局突袭设置，预设编队作业提交 `normal`。服务端将适用的 `both` 展开为普通和突袭两个步骤。`executionStrategy` 映射为 `failurePolicy`：`stop` 首败停止，其他值按 `continue`。队列非空时卡片头部「立即执行」仍执行已勾选队列，按钮下方提示「将执行已勾选队列（N 项）」；无勾选时提示先勾选；运行、等待下一项或提交在途时不显示该提示。
- **停止/继续/跳过**：队列 Run 的停止复用 `stop()`；manual waiting 时「开始下一项」调用 `continueCopilotQueue`，「跳过此项」调用 `skipCopilotQueueEntry`，两者都只针对当前 `runId`，不新建 Run。重试按原 Run 的失败步骤确定作业和模式，已成功的模式不会随该作业重试。
- **等待态跨 tab 继续**：manual 作业集或队列进入等待后，普通作业 tab 的「开始下一关」「开始下一项」「跳过此项」仍由 `CombatTaskHeading` 与 `CombatCopilotQueuePanel` 提供；切到保全派驻或悖论模拟时，由页面级 `CombatExecutionStatusPanel` 提供同一动作，动作仍经工作区 handler 调用 `continueSet`/`continueQueue`/`skipQueueEntry`，不新建 Run。作业集等待仍以 `deriveCopilotSetView().waitingEntry` 为准，保留预览归属、重置作废与 `isAutoStopping` 过滤；异集合等待不显示「开始下一关」或「下一关」。页面级等待区只提供继续/跳过，不重复渲染「终止执行」（终止仍只由当前卡片头部提供）；普通作业 tab 不渲染页面级等待区，避免与卡内/队列面板控件重复。
- **终态结果常驻**：`useCombatExecution` 在宣告本页观察到的终态 Run 时同步生成 `terminalResult`（`runId`/`state`/`message`/`type`），页面级状态区在所有 tab 显示，使用 `role="status"` 与 `aria-label="本次执行结果"`，不提供重新执行按钮；运行中或等待中不显示旧结果，新提交开始时清空。Toast 仍按原通知路径保留，Run 终态契约不变；`CombatExecutionProgressPanel` 仍只显示条目位置、关卡、模式与已用时，不承担等待或终态文案。
- **逐项结果**：set-backed 执行读取 `CopilotSetView.itemStatuses`。队列 Run 读取 `CopilotQueueRunProjection.statuses`，优先于作业集投影。同一 `clientId` 的普通与突袭步骤归到同一队列行。队列 Run 的 `summary.taskResults` 是逐项状态的唯一来源，`summary.errors` 只用于补全缺失的失败原因。
- **本次执行与续跑进度分工**：`CombatExecutionProgressPanel` 只显示本次执行队列中的条目位置（`progress.currentStep`/`totalSteps`）、当前关卡、执行模式与已用时，按“项”而不是“关”表述；both 展开的普通与突袭共用同一关卡名，模式取自当前执行条目的 `mode`（作业集读 `progress.currentEntry`，队列读该 `clientId` 的执行中逐项结果），等待下一项与单作业执行时不显示；运行状态与停止按钮留在执行卡片，逐项结果、历史通关与计划状态计数留在作业列表与续跑进度，不重复呈现。
- **重置进度**：确认后调用 reset 端点、把全部索引放回待执行、归零预览进度、失效该作业集计划缓存，并作废旧 Run 的逐项展示。

### 6. Activity 与卸载

- **Activity 隐藏/恢复**：搜索 hook 的清理取消在途 Query，预览会话 `stop()` 取消在途读取并保留已显示预览，执行 hook 清理停止确认与继续/跳过计时器，共享 `SegmentedTabNav` 清理 `ResizeObserver`/resize 监听；工作区与面板 state 保留。恢复时不自动重放搜索/预览/提交，Query 缓存按新鲜度复用，后台 Run 身份不变。
- **队列执行**：队列 Run 与作业集 Run 都由 `task-execution` 控制器观察；隐藏/恢复只重建观察，继续或跳过在途标记不带到新 Run，等待态与逐项结果始终从当前 Run 投影重新读取。
- **切换作业类型**：卡片 DOM 卸载，面板会话存储与工作区预览/搜索/执行实例保留；返回时输入与识别方式恢复。
- **真正卸载/刷新**：工作区与面板 store 销毁，搜索词/识别方式/搜索结果/选中索引/弹层重置；配置草稿、pending 队列和 Run 身份仍由应用级所有者持有，重新挂载后继续使用。

### 7. 兼容与视觉约束

- 既有端点、Query key、配置 key、既有本地存储键、pending 标记与 wire 形状均未变化；新增的 `la-pluma-copilot-queue-v1` 只保存本页作业队列，`/api/copilot-files` 只服务来源栏的 JSON 导入（文件选择或粘贴 JSON 文件），`/agent/copilot-queues/*` 与队列 continue/skip 只服务 Web UI 队列 Run，旧本地草稿与服务端配置可直接读取。
- 服务端执行参数、作业集模式映射、幂等键与停止语义未变化；队列 Run 使用 `run_copilot_queue` 独立操作名与 `copilot-queue` 任务类型，不改变 `run_copilot_set`。
- 保持作业输入/搜索的 `name`、状态文案与关键 `aria-*` 契约；队列面板不再有独立「执行队列」按钮，执行入口回到作业卡头部；DOM/CSS 类名和默认态视觉随卡片布局调整，但交互与局部状态边界由下列回归测试覆盖。
- 页面视觉回归入口见[开发指南](../../development/README.md)；面板行为与订阅隔离由下列回归测试覆盖。

## 搜索与预览

它把普通搜索、悖论搜索、单作业详情与作业集详情的读取从页面状态机移到 `combat` 域 Query 与预览会话；执行提交、运行观察与停止仍由 `task-execution` 控制器持有，配置草稿仍由 `user-config` 协调器持有。页面组合与面板边界见[作业领域面板](#页面与面板)。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 搜索/详情/计划的只读端点、载荷解析与 query key | `features/combat/model/queries.ts`、`queryKeys.ts`、`copilotPayload.ts` | 只保存服务端只读资源；不写执行状态 |
| 搜索的提交与取消语义 | `features/combat/hooks/useCopilotSearch.ts` | 搜索请求（关键词/关卡/干员/排序/分页）由发现弹窗通过工作区会话存储组装；hook 提供默认请求预取、后台刷新、显式搜索的代次与取消 |
| 预览请求裁决与当前展示 | `features/combat/model/copilotPreviewSession.ts` + `hooks/useCopilotPreview.ts` | 计划优先、成员回退、旧响应裁决、Activity 取消 |
| 预览目标与展示对象构造 | `features/combat/model/copilotPreview.ts` | 单作业/作业集/旧探测与提示文本 |
| 作业集选择 | `features/combat/model/copilotSelection.ts` | 序列化、待执行求差、按计划进度恢复 |
| 命令与执行选项 | `features/combat/model/combatCommands.ts` | 参数表、编队/突袭规则、输入校验、set 模式映射 |
| URI/输入归一 | `features/combat/utils/copilotUri.ts` | 纯 URI/输入模型，不访问网络 |
| 运行身份、提交/停止/继续 | `features/combat/hooks/useCombatExecution.ts` + `task-execution` | 搜索/预览生命周期不控制后台运行 |
| 配置草稿与 `copilotSetSelections` | `features/user-config` + `model/combatConfig.ts` | 选择写入仍走 300ms 去抖协调器 |

维护约束：

- 不以搜索/预览的资源生命周期启动、停止或恢复后台 Run。
- 不改变服务端端点、存储 key、配置 wire 或页面布局。
- 不把搜索/预览结果复制进 Zustand 或执行控制器。

### 2. 资源与缓存身份

资源 key、参数清单与缓存数值以[Query 缓存与键规范](../../architecture/query-cache.md)为准；本域读取顺序与显式刷新语义如下。

| 资源 | 端点与参数语义 | 域内读取策略 |
| --- | --- | --- |
| 普通搜索 | `GET /agent/copilot/search?document=&level=&operator=&orderBy=&page=&limit=`；`operator` 以逗号分隔、`~名称` 表示排除，服务端透传作业站 | 默认请求在进入作战页时预取并缓存 5 分钟；打开发现后台刷新且不进入显式 loading；每次显式搜索重读，关键词变化取消，失败时在弹窗内显示错误与重试（Query 缓存保留，但错误期间不渲染旧结果）；筛选/排序变化也会重读 |
| 关卡目录 | `GET /agent/copilot/stages`，服务端缓存的作业站关卡目录 | 发现弹窗首次打开时读取，30 分钟内复用；失败可重试 |
| 悖论搜索 | `GET /agent/paradox/search?name=`，已提交的干员搜索词 | 同上 |
| 单作业详情 | `GET /agent/copilots/:id`，PRTS 作业 id | 预览按钮复用新鲜缓存 |
| 作业集成员 | `GET /agent/copilot-sets/:id`，作业集 id | 仅在计划不可用/为空时读取，复用新鲜缓存 |
| 作业集计划 | `GET /agent/copilot-sets/:id/plan?raid=`，作业集 id 与 normal/raid/both 模式 | 计划优先；Run 终态刷新强制重读 |

关键规则：

- **key 只放影响响应的输入。** 识别方式（自动/单个/作业集）、预览按钮、选中索引与搜索框的未提交文字都不进入 key。
- **搜索请求是缓存身份。** 关键词、关卡、干员包含/排除、排序与分页共同组成 key；旧 key 的迟到响应只能写入旧缓存，当前页面只读新 key。
- **预览不建立第二份 key。** 组合读取通过 `fetchQuery` 使用上面的资源 key，不额外缓存“预览结果”。预览当前展示哪一次请求由会话裁决。
- **不轮询。** 搜索与预览都没有 `refetchInterval`；Activity 显示时按 Query 默认新鲜度重取，不自动重放用户操作。
- **写后只失效受影响的 key。** 重置进度成功后失效该作业集的 `copilot-set-plan` 前缀；作业集 Run 终态后的进度刷新把新计划写回同一 key。PRTS 作业内容没有跨页写入，不需要失效端口。

### 3. 搜索：取消与旧响应

`useCopilotSearch()` / `useParadoxSearch()` 提供相同的协议：

| 动作 | 行为 |
| --- | --- |
| 提交搜索 | 记录本次代次，`fetchQuery` 显式强制重新读取；返回 `success`/`failed`/`cancelled` |
| 输入变化 | 调用 `cancel()`：推进代次并 `cancelQueries(combatKeys.resource('copilot-search'))`；Query 的 `signal` 中止 fetch |
| Activity 隐藏/卸载 | Effect 清理调用 `cancel()`；显示时不自动重放搜索，成功结果仍在 Query 缓存 |
| 旧响应 | 代次不匹配的 Promise 返回 `cancelled`，页面不提示、不自动填充推荐 |

失败分类：

- `ApiRequestError.kind === 'api'` 或 `contract`：直接展示服务端/载荷消息（例如“未找到关卡…”），与迁移前一致。
- `transport` 或未知错误：展示 `搜索失败: <message>`。
- `AbortError`/取消：不展示为失败。

同一提交词再次搜索失败时，Query 保留上一次成功结果，但弹窗不再把它当作当前结果展示，而是在结果区显示错误与「重试」；重试重跑最后一次显式搜索，没有显式搜索时重试默认列表。切换提交词时新 key 没有旧数据，列表清空，同样以错误态代替「暂无作业」。默认列表的后台刷新失败也设置错误并保留旧缓存，重试成功后恢复展示；失败不会覆盖显式搜索结果。错误在取消、重置与成功读取后清空；搜索中优先于旧错误显示占位，避免错误闪回。普通作业搜索的推荐项显示在结果中，点击结果才修改输入并打开预览。

关卡筛选由发现弹窗的关卡目录 Popover 完成：客户端从 `/agent/copilot/stages` 读取服务端缓存的作业站目录（30 分钟 TTL，失败可重试），选中条目后以内部 `stageId` 请求 `/agent/copilot/search?level=`。Popover 是非模态的（`role="dialog"`、`aria-label="选择关卡"`），打开后焦点进入搜索框；外部点击或 Escape 关闭并把焦点还给触发器，Escape 先关 Popover 再关发现弹窗。面板经 Base UI portal 挂到 `document.body`，不受 Dialog 滚动体裁剪，宽度与视口碰撞留白由原语处理。选项对 `code`/`name`/`zone` 去重后展示，首次渲染 50 条并在滚动近底时继续追加，直到全部过滤结果都可访问；客户端不再维护本地关卡表，也不在结果上方展示候选关卡。服务端仍保留 `level` 的 code/name 解析与 400 `AGENT_COPILOT_STAGE_AMBIGUOUS`（`details.candidates`）、404 `AGENT_COPILOT_STAGE_NOT_FOUND`、502 `AGENT_COPILOT_STAGE_CATALOG_UNAVAILABLE`，供其他调用方使用；目录只参与展示投影：服务端用已缓存快照同步返回搜索结果，目录刷新在后台完成，因此冷缓存的首次搜索可能缺少 `stageCode`/`stageLabel`，后续搜索补全；目录查不到时搜索结果仍成功返回。

### 4. 预览：会话与取消

`CopilotPreviewSession` 是预览的唯一请求入口：

| 能力 | 行为 |
| --- | --- |
| `load(input, mode, raid)` | 解析目标 → 取消上一次读取 → 设置 loading → 组合读取；只有仍当前的结论写入状态 |
| `refreshSet(setId, raid)` | 作业集 Run 终态后的静默强制重读（`force: true`）；只在当前预览仍是同一作业集时合并 `copilots`/`currentIndex` |
| `resetProgressView(setId)` | 重置进度成功后只把当前预览的 `currentIndex` 归零，不伪造服务端计划 |
| `clear()` | 输入变化、导入成功或替换搜索目标：取消在途读取并清空预览 |
| `cancel()` | 识别方式切换等场景：取消在途读取，保留已显示内容 |
| `start()` / `stop()` | 对应 Activity 显示/隐藏或真正卸载；停止时取消本地等待并结束 loading，恢复不自动重放 |

请求裁决：

- 每次读取递增 request id 并创建 `AbortController`；旧请求的 Promise 即使成功也返回 `cancelled`。
- 组合读取把实际使用的精确 Query key 登记到会话；取消时对每个 key 调用 `cancelQueries({ exact: true })`，Query 的 `signal` 中止 fetch。
- `stop()` 与 `clear()` 只取消本地读取，不调用停止端点，不影响后台 Run。

读取顺序与失败语义：

1. 作业集：计划优先。计划成功后直接构造成员列表。
2. 计划接口失败或返回空 `items`：回退成员列表 + 并发单作业详情；单个详情失败保留 `prts://<id>` 占位，仍可执行。
3. 计划与成员列表都失败：返回 `failed`；页面按失败类型展示消息（transport/unknown 前缀“网络错误:”）。
4. 读取成功但没有成员：返回 `empty`，页面提示“作业集不存在或为空”。
5. 单作业：详情 `status_code=200` 且可解析才展示；否则 `empty`（“作业不存在”）。
6. 旧探测：仅“自动”模式且原始输入不是 `prts://` 开头时（例如 prts.plus 链接）同时读取单作业与成员，作业集优先；保留 404/400 组合的“按作业集处理”兜底。

与迁移前的一处明确差异：**请求/服务端失败不再伪装成“作业不存在”**。旧页面把 `readApiResponse` 的失败信封也当作空内容；现在单作业/作业集在计划与成员都失败时显示网络或服务端消息。成功但为空的响应仍显示“不存在/为空”。搜索的失败分类见第 3 节；`cancelled` 始终静默。

### 5. 选择、配置与执行接线

- 工作区仍持有 `selectedCopilotIndexes`，作为预览恢复与同步队列勾选的来源；实际执行读取 `useCopilotQueue` 的条目与勾选。`copilotSetSelections[setId]` 仍由 `user-config` 协调器持久化，本地键与 wire 形状不变。
- `serializeCopilotSelection` 去重、丢弃非整数并升序；`selectedCopilotItemIndexes` 把选择裁剪到当前列表；`pendingCopilotItemIndexes` 从页面选择中减去已满足当前 raid 完成条件的作业。
- 预览成功（作业集）后按服务端计划进度恢复选择：`restorableCopilotIndexes` 以计划中“仍待执行”的索引为全集；没有保存过选择时使用全部待执行项，保存过则求交。预设编队只要求普通模式，突袭/两者按作业支持的模式判断。恢复结果通过 `syncQueueSet` 写入队列勾选。
- 作业集 Run 终态后 `refreshSet` 强制重读计划并合并逐项结果，页面再用同一纯模型恢复选择并同步队列；失败只影响展示，不把 Run 结果解释成完成。
- 重置进度成功后：全部索引进入待执行、预览 `currentIndex` 归零、失效该作业集的计划缓存，队列同步回到全选待执行。
- 提交：单作业/SSS/悖论走 `buildCombatCommandArgs`；作业集走 `buildCopilotSetExecutionOptions` + 选中索引。队列执行先判断选中项是否全部来自当前预览作业集且索引递增：是则走同一作业集提交，否则把选中条目按队列顺序映射为 `run_copilot_queue` 的 `entries`，`executionStrategy` 映射为 `failurePolicy`，Web UI 固定 `waitForCompletion:false` 后由 Run 观察。`app`/`cli` 都映射为服务端 `continuous`，`manual` 保留逐关等待。空值、未勾选 checkbox 与无参数名的策略项不写入命令。
- **搜索缓存与执行状态分开。** 搜索/预览只读写 Query 与预览会话；队列只读写 `useCopilotQueue` 与本地存储；执行只读写 `task-execution` 控制器。搜索失败、切换搜索词或 Activity 隐藏都不会停止、重启或重提 Run。

### 6. 兼容格式

| 载荷 | 兼容处理 |
| --- | --- |
| PRTS 代理 | 接受 `{ success, data }` 信封与直接的 `{ status_code, data }` 对象；`content` 可为 JSON 字符串或已解析对象；服务端追加的 `stage`/`stageId` 投影优先于 `stage_name` |
| 单作业内容 | `doc.title` 缺失回退“未命名作业”；`opers`/`groups` 拼成“名字、[组名]”；无展示项为“未知” |
| 作业集成员 | `data.copilot_ids` 接受数字或数字字符串；丢弃 0、负数、小数与重复项 |
| 作业集计划 | `items` 与 `entries` 必须同时存在；`completed` 条目按 `itemIndex` 折叠为 `completedModes`；`stage` 缺失时名称回退“作业 #id” |
| 搜索结果 | 接受信封/原始载荷；缺 `uri` 的条目丢弃；`recommended` 只有带 `uri` 才显示推荐；`views`/`hotScore` 缺失按 0 |
| 作业队列存储 | `la-pluma-copilot-queue-v1` 只接受 `{ version: 1, entries: [...] }`；版本不符或 JSON 损坏返回空队列；逐项校验必填 `id`/`uri`/`source`，丢弃重复 URI，截断到 50 项 |
| 本地作业元数据 | 文件选择或粘贴 JSON 文件的 `doc.title`、`stage_name`、`opers[].name`、`groups[].name` 缺失或非字符串时按缺省处理；上传响应的 `stage`/`stageId` 缺失时回退 `stage_name`；解析失败仍以导入文件名为标题入队，不影响受管路径执行 |
| 队列 Run 执行 | 请求体 `{ queueId?, name?, mode?, failurePolicy?, entries[], options?, waitForCompletion? }`；`entries` 为 1–50 项且 `clientId` 唯一；响应同作业集信封，新增 `queueId`/`summary`/`nextEntry`；客户端按 `clientId` 合并 `taskResults`，不按数组下标猜测状态 |
| 队列 Run 继续/跳过 | 两者只接受 `operationId=run_copilot_queue` 且 `state=waiting` 的 Run；`MAA_EXECUTION_BUSY` 保持 waiting，`AGENT_COPILOT_QUEUE_SESSION_LOST` 需要重新提交，终态继续返回 `alreadyTerminal` |
| 旧探测 | `prts://<id>` 的“自动”模式按单作业处理，不会猜测同 id 作业集；prts.plus 链接继续探测 |
| 执行 | raid `1`/`2` 规范化为 `raid`/`both`；未带 s 前缀的作业集在预览与执行时补 `prts://s<id>` |

服务端端点保持兼容；配置 key、本地存储键、pending 与 wire 形状由[配置持久化协调器](../../architecture/config-persistence.md)统一定义。搜索与预览应继续经过领域 Query 和预览会话，不在页面重建请求状态机。

### 7. Activity 与卸载

- Query 观察者随 Effect 清理注销；在途读取通过 `signal` 取消，缓存保留并按 `gcTime` 回收。
- 预览会话 `stop()` 取消在途读取并结束 loading，保留已显示预览；恢复 `start()` 不自动重放。
- 作业队列由 `useCopilotQueue` 在初始化时读取本地存储，条目随操作同步写回；Activity 隐藏保留队列与勾选，真正刷新后重新读取条目并默认全选。
- 详情层的选择由工作区持有；关闭抽屉保留已解析的预览，输入变化或导入成功会重置对应内容。
- 搜索 hook 在清理时取消在途搜索；恢复后不自动重放，成功结果仍可从 Query 缓存读取。
- 真正卸载后重挂载会重置搜索词、识别方式与预览选择（队列条目从本地存储恢复并全选）；Query 缓存若仍新鲜可直接复用。切换作业类型只卸载卡片 DOM，工作区持有的面板会话存储会保留这些局部输入。
- 后台 Run 与配置提交不依赖本页 Activity；隐藏不会改变运行所有权。

## 回归与关联

### 回归测试

以下路径相对于 `apps/web/src/`：领域回归在 `features/combat` 与 `pages/combat`；入口命令见[验证命令](#验证命令)。

关键不变量：

- 搜索/预览旧响应裁决：代次与 request id 不匹配一律静默返回 `cancelled`，取消经 tracked key 精确中止在途 fetch；请求/服务端失败显示网络或服务端消息，不再伪装成“作业不存在”。搜索失败在弹窗内显示错误与重试，不回落旧结果、默认列表或空态；持有干员读取中或失败时卡片标记「拥有状态未知」，匹配弹窗显示加载或失败与重试。
- 预览读取顺序：作业集计划优先、失败回退成员列表；`empty` 只用于成功但为空的真实内容。
- 作业集视图：Run 归属与重置作废、待执行求差、`failed`/`stopped` 计入失败、续跑目标与当前项回退；`app`/`cli` 映射服务端 `continuous`。
- 作业队列：URI 去重、50 项上限、上移/下移与删除只改顺序或成员；作业集同步按 `setItemIndex` 复用既有 id 与位置，历史已通关成员保留但不勾选；本地存储版本不符或损坏时回到空队列。
- 执行路径：仅当前预览作业集的勾选成员且索引递增时走 `run_copilot_set`；混合来源、重排或本地文件走 `run_copilot_queue`（`submitQueue`），同一 Run 返回逐步状态。队列为空时可直接运行输入的单作业，非空队列无勾选时提示选择；队列非空时头部「立即执行」仍执行队列并提示执行目标。单作业隐藏执行方式与队列策略但保留已保存值。
- 队列 Run：`run_copilot_queue` 的 `queueRun.statuses` 按 `clientId` 覆盖行状态，`nextEntry` 驱动 manual 的开始下一项/跳过，终态 `failed` 条目驱动重试失败项；`failurePolicy=stop|continue` 来自 `executionStrategy`，不改变作业集路径。
- 等待与结果：等待态跨 tab 可继续，普通作业 tab 不重复渲染页面级等待区；终态结果跨 tab 常驻且使用 `role="status"`，运行中或等待中不显示旧结果；异集合等待不泄露「下一关」；进度面板职责不变。
- 详情层：上方预览成功或点击队列行时打开同一个详情层。点击列表卡片时抽屉立即用条目数据打开，详情响应到达或失败后清空这份乐观目标；预览成功前先显示抽屉壳与加载态。桌面为非模态抽屉且焦点可归还，手机使用 Sheet 的模态焦点契约。作业集续跑摘要放在详情层，页面只有一个作业列表。
- 局部状态隔离：搜索/识别方式输入不推动作业集列表渲染，面板会话跨卡片卸载保留。

### 验证命令

以下命令均在仓库根目录执行。

```sh
pnpm --filter la-pluma-next-client exec vitest run src/features/combat src/pages/combat
```

完整验证与视觉回归入口见[开发指南](../../development/README.md)。

### 关联契约

- [配置持久化协调器](../../architecture/config-persistence.md)
- [前端执行客户端与控制器](../../architecture/execution-client.md)
- [Query 缓存与键规范](../../architecture/query-cache.md)
- [前端架构与所有权](../README.md)
- [资源请求错误与取消契约](../../architecture/resource-requests.md)
