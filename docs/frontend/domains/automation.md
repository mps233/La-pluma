# 自动化

> [← 返回前端架构](../README.md) · [文档索引](../../README.md)

本文集中维护本领域的面板、模型与命令约定；通用契约通过链接引用。

- [页面、流程与执行摘要](#页面流程与执行摘要)
- [纯模型与排序](#纯模型与排序)
- [任务编辑](#任务编辑)
- [回归与关联](#回归与关联)

## 页面、流程与执行摘要

配置草稿仍由 `automationConfig` 适配器与 `user-config` 协调器持有，
执行仍由 `task-execution` 控制器与服务端 Run 持有；工作区负责
局部交互状态与排序指针生命周期，不新增第二份配置、保存队列或运行
状态机。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 页头、全局状态指示与工作区组合 | `pages/automation/AutomationTasks.tsx` | 只调用 `PageHeader`、`FloatingStatusIndicator` 与 `AutomationWorkspace` |
| 配置订阅、Run 订阅、选中项、撤销、连接测试、跨域失效、任务编辑 | `components/AutomationWorkspace.tsx` | 页面级领域容器；仍调用所属领域 hook，不直接调用 API/存储/轮询 |
| 流程列表、页脚与摘要组合 | `components/AutomationTaskFlowPanel.tsx` | 接收只读 Run 投影、排序投影与配置回调；页脚仍是任务挑选菜单的点击区域 |
| 定时编辑 | `components/AutomationScheduleCard.tsx` | 绑定 `model/automationSchedule.ts`；结果经 `onChange` 交给唯一配置 owner |
| 通知配置读取、草稿与保存 | `components/NotificationSettings.tsx` + `model/queries.ts` | 独立卡片；读取 `notificationConfigQueryOptions()`；保存成功后 `setQueryData` 回写同一 key；脏态、总开关依赖与测试反馈在卡内持有 |
| 最近执行摘要 | `components/AutomationExecutionSummary.tsx` | 只接只读摘要与 run 身份；负责保留最后一份、展开/收起与失败自动展开 |
| 拖拽/键盘排序的 React 接线 | `hooks/useTaskFlowSorting.ts` | 预览、pointer 生命周期、Escape、公告；规则仍来自 `model/taskFlowSort.ts` |
| 活动 DTO 校验 | `model/activity.ts` | 纯函数：校验 `/agent/activity` 的 status/来源时间/failure/completion，不推断活动状态 |
| 逐项执行状态与摘要选择 | `model/flowExecution.ts` | 纯函数：活动期读 `progress`，空闲期回退流程终态摘要，单项状态/文案 |
| 配置提交、pending 与 schedule 完整单元 | `user-config` 协调器 + `automationConfig` 适配器 | 遵循配置协调器契约，维持 key、本地布局、wire 与完整提交条件 |
| 执行提交、观察、停止与旧断点 | `task-execution` 控制器 + `useAutomationExecution` | 面板只读快照；不发送停止以外的执行写操作 |

维护约束：

- 配置 key、pending、本地布局与 wire 形状以[配置持久化协调器](../../architecture/config-persistence.md)
  为准；保持 `/agent/schedules/*`、通知端点和执行协议兼容。
- 通知配置读取属于 automation Query（`['automation','notification-config']`）；保存成功后写回同一 key，不保留模块级永久缓存，也不把服务端配置复制进第二份可写状态。
- 不改变任务参数默认值、智能养成参数、执行前校验顺序或执行身份。
- 遵循既有渲染结构与 DOM/CSS 类名；表单 `id`/`aria-label`、菜单 `id`/`role`、
  焦点顺序与键盘行为保持。
- 任务配置编辑器（通用参数字段、高级设置与连接测试）仍与工作区同文件组合；
  它读取同一草稿、选中项与执行投影，表单结构与参数规则保持不变。


**日常任务参数对齐。** `automationTaskCatalog.tsx` 定义每类任务的默认参数与表单字段，`automationConfig.migrateTaskParams` 在读取本地或服务端旧草稿时补齐缺失字段：

| 任务 | 参数与迁移规则 |
| --- | --- |
| Fight | 临期药使用 `medicineExpireDays`（天数，0 禁用）；旧 `expiringMedicine`（瓶数）在迁移时映射为「两天内过期」的固定窗口（旧 0 保持 0），再删除旧键；新字段已存在时优先沿用新字段。`series` 下拉提供 -1~10，旧资源只接受 -1~6；`-1` 仍以 `--series=-1` 单 token 下发 |
| Recruit | 新增 `level3_recruitment_permit_reserve`（0 表示不保留）；`force_refresh` 仍有效且迁移只补默认值、不删除；招募次数 0 或不选确认星级表示只计算 Tags |
| Award | 新增 `signinevent`（限时签到活动奖励） |
| Infrast | 设施选择补充 `Recycle`（回收站）与 `AssistantChange`（副手换人），默认设施集合保持不变 |
| StartUp | 新增 `start_game_enabled`（默认 `true`）；关闭时日常流程改走 MaaCore StartUp 动态任务，只连接运行中的游戏，`accountName` 迁移时保持原值 |

服务端 `gameTaskConfigService.ts` 维护同一组限制（Fight 连战范围与天数、Recruit 许可保留/多选策略、Infrast 设施、Award/StartUp 开关），日常流程构建与 Agent `run_task` 共用；前端 `findTaskFlowValidationFailure` 在提交前给出同样的范围提示。

### 2. 组合与状态边界

```
AutomationTasks（页头 + 全局指示）
└─ AutomationWorkspace（配置/执行/选中/撤销/连接/失效）
   ├─ AutomationTaskFlowPanel
   │  ├─ 任务流程列表（拖拽、启用、删除、撤销）
   │  ├─ automation-sequence-footer
   │  │  ├─ AutomationTaskPicker（页脚区域仍由本面板传入）
   │  │  └─ 立即执行 / 终止执行
   │  └─ AutomationExecutionSummary
   ├─ automation-task-editor（任务配置；同一草稿与执行投影）
   └─ automation-support-column
      ├─ DeviceMonitorPanel（共享实时会话）
      ├─ AutomationScheduleCard（定时编辑；关闭时保留时间摘要）
      └─ NotificationSettings（独立通知卡；显式保存）
```

| 状态 | 所有者 | Activity 隐藏/恢复 | 真正卸载/刷新 |
| --- | --- | --- | --- |
| 配置草稿、pending 与提交队列 | `user-config` 协调器 | 保留；不重读已 hydrate 的草稿 | 应用级通道继续持有 |
| Run 身份、进度、终态摘要 | `task-execution` 控制器 + `useAutomationExecution` | 控制器继续观察；页面只重新订阅 | 按持久化身份恢复，不重提 |
| 选中任务、撤销快照、连接反馈 | `AutomationWorkspace` | 保留 | 重置 |
| 拖拽预览、当前拖拽索引、公告 | `useTaskFlowSorting` | 清理 document 监听并丢弃进行中的预览 | 重置 |
| 摘要保留与详情展开 | `AutomationExecutionSummary` | 保留；恢复时按当前摘要调整 | 重置 |
| 通知配置 | `automation/notification-config` Query | 观察者注销，恢复后按新鲜度重取 | 缓存按 `gcTime` 回收 |
| 通知草稿、脏态与测试反馈 | `NotificationSettings` | 保留 | 重置 |
| 菜单开关、外部点击、Escape 回焦 | `AutomationTaskPicker` | 保留；Effect 清理后恢复时重新注册 | 关闭 |

- **配置写入仍然单通道。** 流程、定时和任务编辑都调用工作区的
  `updateConfig`；面板不创建草稿副本，也不调用 `saveUserConfig`。
- **执行只读。** 流程列表与摘要只消费 `isRunning`/`isStopping`/`isSubmitting`/
  `taskResults`/`currentStep`/终态摘要；启动仍只由 `submitFlow` 发出一次
  `run_daily_flow`，停止仍按控制器持有的 runId。归属按操作标识判定，
  因此概览快捷入口发起的同一次今日流程也能在本页看到进度并停止。
- **执行摘要不推断完成。** 步间延迟期间 run 仍活动；只有服务端终态摘要或
  `schedule.lastResult` 投影会进入“最近执行”。
- **页脚点击区域语义不变。** `AutomationTaskFlowPanel` 自己创建页脚 ref 并
  传给 `AutomationTaskPicker`；运行/停止按钮仍在页脚内，按下不会关闭菜单。

### 3. 流程列表与排序

`AutomationTaskFlowPanel` 只渲染 `tasks`（工作区传入的显示顺序）与
`execution`/`sorting` 投影。逐项状态与文案由 `model/flowExecution.ts` 计算：

| 规则 | 行为 |
| --- | --- |
| 未启用任务 | 始终 `idle`，显示任务描述而不是执行文案 |
| 有逐项结果 | 直接采用服务端状态；`running` 在 run 结束后显示为 `stopped` |
| 无结果且运行中 | 当前步骤 `running`，之前 `success`，之后 `pending` |
| 无结果且空闲 | `idle`；`pending` 文案回退为“未执行” |
| 当前步骤映射 | 优先 `currentTaskId`，否则按启用任务序号映射回流程索引 |
| 结果来源 | 活动期只读 `progress.taskResults`；提交在途清空；空闲期读终态摘要 |

排序规则仍由 `model/taskFlowSort.ts` 提供：10px 欧氏距离激活、按行中线计算
插入槽位、无效移动返回原引用、关闭游戏置底。React 接线由
`useTaskFlowSorting` 持有：

1. `pointerdown` 记录起点并尝试 `setPointerCapture`；
2. `pointermove` 超过阈值后进入预览，重排只更新本地 `dragFlow`；
3. `pointerup` 把最终顺序经 `onCommit` 交给工作区，由配置 owner 一次写入；
4. `Escape`、`pointercancel`、Activity 隐藏/卸载取消预览并恢复原顺序；
5. 方向键上/下与拖拽共用同一移动模型，提交后写入 `aria-live` 公告。

**指针生命周期修复。** 性能基线记录过重排后浏览器释放 pointer capture，
不能把 `lostpointercapture` 当成取消，否则会导致真实拖拽没有保存。当前实现把
`pointermove`/`pointerup`/`pointercancel` 挂到 `document`，排序不再依赖
capture 是否仍属于手柄；`lostpointercapture` 不再取消排序。capture 仍会
尽力建立，用于指针离开手柄时的浏览器语义。该行为由
`AutomationTasks.layout.test.tsx` 的“commits a pointer drag even when the
browser releases pointer capture”用例固定；DOM/CSS 未变化。性能复测采用[性能采样工具](../../../apps/web/tests/performance/README.md)中的相同场景与完成条件。

### 4. 定时编辑

`AutomationScheduleCard` 直接调用 `model/automationSchedule.ts`，把结果作为
`{ enabled?, entries? }` 交给工作区的 `updateSchedule`；后者合并 `enabled`、
规范化 entries 并写入唯一配置草稿。规则如下：

| 操作 | 模型行为 | 面板失败路径 |
| --- | --- | --- |
| 新增时间点 | 从 12:00 起找第一个空闲整点；24 个整点占满返回 `null` | “没有可添加的执行时间” |
| 时间编辑 | 单个 `HH:MM` 文本字段（数字掩码，失焦归一化）经 `setScheduleTimeEntry` 校验格式、重复与索引 | 非法值提示“请输入 00:00–23:59 的时间”并回退；重复提示“该执行时间已经存在” |
| 删除/启用 | 返回新数组；未知索引不产生可见变化 | 无 |
| 上限 | `MAX_SCHEDULE_ENTRIES = 6` 时“新增时间”禁用并提示数量上限 | 无 |
| 关闭态 | 不渲染编辑行，改为“已暂停 + 时间摘要” | 无 |

执行期间开关、时间字段、增删与启用项全部禁用；禁用事实来自只读 Run 投影，
不是面板自己的运行状态。卡片自动保存，不提供保存按钮。

执行时间按连接 profile 的客户端服务区时区注册 cron（国服与繁中为
`Asia/Shanghai`，其它服使用各自时区），非国服触发的绝对时刻会与浏览器本地时间
不同；卡片底部同时标注“游戏服务区时区 · 每日 04:00 刷新游戏日”。`/agent/schedules` 的请求与
响应形状不变，时区只进入注册日志与诊断投影。

执行前的关卡开放检查与总览、养成计划共用同一游戏日判定；资源收集全开放活动
期间，该服务区的资源本不会因周表未开放被跳过。

### 5. 执行摘要

`AutomationExecutionSummary` 只接收工作区选好的 `displaySummary` 与 `runId`：

- 摘要为 `null`（例如新一次提交在途）时继续显示上一份；
- 相同 `runId` + 相同内容不重置用户手动收起的详情；
- 新 `runId` 到达时，即使内容相同，也按本次结果重新决定是否展开；
- 失败（`failedCount`/`errors`/失败动作/失败上报）自动展开详情；
- 游戏任务动作在汇总行下按干员展开 `details`（培养结果与原因）与 `deferredMastery`（本轮未执行的专精目标，单独标为待处理，不计入失败）；专精条目的 `Completed` 显示为已启动目标专精训练，只有未带专精等级的 `Completed` 才显示已完成；延后目标按训练室占用说明，不声称本轮已启动训练；
- 阶段、掉落、上报、动作、错误与警告都直接来自服务端摘要，不推断成功。

`selectFlowDisplaySummary` 的优先级：本页持有 run 的终态摘要 → 空闲时
服务端流程投影 `schedule.lastResult` → 不展示。运行中或提交在途不展示旧摘要。

### 6. 通知配置读取与保存

`NotificationSettings` 是 `automation-support-column` 中的独立卡片，使用 `notificationConfigQueryOptions()` 读取 `automation/notification-config`（`['automation','notification-config']`），沿用全局默认 `staleTime` 并显式 `retry: false`。保存仍调用既有的 `saveNotificationConfig` 命令；成功后把本次提交快照通过 `setQueryData` 写回同一 key，不再用模块级永久缓存或第二份服务端副本。保存请求不绑定页面 `AbortSignal`，页面隐藏或卸载不会取消已经发出的保存；迟到响应按请求序号裁决。测试通知是独立命令，只中止自己的测试请求。

卡内状态：

| 状态 | 行为 |
| --- | --- |
| 加载中 | 只显示“读取通知配置…”，不渲染空配置，避免开关先显示为关闭再跳变 |
| 加载失败 | 卡内错误 + 重新加载；不渲染渠道与 footer |
| 总开关关闭 | 渠道开关、输入与测试禁用，并显示“先启用通知”等原因 |
| 总开关开、无可用渠道/凭据 | 显示“未启用渠道，不会发送”或“凭据不完整，不会发送” |
| 脏态 | 编辑后“保存”才可用；成功后回到“已保存”并再次禁用；保存失败保留草稿与脏态 |
| 测试与保存 | 两个独立命令，互不禁用；测试结果落在按钮下方，保存结果落在 footer 上方，互不覆盖 |

### 7. Activity 与兼容约束

- **Activity 隐藏/恢复**：流程排序的 document 监听随 Effect 清理并丢弃进行中
  的预览；摘要保留与展开状态保留；配置通道与执行控制器不受影响。
- **真正卸载/刷新**：选中、撤销、拖拽预览、摘要与连接反馈重置；配置草稿、
  pending 队列与 Run 身份仍由应用级所有者持有。
- 配置 key、本地存储键、wire 形状、调度与执行端点均未变化；旧草稿与服务端
  配置可直接读取。
- 流程列表、页脚与摘要沿用既有 DOM/CSS 类名；侧栏两张卡共用 `automation-side-card` 卡壳。
- 取消拖拽仍由 Escape/`pointercancel` 覆盖；`lostpointercapture` 不取消拖拽，
  也不改变默认态视觉。

### 剩余边界

- 通用任务配置编辑器仍在 `AutomationWorkspace` 内组合；流程、定时
  与摘要在各自面板中，未改变其表单结构或参数规则。
- 指针排序的性能比较必须先验证保存完成条件；旧版取消结果不可直接与成功保存耗时比较。采样方法见[性能采样工具](../../../apps/web/tests/performance/README.md)。

## 纯模型与排序

配置提交仍由 [`automationConfig.ts`](../../../apps/web/src/features/automation/model/automationConfig.ts) 适配器与 `user-config` 协调器持有，执行仍由 `task-execution` 控制器与服务端 Run 持有；当前指针/键盘接线由 `hooks/useTaskFlowSorting.ts` 持有，逐项执行状态与摘要来源由 `model/flowExecution.ts` 提供，模型本身仍不访问 React、网络或存储。

### 1. 定位与边界

| 模块 | 输入 | 输出 | 面板/工作区调用点 |
| --- | --- | --- | --- |
| `model/automationSchedule.ts` | 本地 `schedule.entries`、一次时间编辑 | 新的 entries 或 `{ ok: false, reason }` | 开关、增删时间点、时/分编辑与候选时间 |
| `model/taskFlowCommands.ts` | 当前草稿 flow、任务定义、参数键值 | 新 flow、新任务、校验失败项 | 添加、删除、恢复、启用、参数编辑、执行前校验 |
| `model/taskFlowSort.ts` | 指针坐标、流程与中线读取器 | 目标索引、重排后的 flow | `hooks/useTaskFlowSorting.ts` 的拖拽与键盘上下移动 |
| `model/flowExecution.ts` | 活动进度、终态摘要、流程 | 逐项状态/文案与“最近执行”来源 | 流程面板、任务编辑与执行摘要 |
| `model/dropTargets.ts` | `fight.params.drops` 的任意历史形状 | 结构化目标或 `null` | 由命令模型执行前校验调用 |

维护约束：

- 不改变 `/agent/schedules`、`/agent/schedules/manual/execute` 等端点、配置 key、本地存储键或 wire 形状。
- 不改变任务执行引擎、旧断点续跑、执行控制器身份或 Activity 语义。
- 纯模型不负责渲染，DOM/CSS 类名、表单 `id`/`aria-label` 和默认态视觉由现有面板保持。
- `automationConfig.ts` 仍是持久化适配器的唯一入口；它从两个纯模型导入时间与排序规则，而不是反向依赖网络或 React。

### 2. 定时时间规则

| 规则 | 行为 |
| --- | --- |
| 解析 | `parseScheduleTime` 把 `HH:mm` 拆成时/分，非法文本回退 `00:00`，越界值夹取到 `23:59` |
| 格式化 | `formatScheduleTime` 始终补零为两位时/分 |
| 规范化 | `normalizeScheduleEntries` 丢弃非法与重复时间点，`enabled` 缺省视为 `true`；同名工具 `normalizeScheduleTimes` 处理 wire 的 `times` |
| 旧格式 | `scheduleEntriesFromTimes` 把旧 `times` 转成全启用 entries；`activeScheduleTimes` 只导出启用项，禁用行只保留在本地 `maa-schedule.entries` |
| 默认值 | `createDefaultScheduleEntries` 每次返回新的 `08:00/14:00/20:00` 行，避免草稿共享可变对象 |
| 新增 | `findNextScheduleTime` 从 12:00 起逐小时扫描，返回第一个未被占用的整点；`appendScheduleEntry` 追加启用行，24 个整点都占用时返回 `null` |
| 编辑 | `setScheduleTimeEntry` 校验 `HH:mm` 格式、重复与索引；非法返回 `invalid`，重复返回 `duplicate` 且不修改草稿，索引缺失返回 `missing` |
| 上限 | `MAX_SCHEDULE_ENTRIES = 6`，达到上限时“新增时间”按钮禁用并提示，模型本身不裁剪已有行 |
| 旧页面文案 | `没有可添加的执行时间`、`该执行时间已经存在` 与 `请输入 00:00–23:59 的时间` 由面板根据模型结果展示，模型不保存 UI 文案 |

编辑结果交给 `AutomationScheduleCard` 的 `onChange`，由工作区的 `updateSchedule` 合并 `enabled`/`entries` 并调用 `normalizeScheduleEntries` 后写入唯一配置草稿。

### 3. 任务流程命令规则

| 规则 | 行为 |
| --- | --- |
| 命令身份 | `resolveTaskCommandId` 优先 `commandId`，缺失时回退 `${commandId}-${时间戳}` 的 id 前缀；执行校验使用该结果 |
| 添加任务 | `addTaskToFlow` 复制定义中的 `defaultParams` 生成新 `params`，id 为 `${commandId}-${now}`；`icon`/`paramFields` 被剥离，其余字段（含 `defaultParams`）保持迁移前的持久化形状 |
| 关闭游戏 | 新关闭游戏任务继承启动游戏的 `clientType`（缺省 `Official`），并始终追加到流程末尾；添加其它任务会重新经过 `placeClosedownLast` |
| 恢复删除 | `insertTaskFlowItem` 按删除时索引插入，越界索引夹取到 `[0, flow.length]`，再保证关闭游戏在最后 |
| 删除/启用 | `removeTaskFlowItem`、`toggleTaskFlowItemEnabled` 返回新数组；未知索引不产生可见变化 |
| 参数编辑 | `updateTaskFlowParams` 只替换目标任务；`clientType` 变化时同步启动/关闭游戏步骤，与迁移前一致 |
| 关卡分组 | `splitStagesForEditing` 负责 置顶/智能养成/普通/空白 分类，`orderStagesForEditing` 按 置顶 → 智能养成 → 普通 → 空白输入行拼接；任务编辑面板的智能养成增删复用同一分类。组内保持原顺序，每个条目只归类一次，长度与多重集合不变 |
| 执行前校验 | `findTaskFlowValidationFailure` 先检查启用中的自定义换班（`taskType === 'Infrast'`、`mode === 10000`、`filename` 为空），再检查启用中的 `fight` 掉落目标；返回第一个无效任务 id 与提示 |
| 提示文案 | 两条校验文案由模型返回，工作区负责写入全局状态消息并选中该任务 |

同时带 `pinned` 与 `smart` 的异常关卡形状按置顶归类一次；旧页面会把它复制到两个分组。正常编辑路径不会产生该形状。

### 4. 排序规则与不变量

| 规则 | 行为 |
| --- | --- |
| 拖拽阈值 | `hasPointerSortActivated` 使用欧氏距离，位移 `>= 10px` 才激活；常量 `POINTER_SORT_ACTIVATION_PX` 为 10 |
| 目标索引 | `getPointerSortTargetIndex` 先移除被拖拽项，再按其余任务中线计算插入槽位；无法读取中线的任务被跳过；被拖拽项不在流程中返回 `-1` |
| 重排 | `moveTaskFlowItem` 对同位置、越界或缺失源项返回原数组引用；合法移动返回新数组，长度为 `[0, length)` 的目标索引直接配合拖拽槽位 |
| 不变量 | 每次合法移动都保持长度与成员多重集合；移动后再移回恢复原顺序；键盘上下移动与拖拽共用同一函数 |
| 关闭游戏 | `placeClosedownLast` 把 `commandId === 'closedown'` 或 id 以 `closedown-` 开头的任务稳定地移到末尾，其余任务保持相对顺序 |
| 引用判定 | 排序 hook 用 `newFlow === currentFlow` 判断键盘移动是否需要提交，因此无效移动必须返回原引用 |

`automationConfig.ts` 的载荷解码也调用同一个 `placeClosedownLast`，持久化顺序与页面编辑顺序不会分叉。

### 5. 掉落目标格式

`fight.params.drops` 支持两种历史形状：

- 文本：`30011=10,30062=5`，条目两端允许空白，`=` 两侧允许空白；
- 旧对象：`{ "30011": 10, "30062": "5" }`。

规则：

- 物品 ID 只允许字母、数字、`_`、`-`；数量必须是正整数，`0`、负数、小数与非数字都使整份输入无效；
- 任一条目非法时 `parseDropTargets` 返回 `null`，执行前校验据此阻止提交；
- 空值（`undefined`/`null`/`''`）解析为空数组，表示未设置目标；
- 重复条目保留原顺序，不做去重，兼容旧草稿；
- `formatDropTargets` 输出无空格的规范文本，与 `parseDropTargets` 互为逆变换。

### 6. 兼容与视觉约束

- 配置 key、pending、本地布局与 wire 形状以[配置持久化协调器](../../architecture/config-persistence.md)为准；本域纯模型保留 `entries`/`times` 兼容读取。
- 新任务仍携带 `defaultParams` 且不含 `icon`/`paramFields`；模型输出已由 `automationConfigAdapter.decodeDraft` 的回归用例验证可被现有迁移接受。
- 面板 DOM/CSS、表单 id、`aria-label`、拖拽手柄与键盘行为不变；没有新增 CSS，也没有更新视觉基线。

## 任务编辑

配置草稿仍由 `automationConfig` 适配器与 `user-config` 协调器持有，执行仍由 `task-execution` 控制器与服务端 Run 持有；这些面板持有菜单开关、外部点击、Escape 回焦与智能养成在途标记，不新增第二份配置、保存队列或执行状态。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 页面组合、配置订阅、执行订阅、选中项、撤销、连接测试 | `pages/automation/AutomationTasks.tsx` + `components/AutomationWorkspace.tsx` | 目前页面只组合工作区；流程/定时/摘要分别在独立面板 |
| 流程列表、拖拽排序、页脚与执行摘要 | `components/AutomationTaskFlowPanel.tsx` + `hooks/useTaskFlowSorting.ts` | 只接只读 Run 投影；排序预览与编辑器共享 |
| 定时编辑 | `components/AutomationScheduleCard.tsx` | 绑定定时纯模型，经工作区唯一配置 owner 写入 |
| 通知卡 | `components/NotificationSettings.tsx` | 独立卡片；Query、草稿、脏态与测试反馈归卡内 |
| 关卡列表编辑、次数步进、置顶、增删行 | `components/AutomationStageEditor.tsx` | 受控面板：参数经 `onUpdate(index, 'stages', value)` 写回工作区 |
| 智能养成加入/移除与在途标记 | `components/AutomationStageEditor.tsx` + `model/stageEditing.ts` | 读取 `training-queue`、调用 `generateTrainingPlan({ mode: 'current' })`；合成规则在纯模型 |
| 任务挑选菜单 | `components/AutomationTaskPicker.tsx` | 菜单开关、外部 pointerdown、Escape 回焦与运行态收起都在面板内 |
| 可添加任务目录 | `components/automationTaskCatalog.tsx` | 名称、图标、默认参数与参数字段；不读取配置/Query/执行状态 |
| 游戏内培养计划编辑 | `components/OperProgressPlansEditor.tsx` | 复用 `features/training` 的 `OperatorSelectModal`；计划仍只保存中文名与职业，只读全量干员目录回显头像（同名干员用职业消歧），目录里找不到时保留通用人像占位 |
| 关卡分组与智能养成合成 | `model/stageEditing.ts` | 纯模型；`orderStagesForEditing` 也复用同一分组 |
| 公招招募时长校验 | `model/taskParamRules.ts` | 纯模型：10 分钟取整、60–540 夹取、非法输入回退 |
| 日常任务参数与旧配置迁移 | `components/automationTaskCatalog.tsx` + `model/automationConfig.ts` + `model/gameTaskParams.ts` | 目录是默认值与表单文案的唯一来源；`migrateTaskParams` 补齐新字段并转换旧键；执行前校验复用 `gameTaskParams.ts` |
| 自定义排班入口 | `components/InfrastScheduleField.tsx` | 在任务参数内维护 `filename`/`plan_index`，不把排班表写进任务配置 |
| 自定义排班文件读取与保存 | `components/InfrastScheduleEditor.tsx` + `model/queries.ts` | 经 `/agent/infrast-schedules` 读取/保存 MAA 配置目录中的排班 JSON |
| 排班表协议模型与编辑 | `model/infrastSchedule.ts` + `model/infrastScheduleEditing.ts` | 纯模型：Core 协议校验、房间三态、按字段更新与任务参数迁移 |
| 配置提交、pending 与 schedule 完整单元 | `user-config` 协调器 + `automationConfig` 适配器 | 面板不调用 `saveUserConfig`、不写 localStorage、不拥有提交队列 |

维护约束：

- 配置 key、pending、本地布局与 wire 形状以[配置持久化协调器](../../architecture/config-persistence.md)为准；保持 `/agent/schedules/*` 端点兼容。
- 任务参数默认值、表单文案与旧配置迁移必须同步修改并在同一提交内补测试；智能养成计划生成参数、执行前校验顺序与执行身份保持不变。
- 保持渲染结构、DOM/CSS 类名、表单 `id`/`aria-label`、菜单 `id`/`role`、焦点顺序与键盘行为；视觉回归遵循[开发指南](../../development/README.md)。
- 挑选面板仍把“整条流程页脚”作为点击区域：在页脚内按下指针（包括运行/停止按钮）不关闭菜单，页脚之外按下才关闭，与迁移前一致。
- 自定义排班编辑只改写用户实际触碰的字段；未编辑的房间、未识别的扩展字段与“保持原样”语义不得被默认值覆盖。排班文件本身仍由 MAA/maa-cli 执行侧读取。

### 2. 组合与状态边界

```
AutomationTasks（页头 + 全局指示）
└─ AutomationWorkspace（配置/执行/选中/撤销/连接/失效）
   ├─ AutomationTaskFlowPanel
   │  ├─ 任务流程列表（拖拽预览、拖拽公告）
   │  └─ automation-sequence-footer
   │     ├─ AutomationTaskPicker（open / 外部点击 / Escape / disabled 收起）
   │     ├─ 立即执行 / 终止执行（工作区回调）
   │     └─ …
   └─ automation-task-editor
      └─ AutomationStageEditor（isSmartStageLoading / 关卡写回）
```

| 状态 | 所有者 | Activity 隐藏/恢复 | 真正卸载/刷新 |
| --- | --- | --- | --- |
| 配置草稿、pending 与提交队列 | `user-config` 协调器 | 保留；不重读已 hydrate 的草稿 | 应用级通道继续持有 |
| 关卡列表 | 配置草稿 `task.params.stages` | 保留 | 随草稿恢复 |
| 智能养成在途标记 | `AutomationStageEditor` | 保留；在途 promise 不受 Effect 清理取消，`finally` 继续清标记 | 重置 |
| 菜单开关 | `AutomationTaskPicker` | 保留；Effect 清理时注销 document 监听，恢复后重新注册 | 重置为关闭 |
| 选中任务、撤销、连接反馈 | `AutomationWorkspace` | 保留 | 重置 |
| 拖拽预览、公告 | `useTaskFlowSorting` | 清理 document 监听并丢弃进行中的预览 | 重置 |
| 执行详情 | `AutomationExecutionSummary` | 保留 | 重置 |

- **参数写回仍然单通道。** 面板只调用 `onUpdate`，经工作区转交 `useUserConfig` 的 `update`；面板内不创建草稿副本。
- **智能养成只写一次。** 读取队列与生成计划是领域能力调用；成功后把生成的关卡与现有置顶/普通关卡合成一次写回。
- **菜单是纯局部状态。** 工作区只在添加成功后选中新任务；是否关闭菜单由面板自己决定。

### 3. 关卡编辑与智能养成

`model/stageEditing.ts` 的输入是 `Array<string | StageConfig>`（旧草稿允许只有关卡名），输出是新数组或原数组引用：

| 规则 | 行为 |
| --- | --- |
| 默认列表 | 草稿缺失时返回新的空白行；显式空数组保持为空，由“添加关卡”继续输入 |
| 分组 | `splitStagesForEditing` 输出 置顶 → 智能养成 → 普通 → 空白；`flattenStagesForEditing` 按同序拼接；同时带 `pinned` 与 `smart` 的异常形状只归入置顶 |
| 统计 | `countConfiguredStages` 只数有关卡名的行；`findTrainingOperators` 取最后一个带干员信息的智能关卡 |
| 置顶 | 字符串行升级为 `{ stage, times: '', pinned: true }`；对象行切换 `pinned`；智能关卡与缺失索引返回原引用 |
| 改名/次数 | 字符串行升级为对象形状；缺失索引返回原引用 |
| 次数步进 | 从 `Number(times) || 0` 起算，最低 0；智能关卡不参与 |
| 删除 | 删空后保留一个空白行 |
| 智能养成移除 | 保留置顶与普通关卡（空白行随之丢弃），没有剩余行时回退空白行 |
| 智能养成插入 | 置顶之后、普通关卡之前插入生成项，再交给 `updateTaskFlowParams` 的 `orderStagesForEditing` 统一顺序 |
| 生成项 | 沿用计划的 `stage` 与 `totalTimes`，写 `smart: true` 与本次计划的干员名列表 |

`AutomationStageEditor` 的 `updateStages` 只在模型返回新数组时调用 `onUpdate`；无效索引与智能关卡的不可达编辑不会产生配置写入。智能养成失败路径保持原文案与顺序：

- 养成队列为空/读取失败 → “智能养成队列为空，请先添加干员”；
- 生成计划失败 → “生成刷取计划失败”；
- 计划没有关卡 → “当前干员材料已集齐！”且不写回；
- 抛错 → “操作失败: …”；`finally` 始终清除在途标记。

公招招募时长的失焦归一化由 `model/taskParamRules.ts` 的 `normalizeRecruitmentTime` 完成：`Math.round(value / 10) * 10` 后夹取到 60–540；非有限输入回退 540。页面仍使用同一输入框的 `min`/`max`/`step` 属性。

### 4. 挑选面板的焦点与键盘

| 交互 | 行为 |
| --- | --- |
| 触发器 | `aria-haspopup="menu"`、`aria-expanded`、`aria-controls="automation-task-picker"`；菜单打开时追加 `is-open` |
| 菜单 | `role="menu"`、`aria-label="可添加任务"`，每项 `role="menuitem"` |
| 选择 | 调用页面 `onAddTask` 后关闭菜单；页面负责加入流程并选中新任务 |
| Escape | 关闭菜单并把焦点还给触发器 |
| 外部按下 | 指针落在页面传入的页脚区域之外时关闭；区域之内（含运行/停止按钮）不关闭 |
| 运行态 | `disabled` 变为 true 时收起菜单并禁用触发器；组件挂载时若已禁用则保持关闭 |
| 计数 | 菜单项显示当前流程中同 `commandId` 的数量（含拖拽预览顺序） |
| 定位 | 以视口固定定位锚在触发器上方；上方空间不足时改选上下空间更大的一侧，宽度、水平位置与最大高度夹取在视口内，超出高度的选项在菜单内滚动 |

面板不实现焦点陷阱；菜单项的 Tab 顺序与迁移前一致。
菜单使用视口固定定位；面板的 overflow 裁剪不会影响固定定位层。

### 5. Activity 与兼容约束

- **Activity 隐藏/恢复**：面板 state 保留；document 监听在 Effect 清理时注销，恢复后按当前 `open` 重新注册，不会遗留监听。智能养成在途 promise 继续完成，隐藏期间只更新自身状态，不写配置以外的资源。流程排序的 document 监听同样在 Activity 隐藏时清理并丢弃进行中的预览。
- **真正卸载/刷新**：菜单回到关闭，在途标记重置；配置草稿、pending 队列与 Run 身份仍由应用级所有者持有。
- 配置 key、本地存储键、迁移与 wire 形状未变化；旧草稿可直接读取。
- 默认态视觉、表单标签、菜单焦点与键盘行为继续由下列组件/页面回归覆盖。

### 6. 自定义基建排班编辑

Infrast 任务在 `mode=10000` 时仍以 `filename`/`plan_index` 两个 Core 字段决定换班方案；新增的编辑器不向任务参数写入排班表内容，而是通过
`/agent/infrast-schedules` 读写 `<maa config>/infrast/` 下的 JSON，路径规则与 maa-cli 解析 `filename` 一致。协议字段与语义以 MAA
[基建排班协议](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/dev/docs/zh-cn/protocol/base-scheduling-schema.md)
及 MaaCore `InfrastTask::parse_and_set_custom_config` / `InfrastAbstractTask::check_room_shift_intent` 为准。

| 层级 | 规则 |
| --- | --- |
| 设施键缺失 | 该设施未配置，MAA 走默认换班算法 |
| 设施键为 `[]` | 整个设施保持原样，不换人也不换产物；会客室线索、训练室继续训练等设施级操作照常 |
| 房间无选人意图 | 通用 `operators`/`candidates` 为空（训练室还要求 `operatorsA`/`operatorsB` 为空）且未启用 `autofill` 时保持干员不动，不回落默认算法 |
| 产物与排序 | 房间无选人意图时仍会处理 `product`/`sort`（Core 在空意图判定前先处理产物）；只有 `skip` 和整设施 `[]` 跳过这些字段。编辑器把该状态显示为“保持干员” |
| `skip: true` | 跳过该房间的换人、换产物与排序；无人机和设施级操作照常 |
| 训练室 | 只认 `operatorsA`（协助者候选）与 `operatorsB`（训练位候选）作为选人意图；通用 `operators`/`candidates` 仍会被 Core 解析并计入换人意图，但训练室选人并不使用它们 |
| 回收站 | 写法同制造站，`product` 字段无效 |
| 未知设施/扩展字段 | Core 会跳过未知设施；编辑器原样保留未知设施键、未知房间字段、`Fiammetta`/`drones`/`groups`/`period` 等未建模字段 |

编辑与保存约束：

1. `infrastScheduleEditing.ts` 的状态变更只返回新对象，且只增删目标字段；`operators` 输入为空表示“未给出选人意图”，不能写成清空房间的默认配置。房间三态显示为“更换干员 / 保持干员 / 跳过”，其中“保持干员”仍保留 `product`/`sort` 字段并按 Core 语义生效。
2. 服务端在保存前按协议校验并原子写入；读取返回原文，不在读路径补默认值或改写字段。
3. 任务参数迁移只在客户端 `migrateTaskParams` 内归一化旧草稿：`filename` 去空白、`plan_index` 从历史字符串转为非负整数，不读取或改写排班文件内容。
4. 编辑器内不展示的字段（无人机、菲亚梅塔、干员编组、时间段、`layout`/`metadata` 等）保存时原样保留，由用户继续在原始 JSON 中维护。
5. 保存前校验文件名输入与当前已加载文档是否一致：文件名改动后必须先点“加载”读取目标文件或点“新建排班”显式新建，否则拒绝保存并提示，避免把已加载的文档写到另一个文件名上。

## 回归与关联

### 回归测试

以下路径相对于 `apps/web/src/`：领域回归在 `features/automation` 与 `pages/automation`；入口命令见[验证命令](#验证命令)。

关键不变量：

- 执行提交幂等：一次启动只发出一次 `run_daily_flow`，停止按本页 runId；自定义换班缺文件与非法掉落目标阻止提交并选中任务。
- 拖拽排序：10px 激活阈值、长度与成员多重集合不变量、无效移动返回原引用、关闭游戏置底；浏览器释放 pointer capture 后拖拽仍提交，Escape/`pointercancel` 取消。
- 配置通道：schedule 完整单元提交、半失败重试、跨 remount 串行、迟到加载与 Activity 恢复不重读已 hydrate 的草稿。
- 定时纯模型：12:00 起候选整点、6 行上限、重复拒绝、24/60 循环与旧 `times` 往返兼容。

### 验证命令

以下命令均在仓库根目录执行。

```sh
pnpm --filter la-pluma-next-client exec vitest run src/features/automation src/pages/automation
```

完整验证与视觉回归入口见[开发指南](../../development/README.md)。

### 关联契约

- [配置持久化协调器](../../architecture/config-persistence.md)
- [前端执行客户端与控制器](../../architecture/execution-client.md)
- [Query 缓存与键规范](../../architecture/query-cache.md)
- [前端架构与所有权](../README.md)
