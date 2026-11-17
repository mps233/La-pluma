# 总览

> [← 返回前端架构](../README.md) · [文档索引](../../README.md)

本文集中维护本领域的面板、模型与命令约定；通用契约通过链接引用。

- [页面与面板](#页面与面板)
- [完整快照与设备采样](#完整快照与设备采样)
- [回归与关联](#回归与关联)

## 页面与面板

五路业务快照、设备采样、执行控制器与失效协调的所有者均未改变；区域容器分别持有局部订阅与展示计算。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 页面壳、首屏门禁与工作区组合 | `pages/dashboard/Dashboard.tsx` | 未加载时返回完整骨架；加载后组合工作区；只订阅 `hasLoaded` 并持有唯一的 `useDashboardSnapshotRefresh` |
| 区域组合与导航回调 | `features/dashboard/components/DashboardWorkspace.tsx` | 组合连接通知、流程、设备与摘要区域；创建“打开自动化/养成/数据（掉落记录）”三个回调 |
| 设备采样投影 | `DashboardWorkspace` 内的 `DashboardDeviceSampleProjection` | 只调用一次 `useDashboardDeviceStats`，返回 `null`；样本更新不推动兄弟区域重渲染 |
| 连接健康提示与重试 | `features/dashboard/components/DashboardConnectionNotice.tsx` | 只在离线/后端不可用时发送常驻全局 toast；离线不带 action，后端不可用时附带“重试连接”；返回 `null`，不参与页面布局；重试调用完整快照协调器 |
| 流程区域（网格与预览入口） | `features/dashboard/components/DashboardFlowSection.tsx` | `useDashboardFlowLayout` 的网格测量与预览壳；预览入口始终挂载 |
| 今日流程卡 | `features/dashboard/components/DashboardFlowPanel.tsx` | 订阅活动/定时/开放关卡摘要与刷新错误；启动结果经全局 toast（`EXECUTION_NOTICE_ID`）提示 |
| 当前活动卡状态投影 | `features/dashboard/model/activityView.ts` | 纯函数：把活动快照、刷新状态与旧 v1 缺字段投影为 loading/active/none/unavailable/stale |
| 流程操作入口 | `features/dashboard/hooks/useDashboardFlowActions.ts` | 组合 `useDashboardExecution` 与刷新回调；不写 store、不另发请求 |
| 连接健康投影 | `features/dashboard/hooks/useDashboardServiceStatus.ts` | 把 `backendStatus` 与在线状态映射成文案；探针仍归 `runtime-status` |
| 设备状态区域 | `features/dashboard/components/DashboardDeviceSection.tsx` | 只订阅 `deviceStats` 与 `temperatureHistory`；无样本时仍渲染四卡，数据为空 |
| 摘要区域 | `components/DashboardSummarySection.tsx` | 养成与掉落卡片常驻 |
| 养成摘要卡 / 掉落摘要卡 | `components/DashboardTrainingSummaryCard.tsx`、`DashboardDropSummaryCard.tsx` | 各自订阅自己的摘要切片与导航函数 |
| 流程展示计算 | `features/dashboard/model/flowView.ts` | 纯函数：命令标题/说明、按钮文案、禁用与忙碌标记 |
| 设备展示计算 | `features/dashboard/model/deviceView.ts` | 纯函数：使用率颜色语义与温度曲线几何 |
| 完整快照协调 | `model/snapshotRefresher.ts` + `hooks/useDashboardSnapshotRefresh.ts` | 由此工作区接入，保持完整快照协调唯一性 |
| 设备采样轮询 | `device-mirror` 的 `useDeviceStatsSample` | 已实现；轮询间隔、暂停与失败保旧保持不变 |
| 预览会话 | `components/DashboardPreviewEntry.tsx` + `device-mirror` | 已实现；遵循已有预览协议 |

维护约束：

- 不改变五个领域 Query 的资源归属、`staleTime`/`gcTime`、自动重试、失效作用域与 5 分钟刷新节奏；activity 不传 `clientType` 时 key 使用 `profile` 哨兵（见[Query 缓存与键规范](../../architecture/query-cache.md)）。
- 不改变执行端点、幂等键、`scope: 'dashboard'` 与终态提示规则。
- 不改变设备采样端点、5s 间隔、文档隐藏暂停、`refetchOnMount: 'always'` 与失败保旧。
- `la-pluma-dashboard-cache` 保持 v1 与 `la-pluma-dashboard-cache` key；活动摘要新增字段为可选增量，旧缓存缺 `status` 时首次挂载立即刷新，旧客户端忽略新字段。
- 不把启动 loading 与流程展示计算写入 `dashboardStore`、Query、localStorage 或 URL。
- 活动卡状态/失败文案、连接告警 toast 化与概览卡片收敛见“行为变化”；其余渲染结构与默认态视觉保持不变。
- 总览没有展开/折叠交互；没有跨面板展开状态需要提升为共享状态。局部交互状态只有启动 loading，就近放在流程卡。

### 2. 组合与订阅边界

```
Dashboard（app-page > app-stack-section > DashboardWorkspace；首屏门禁与唯一刷新调度）
└─ DashboardWorkspace（区域组合 + 导航回调）
   ├─ DashboardDeviceSampleProjection（采样投影，返回 null）
   ├─ DashboardConnectionNotice（连接通知 + 重试，返回 null）
   ├─ DashboardFlowSection（网格测量 + 预览入口）
   │  ├─ DashboardFlowPanel（执行/摘要 + flowView）
   │  └─ DashboardPreviewEntry（device-mirror 预览会话）
   ├─ DashboardDeviceSection（deviceStats + temperatureHistory）
   └─ DashboardSummarySection
      ├─ DashboardTrainingSummaryCard（trainingSummary）
      └─ DashboardDropSummaryCard（dropSummary）
```

- **刷新只有一个调度。** `Dashboard` 调用一次 `useDashboardSnapshotRefresh()`；流程卡与连接通知通过 `refreshDashboard` prop 复用同一协调器。区域不创建计时器、失效订阅或第二套读取。
- **设备采样投影只有一个实例。** `DashboardDeviceSampleProjection` 在执行采样 hook 后返回 `null`，因此每 5s 的 Query 数据变化只重渲染这个空组件，不推动流程、摘要或连接区域。采样本身仍由 device-mirror 的 Query 观察者持有。
- **执行只有一个订阅。** `DashboardFlowPanel` 通过 `useDashboardFlowActions` 调用一次 `useDashboardExecution`；连接通知、设备与摘要区域不订阅执行快照。
- **摘要按卡片订阅。** 养成摘要更新只重渲染 `DashboardTrainingSummaryCard`，掉落摘要更新只重渲染 `DashboardDropSummaryCard`；摘要区域自身没有订阅。
- **连接健康只影响通知与流程操作。** `DashboardConnectionNotice` 与流程操作 hook 各自读取 `useDashboardServiceStatus`；通知组件返回 `null`，状态变化不参与页面布局，也不会重渲染设备与摘要区域。
- **导航回调只创建一份。** 工作区用同一 `navigate` 创建自动化/养成/数据回调，流程卡与摘要卡只接收函数，不直接依赖路由；掉落摘要的“数据”入口使用 `statisticsTabRoute('drops')`，直接落在数据页的掉落记录 tab。
- 面板可调用所属领域 hook；流程展示与设备展示的规则留在纯模型，组件只负责渲染。

订阅隔离（渲染边界的验收依据）：

| 状态变化 | 会重渲染 | 不会重渲染 |
| --- | --- | --- |
| 活动/定时/开放关卡快照提交 | `DashboardFlowPanel` | 设备、摘要、连接通知 |
| 启动 loading | `DashboardFlowPanel` | 设备、摘要、连接通知 |
| 启动反馈 toast（`execution`） | `AppToaster` | 流程、设备、摘要、连接通知 |
| 执行控制器快照（运行/停止/占用） | `DashboardFlowPanel` | 设备、摘要、连接通知 |
| 设备样本（每 5s） | `DashboardDeviceSampleProjection`、`DashboardDeviceSection`（仅在有样本时） | 流程、摘要、连接通知 |
| 养成摘要 | `DashboardTrainingSummaryCard` | 掉落卡、流程、设备、连接通知 |
| 掉落摘要 | `DashboardDropSummaryCard` | 养成卡、流程、设备、连接通知 |
| 后端状态 / 在线状态 | `DashboardConnectionNotice`（返回 null）、`DashboardFlowPanel` | 设备、摘要、页面布局 |

页面不再整体订阅执行结果：流程卡的启动结果与终态提示都通过 `notify` 发送，因此通知正文不会重渲染总览工作区。通知由应用根挂载的 sonner `AppToaster` 渲染。

### 3. 今日流程入口

`useDashboardFlowActions` 保留迁移前的用户路径，只把接线移到区域附近：

| 操作 | 行为 | 领域所有者 |
| --- | --- | --- |
| 执行日常 | 校验在线/后端可用 → `loadUserConfig('automation-tasks')` → 空流程时提示并导航自动化 → `startFlow(flow)` 经控制器提交 `run_daily_flow` | `user-config` 读取 + `task-execution` 控制器 |
| 启动成功后的刷新 | `await refreshDashboard()`（`force` 完整快照） | `dashboardSnapshotRefresher` |
| 设备忙/提交在途 | 按钮禁用或返回 warning；同一时刻只允许一次提交 | 控制器 `submission` + 区域在途 ref |

- `quickStartLoading` 只存在于流程区域；启动结果经 `notify(message, type, { id: EXECUTION_NOTICE_ID })` 由全局 toast 提示，不写 store、Query 或 localStorage。启动期间不读取五路资源、不调用 `finishRefresh`，因此不会产生半份快照或提前更新时间戳。
- 成功启动后才经协调器刷新；刷新失败仍由协调器保留旧完整快照。
- 终态提示与运行/占用/未知阶段仍来自 `useDashboardExecution` 的唯一控制器快照；流程卡只增加展示投影。
- 未保存流程时导航到自动化页的行为、提示文案与警告类型与迁移前一致。

### 4. 设备采样与温度历史

- 采样观察者由 `device-mirror` 的 `useDeviceStatsSample` 持有；间隔和 Query 参数见[Query 缓存与键规范](../../architecture/query-cache.md)。文档隐藏时暂停后台轮询，Activity 隐藏/恢复注销与重建观察者。
- `useDashboardDeviceStats` 把成功样本连同 `dataUpdatedAt` 交给 `dashboardStore.updateDeviceStats`；store 继续做百分比、有限数值与形状校验，并维护最多 36 个温度点。
- **样本身份去重。** Activity 隐藏会清理 Effects，恢复时重跑同一份 Query 缓存样本。`updateDeviceStats(stats, dataUpdatedAt)` 在以下情况不追加温度点：时间戳早于最近样本；或时间戳相同且样本对象与 store 中保存的是同一份缓存对象。新的 `dataUpdatedAt` 始终追加一次，即使温度数值相同；同一毫秒内产生了不同样本对象时也按新样本处理。
- `lastDeviceSampleAt` 只存在于运行期 store，不进入 `la-pluma-dashboard-cache`；刷新页面后从持久化快照恢复旧温度历史，并由新采样继续追加。
- 没有设备（`data: null`）、轮询失败或非法字段都不会清除上一份成功样本或温度历史。
- 采样投影随工作区在页面脱离骨架后挂载；骨架阶段没有设备区域，因此可见结果不变。采样间隔、暂停与失败策略未变。

### 5. 预览生命期

- `DashboardPreviewEntry` 始终渲染在流程网格的预览壳内，不按流程 loading、执行阶段、连接健康或设备样本条件卸载；网格测量依赖它提供的 `[data-dashboard-preview-card]` 与 `[data-dashboard-preview-frame]`。
- 宽屏列宽的默认值只由 `dashboard.css` 的 CSS fallback 提供；`useDashboardFlowLayout` 仅在测量成功后写入 inline `--dashboard-flow-columns`，非宽屏、缺少预览锚点或尺寸不可用时移除覆盖，JS 不维护第二份默认列宽。
- 预览会话由 device-mirror 的应用级 `PreviewSessionProvider` 持有；总览经 `usePreviewSession`/`usePreviewSnapshot` 消费共享视频流与截图。Activity 隐藏只解除当前视频绑定，切页不重连；文档隐藏暂停不影响业务快照。
- 点击预览画面不再导航，概览保持当前页；预览模式仍只由卡片头部的“关闭 / 快照 / 实时”控制切换，日常、作业、肉鸽、养成、数据和日志页提供完整模拟器控制台。
- 区域测试只验证流程区域不条件卸载预览入口；真正的连接/截图生命周期仍由 device-mirror 的预览测试覆盖。

### 6. 局部展示计算

`model/flowView.ts` 的 `buildDashboardFlowView` 输出：

| 输出 | 规则 |
| --- | --- |
| `isRunning` | `phase` 为 `running`/`waiting` |
| `controlsDisabled` | 启动 loading、设备忙或后端不可用 |
| `commandTitle` | 检查中 → “正在检查服务”；不可用 → “连接不可用”；启动 loading → 对应进行中文案；再按 `waiting`/`running`（标签 → 当前任务 → 默认）/`occupied`/`unknown`/`idle` 回退 |
| `commandDescription` | 检查中 → “正在确认自动化服务状态”；不可用 → “连接恢复后可以继续操作”；loading → 对应说明；再按阶段回退到运行说明、计划消息或待命文案 |
| `primaryActionLabel` | `waiting` → “等待继续”；运行 → “正在运行”；否则“执行日常” |

`model/deviceView.ts` 的规则：

| 导出 | 规则 |
| --- | --- |
| `getUsageTone` | `null`/`<75` → normal；`>=75` → warning；`>=90` → danger |
| `buildTemperatureSeries` | 空历史返回 `null`；单点复制为水平线；稳定区间（最大值−最小值 `<0.1`）增加 ±1 纵向余量；`y = 25 − ((value − chartMin) / spread) × 18`；“近 N 秒”至少显示 5 秒 |

这两个模块不访问 React、Query、store 或网络，可用纯 Node 测试覆盖。

### 7. Activity 与卸载

| 状态 | 所有者 | Activity 隐藏 / 恢复 | 真正卸载 / 刷新 |
| --- | --- | --- | --- |
| 完整业务快照与 `lastRefreshAttemptAt` | `dashboardStore` + 协调器 | 页面的刷新计时器与失效订阅清理；在途协调读取继续并原子提交；恢复按时间戳决定刷新 | 从 `la-pluma-dashboard-cache` v1 恢复，再按 5 分钟规则刷新 |
| 启动 loading | `DashboardFlowPanel` 本地状态 | 保留；显示时继续可见 | 重置 |
| 启动反馈 toast（`execution`） | 应用级全局通知器（`AppToaster`） | 保留，不随 Activity 隐藏清除 | 由通知器计时与替换，页面卸载不主动 dismiss |
| 执行订阅与终态提示 | `task-execution` 控制器 + `useDashboardExecution` | 观察者随 Effects 重建，控制器继续观察；不发送停止 | 按持久化身份恢复，不重新提交 |
| 连接通知（`dashboard-connection`） | `DashboardConnectionNotice` | 隐藏时 dismiss；恢复可见且仍不可用时重新提示 | dismiss；重挂载按当前连接状态重新提示 |
| 设备采样 | `device-mirror/device-stats` Query | 观察者注销、计时器清理；恢复立即采样一次；缓存回放不重复追加温度点 | 新 Query 立即读取；持久化温度历史保留 |
| 设备温度历史 | `dashboardStore` | 保留 | 随完整快照缓存恢复 |
| 摘要与当前活动 | `dashboardStore` | 保留 | 随完整快照缓存恢复；`lastRefreshError` 只在运行期 |
| 活动卡 phase（loading/active/none/unavailable/stale） | `model/activityView.ts` | 保留 | 由快照与运行期刷新错误重新投影 |
| 预览会话 | `device-mirror` | 仅解除总览视频绑定；应用级会话与截图采样保持，返回复用 | 按持久化的预览偏好恢复模式 |
| 导航回调 | `DashboardWorkspace` | 稳定 | 重建 |

### 8. 兼容与维护约束

- 保持端点、响应信封、`la-pluma-dashboard-cache` v1、store 字段与 DOM/CSS 兼容（运行期新增 `lastRefreshError`，不持久化）；Query key 与默认策略以[Query 缓存与键规范](../../architecture/query-cache.md)为准。
- 行为变化：
 1. **温度点去重（缺陷修复）。** 迁移前 `useDashboardDeviceStats` 在 Activity 恢复重跑 Effect 时会把缓存中的同一份样本再追加一次，随后立即采样又追加一次，导致“近 N 秒”偏大。现在同一 `dataUpdatedAt` 的缓存回放只记录一次；新采样仍逐次追加。相关回归见 `useDashboardDeviceStats.test.tsx` 与 store 测试。
  2. **设备采样投影的启动时机。** 投影从页面顶层移到工作区（页面脱离骨架后）。骨架阶段没有设备区域，可见行为不变；采样间隔、暂停与失败保旧未变。
  3. **状态消息不再重渲染页面。** 流程卡通过 `notify` 发送提示，总览不再因全局通知正文整体重渲染；显示内容与计时器由 sonner 通知器持有。
  4. **执行订阅随工作区挂载。** 首屏骨架期间不再建立流程卡的执行订阅；骨架期间完成的 run 不产生页面内终态提示，全局运行投影仍独立展示。页面正常装载后的观察、身份与提示规则不变。
  5. **活动卡状态化。** `/agent/activity` 返回 `status`、`clientType`、来源时间与失败原因；卡片不再读取 `tip`/`description`/`isActive` 或用固定文案冒充加载态。成功空窗显示“暂无当前刷关活动”，来源失败显示“无法获取活动信息”；刷新失败保留旧快照并显示失败原因与上次成功时间，不再提供活动卡内重试入口。
  6. **连接告警 toast 化。** 原内联连接告警卡片移除，改由 `DashboardConnectionNotice` 发送常驻全局 toast：固定 id `dashboard-connection` 去重，`offline` 使用 warning 且不带 action，`unavailable` 使用 error 并附带“重试连接”action（复用完整快照协调器）；连接恢复、`unknown`、页面隐藏或卸载时 dismiss，`checking` 保持当前 toast。toast 不参与页面布局，出现/消失不再改变页面高度。流程卡不再重复连接标题/说明：`unknown`/`checking` 显示“正在检查服务 / 正在确认自动化服务状态”，`offline`/`unavailable` 显示“连接不可用 / 连接恢复后可以继续操作”。
  7. **概览卡片收敛。** 流程卡启动反馈条移除，启动结果统一经 `notify(..., { id: EXECUTION_NOTICE_ID })` 由全局 toast 呈现；命令区“运行状态”标签、开放关卡标题圆点与“当前活动”图标移除；活动时间窗口移到活动名称右侧，不再出现在 detail/meta；流程列宽测量不再扣除反馈行高度。
  8. **活动区控制行移除。** “当前活动”标题、“可能已过期”标记与活动重试按钮一并移除；活动区首行直接显示活动名称与时间窗口。失败刷新仍通过 detail/meta 保留失败原因与上次成功时间，恢复依赖自动刷新与连接通知的“重试连接”，卡内不再提供手动重试。
  9. **开放资源关卡标题收敛。** 开放关卡区标题改为“今日开放资源关卡”，移除右侧“N 个日常本”计数；关卡 chips 与空态文案保持不变。
  10. **命令区改为内容高度。** 移除流程卡命令区的 100px 最小高度，高度由 16px padding 与标题、说明、主按钮决定；骨架同步使用与 live 一致的行高并移除 100px / 142px 固定高度。三段之间统一使用 shared `Separator`。
  11. **掉落摘要单行合并。** `buildDropSummary` 新增跨关卡 `items` 展示串，卡片不再显示关卡代号，物品按数量倒序单行排列；溢出时只保留完整物品并以“、…”结尾，不截断半个物品。`recent` 保留按关卡聚合用于缓存兼容。
  12. **设备无样本仍渲染四卡。** `deviceStats` 为 null 时不再整段返回 null，四卡照常显示但无使用率条、内存/磁盘显示 `-- / --`、温度显示 `--` 与“等待温度采样”。养成摘要底部名称 chips 改为单行，溢出省略。

### 剩余边界

- 温度去重依赖 `dataUpdatedAt` 与缓存对象身份；同一毫秒内两次成功的完全相同采样在 Query 结构共享下可能被视为重复。5s 轮询下属于理论边界，未额外引入序列号。
- `DashboardSkeleton` 仍保留自己的网格测量与加载态 DOM，未纳入区域组件；首屏视觉依赖现有骨架结构。
- 总览没有展开/折叠状态；若后续新增，应按使用点留在对应区域，不进入快照 store。
- 流程区域只验证组合与局部展示；真实执行、停止与占用路径仍由执行控制器和既有页面/控制器测试覆盖。

## 完整快照与设备采样

### 1. 定位与边界

| 内容 | 唯一所有者 | 说明 |
| --- | --- | --- |
| 当前活动、定时执行状态 | `features/automation/model/queries.ts` | `automation/activity`、`automation/schedule-execution` 只读资源 |
| 养成队列 | `features/training/model/queries.ts` | `training/queue`，与养成页共享同一缓存身份 |
| 今日掉落、今日开放关卡 | `features/statistics/model/queries.ts` | `statistics/today-drops`、`statistics/open-stages` |
| 完整业务快照的读取与原子提交 | `features/dashboard/model/queries.ts`、`model/snapshotRefresher.ts` | 五路全部有效才提交；单路失败保留旧快照 |
| 快照形状与归一 | `features/dashboard/model/snapshot.ts`、`features/dashboard/model/dropSummary.ts` | 纯函数，不发起请求、不读写 store；掉落摘要按关卡合并在 `dropSummary.ts` |
| 展示投影与持久化缓存 | `features/dashboard/store/dashboardStore.ts` | `la-pluma-dashboard-cache` v1；只由完整快照持久化 |
| 设备采样 | `features/device-mirror/model/queries.ts`、`hooks/useDeviceStatsSample.ts` | `device-mirror/device-stats`，5s 轮询，独立失败策略 |
| 设备采样写入总览 | `features/dashboard/hooks/useDashboardDeviceStats.ts` | 每条成功样本交给 store 做语义校验与温度历史；同一 `dataUpdatedAt` 的缓存回放只追加一次 |
| 后端连接探针 | `features/runtime-status` | 不参与五路业务快照的有效性判定 |
| 日常/活动启动 | `features/dashboard/hooks/useDashboardExecution.ts` | 经应用级 task-execution 控制器提交，`scope: 'dashboard'` |

约束：

- **完整快照不是五个可独立展示的资源块。** 不得让五个 `useQuery` 各自写 `dashboardStore`，也不得把 Query 的逐块更新当成新的可写真相。
- **`dashboard/snapshot` 只用于协调读取。** 它的缓存不承担展示或持久化，成功后立即由 `dashboardStore` 原子提交；Query 参数见[Query 缓存与键规范](../../architecture/query-cache.md)。
- **设备采样与业务快照相互独立。** 采样失败不影响业务快照；业务刷新失败也不清除最新样本。

### 2. 五路读取与归一

`readDashboardSnapshot(client)` 并发读取五个领域 Query：

| 资源 | 读取 |
| --- | --- |
| 当前活动 | `getActivity(undefined, signal)`；不传 `clientType`，由服务端按连接 profile 的 `client_type` 解析 |
| 定时执行状态 | `getScheduleExecutionStatus(signal)` |
| 养成队列 | `getTrainingQueue(signal)` |
| 今日掉落 | `getTodayDrops(signal)` |
| 今日开放关卡 | `getOpenTodayStages(signal)` |

资源 key、协调快照 key 与 Query 参数以[Query 缓存与键规范](../../architecture/query-cache.md)为准。协调读取每次强制取最新值并关闭自动重试；单路失败由下个周期或失效入口重试。

`normalizeDashboardSnapshot` 负责兼容与校验：

- activity 必须通过 `normalizeActivityPayload`：`status` 为 active/none/unavailable/stale，`clientType`、`available`、`message` 与可空代号/名称/来源/时间戳、`stages`、`failure`、可选 `completion` 均按 `/agent/activity` DTO 校验；旧 `isActive`/`tip`/`description` 不再参与投影。
- schedule execution 必须是对象；`isRunning`/`running`/`executing` 归一为运行态，`lastResult`/`result`/`lastMessage` 走既有摘要格式化。
- training queue 接受数组或 `{ queue }`；drops 接受数组或 `{ records }`；open-today 必须是 `{ open, closed }`，两组均为 `{ stage, name }` 数组（每组最多 100 项）。
- 掉落摘要由 `model/dropSummary.ts` 的 `buildDropSummary` 合并当日逐条记录：`recent` 仍按关卡聚合（同一关卡一行、最多 3 个关卡），保留给缓存兼容；新增跨关卡合并的 `items`，物品按 `itemId`（缺失时按名称）累加并按数量倒序。卡片只显示 `items`，不显示关卡代号，单行显示；溢出时只保留完整物品并以“、…”结尾；`dropSummary.count` 仍是当日逐条记录数。原始逐条记录与数据页掉落列表不受影响。
- open-today 的 `gameDate`（`YYYY-MM-DD`）、`clientType` 与 `weekday` 描述服务端判定所用的游戏日：`weekday` 是客户端服务区时区下、每日 04:00 日界之后的星期，不是浏览器或宿主日历星期。展示只读 `open`/`closed`，新增字段缺失也不影响归一。
- 资源收集全开放活动期间，服务端按该客户端服务区在 MAA 活动表（`StageActivityV2.json`）中的 `resourceCollection` 窗口把所有资源本投影为开放，`closed` 为空；活动表不可读或不在窗口内时回落周表。该投影与养成计划、执行跳过同源，前端不区分全开放与周表开放。
- 任一载荷缺失、形状不符或 completion 越界时返回 `null`；协调器不会提交部分结果。

活动卡由 `model/activityView.ts` 投影为以下 phase：

| phase | 条件 | 卡片行为 |
| --- | --- | --- |
| `loading` | 没有快照且正在刷新；或旧 v1 摘要缺 `status` 且未失败 | 显示真实刷新文案 |
| `active` | 服务端 `status=active` 且最近一次快照刷新成功 | 显示名称/代号、右侧时间窗口、地区、来源与更新时间 |
| `none` | 服务端 `status=none` 且最近一次快照刷新成功 | 显示“暂无当前刷关活动” |
| `unavailable` | 服务端 `status=unavailable`，或首轮刷新失败且没有旧快照 | 显示失败原因 |
| `stale` | 服务端 `status=stale`，或最近一次快照刷新失败但有旧快照 | 保留旧活动与右侧时间窗口，显示失败原因与上次成功时间 |

当前活动卡只读展示；页面唯一的执行入口是“执行日常”，活动区不提供卡内重试。活动时间窗口作为 `duration` 显示在活动名称右侧；主视图的 detail/meta 只保留地区、来源、更新时间或上次成功、复刻标记与关卡数，不再重复时间窗口。多活动 chips 仍各自带窗口与关卡数。

### 3. 原子提交与失败策略

`dashboardSnapshotRefresher`（模块级单例）负责刷新节奏：

1. **单飞**：同一时刻只有一个协调读取；非 `force` 调用复用同一 promise。
2. **force 补一次**：`force` 在在途读取结束后再补一次，覆盖“读取过程中收到失效”的情况。
3. **后端探针不否决快照**：`probeBackendAvailability` 与五路并发，失败只影响连接健康展示；五路业务读取本身已证明后端可达。
4. **离线上报尝试**：浏览器离线时不发业务请求，但仍记录本次尝试并结束刷新。
5. **原子提交**：只有 `readDashboardSnapshot` 返回完整快照时调用 `dashboardStore.finishRefresh(attemptedAt, snapshot)`；失败调用 `finishRefresh(attemptedAt, undefined, message)`，保留旧业务值、旧 `lastUpdate` 与已持久化的完整缓存，只更新 `lastRefreshAttemptAt` 与运行期 `lastRefreshError`。
6. **预期失败静默**：`ApiRequestError`（API/contract/transport）与取消不写入控制台错误；失败原因仍经 `lastRefreshError` 交给活动卡展示，只有未知异常记录。

`dashboardStore` 仍执行第二道形状校验；非法快照不会覆盖缓存。完整快照提交时合并当前设备样本与温度历史，并写入 `la-pluma-dashboard-cache` v1。

### 4. 设备采样

- 采样 key 与 Query 参数见[Query 缓存与键规范](../../architecture/query-cache.md)；`deviceStatsQueryOptions` 把 Query 的 `signal` 传给 `/agent/device-stats`。
- `useDeviceStatsSample` 是页面观察入口：周期采样、挂载时立即重读，不叠加默认 Query 重试。
- 采样失败静默保留上一份成功数据；`data: null`（无设备）不覆盖旧样本。非法字段（百分比越界、非有限数值、形状错误）由 `dashboardStore.updateDeviceStats` 拒绝，不污染缓存或温度历史。
- 每次新的成功采样都会追加一个温度点（依赖 `dataUpdatedAt`，即使数值相同也不丢点），最多保留 36 个；同一份缓存样本在 Activity 恢复重跑 Effect 时不会重复追加（按 `dataUpdatedAt` 与样本身份去重）。样本本身不单独写 localStorage，随下一次完整业务快照提交一起持久化。
- Activity 隐藏/卸载会注销 Query 观察者并清理 5s 计时器；恢复时 `refetchOnMount: 'always'` 立即采样一次，再只建立一个周期计时器。文档隐藏时 Query 默认暂停后台轮询，可见后恢复。
- 设备采样不参与完整快照有效性，也不在 `dashboardStore` 中维护第二份可写资源。

### 5. 刷新调度、失效与恢复

`useDashboardSnapshotRefresh` 是页面的唯一同步入口：

- 首屏无缓存、距 `lastRefreshAttemptAt` 满 5 分钟，或恢复的 v1 活动摘要缺少 `status` 时刷新，否则只安排下一次；刷新完成后串行安排下一轮。
- 订阅 `dashboard-snapshot` 作用域：收到计划应用、识别完成、队列变更、资源/热更新等已批准的发布会 `force` 刷新；发布端仍按[共享资源归属与失效端口](../../architecture/resource-ownership.md)第 5 节列举作用域。
- Activity 隐藏时清理计时器与失效订阅；恢复时若期间有发布，`useResourceInvalidation` 补发一次 `activity-resume`，触发一次完整刷新。真正卸载后重挂载按首屏/新鲜度规则重新读取。
- 网络恢复（`online` 事件）`force` 刷新。
- 在途协调读取不因 Activity 隐藏中止；结果仍写入 store，隐藏期间完成的快照在恢复后直接可用。

统一执行入口的接线为：`useDashboardExecution` 调用 `executionController.submitExecution`，日常流程使用 `run_daily_flow` 与 `scope: 'dashboard'`；`scope` 只记录本入口发起，日常页按同一 `run_daily_flow` 接管这次执行的进度与停止。操作成功后的刷新仍走 `refreshDashboard`（force），不另建页面请求路径。目前该接线由 `DashboardFlowPanel` 经 `useDashboardFlowActions` 调用，刷新调度仍只有页面/工作区一份，语义不变（见[总览领域面板](#页面与面板)）。

### 6. 缓存与持久化边界

| 数据 | 位置 | 生命周期 |
| --- | --- | --- |
| 五路资源读取 | 各自领域 Query 缓存 | 协调读取强制取最新值；默认策略见[Query 缓存与键规范](../../architecture/query-cache.md) |
| 协调快照 | `dashboard/snapshot` | 只用于当前协调读取，不长期保留 |
| 展示快照 | `dashboardStore` | 进程内；完整快照才更新 `lastUpdate` |
| 持久化快照 | `la-pluma-dashboard-cache` v1 | 仅完整快照提交时写入；恢复校验版本/形状/语义边界/未来时钟偏差；活动摘要新增字段随快照持久化，旧 v1 条目缺 `status` 仍可恢复 |
| 刷新错误 | `dashboardStore.lastRefreshError` | 仅运行期；成功快照提交或 `reset()` 时清空 |
| 设备样本 | `device-mirror/device-stats` Query + `dashboardStore` | 内存；不单独持久化，随完整快照夹带 |

### 7. 兼容与已知行为差异

- 保持端点、响应信封、`la-pluma-dashboard-cache` v1 与 store 字段兼容；完整快照读取与提交统一经过协调器。
- 五路读取继承资源 Query 的信封/载荷校验与 `signal`；总览协调读取显式关闭自动重试，失败路径仍为一次请求后保留旧快照（迁移前不自动重试）。
- 设备轮询在文档隐藏时暂停，恢复可见后立即采样；迁移前每 5s 固定请求。轮询失败仍是静默保旧，不展示错误。
- 设备采样不再由 Dashboard 页面直接轮询；`updateDeviceStats` 接受未知载荷并在 store 内校验，避免把端点形状当成可信类型。
- Activity 恢复不再直接调用页面私有计时器；计时器由 Query 观察者与同步 hook 各自管理，隐藏时全部清理。
- `automation/activity` 由自动化领域 Query 持有，目前只由总览完整快照读取；不传 `clientType` 时 key 使用 `profile` 哨兵并由服务端连接 profile 解析，`schedule-execution` 仍由总览完整快照消费。

## 回归与关联

### 回归测试

以下路径相对于 `apps/web/src/`：领域回归在 `features/dashboard` 与 `pages/dashboard`，设备采样与预览会话回归在 `features/device-mirror`，跨域资源 key 回归在 `features/automation/model` 与 `features/statistics/model`；入口命令见[验证命令](#验证命令)。

关键不变量：

- 完整快照只做原子提交：单路失败、坏载荷或 completion 越界整体失败并保留旧快照；协调器单飞、`force` 补一次、探针不否决、预期失败静默。
- 活动卡 phase（loading/active/none/unavailable/stale）矩阵；`la-pluma-dashboard-cache` v1 的版本/形状/时钟偏差校验，失败刷新不覆盖成功缓存。
- 设备采样：同一 `dataUpdatedAt` 的缓存回放不重复追加温度点，新时间戳逐次追加（最多 36 个），`null` 载荷与非法字段保旧。
- 订阅隔离：采样投影返回 `null` 不推动兄弟区域重渲染，流程卡独占执行订阅与终态提示；预览入口不条件卸载、预览画面不导航。
- 连接通知：仅 `offline`/`unavailable` 发送固定 id 的常驻 toast，`checking` 保持当前通知，恢复自动 dismiss；离线不带 action，后端不可用时的“重试连接”复用完整快照协调器；通知组件返回 `null`，不改变页面布局。
- 掉落摘要：同关卡累加、跨关卡合并为 `items`、同物品按 `itemId` 合并；卡片不显示关卡代号，单行溢出省略；`recent` 保留按关卡聚合用于缓存兼容，原始逐条记录接口与数据页列表语义不变。

### 验证命令

以下命令均在仓库根目录执行。

```sh
pnpm --filter la-pluma-next-client exec vitest run \
  src/features/dashboard \
  src/pages/dashboard \
  src/features/device-mirror \
  src/features/automation/model \
  src/features/statistics/model \
  src/features/resource-invalidation \
  src/features/runtime-status
```

完整验证与视觉回归入口见[开发指南](../../development/README.md)。

### 关联契约

- [前端执行客户端与控制器](../../architecture/execution-client.md)
- [Query 缓存与键规范](../../architecture/query-cache.md)
- [共享资源归属与失效端口](../../architecture/resource-ownership.md)
- [前端架构与所有权](../README.md)
- [配置持久化协调器](../../architecture/config-persistence.md)
- [资源请求错误与取消契约](../../architecture/resource-requests.md)
