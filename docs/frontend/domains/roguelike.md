# 肉鸽

> [← 返回前端架构](../README.md) · [文档索引](../../README.md)

本文集中维护本领域的面板、模型与命令约定；通用契约通过链接引用。

- [页面、配置与命令](#页面配置与命令)
- [回归与关联](#回归与关联)

## 页面、配置与命令

配置草稿仍由 `user-config` 协调器持有，运行身份仍由 `task-execution` 控制器持有；页面/面板分别持有界面组合与只读数据投影，不新增第二份持久化或执行状态。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 页面壳与工作区组合 | `pages/roguelike/RoguelikeTasks.tsx` | 只渲染 `app-page`/`app-stack-section` 与工作区 |
| 当前模式、配置订阅、执行订阅与同步反馈 | `features/roguelike/components/RoguelikeWorkspace.tsx` | 跨面板状态的唯一容器；模式选择不写入持久化载荷 |
| 模式分段控件的键盘与高亮 | `features/roguelike/components/RoguelikeModePanel.tsx` | 组合共享 `SegmentedTabNav`：tablist/tab 语义、方向键移动焦点、Enter/Space 激活与流体高亮 |
| 主题快捷项与自定义代号 | `features/roguelike/components/RoguelikeThemePanel.tsx` | 从草稿派生值，编辑经回调交给工作区 |
| 高级字段与三态底部操作（空闲执行 / 运行中双停止 / 等待战斗结束） | `features/roguelike/components/RoguelikeSettingsPanel.tsx` | 只渲染当前生效的字段与注入的执行投影，不创建执行状态机 |
| 核心干员单选字段 | `features/roguelike/components/RoguelikeCoreOperatorField.tsx` | 复用 `features/training` 的 `OperatorSelectModal`；字段值仍是单个中文干员名，只读目录用于回显头像 |
| 配置 key、本地草稿、pending 与 300ms 提交 | `features/roguelike/model/roguelikeConfig.ts` + `features/user-config` | 配置适配器维持 key、本地键和 wire 协议 |
| 主题、模式、分队、职业组、难度与黑流树海枚举 | `features/roguelike/model/roguelikeOptionCatalog.ts` | 纯数据与候选项解析 |
| 两个任务的策略字段表 | `features/roguelike/model/roguelikeOptionTables.ts`、`reclamationOptionTables.ts` | CLI 参数名、Core 参数名、默认值、适用主题/模式、字段依赖与栅格跨度 |
| 字段表查询与下拉项解析 | `features/roguelike/model/roguelikeOptions.ts` | 只组装字段表与主题候选，不含 React 或执行状态 |
| 任务目录、主题快捷项、可见性、默认值、命令拼接与草稿归一化 | `features/roguelike/model/roguelikeTasks.ts` | 纯模型，不访问 React、Query、配置通道或网络 |
| 执行结果面板、保留上一次终态摘要、诊断入口 | `features/roguelike/components/RoguelikeResultPanel.tsx` | 只消费本页 owned run 与 `task-execution` 类型；不创建执行状态 |
| 结果摘要解析与展示投影 | `features/roguelike/model/runSummary.ts` | 防御式读取 `run.result.summary` / `run.error.details.summary`，非法载荷返回 null；纯函数 |
| CLI/动态任务执行计划与 Core 参数构造 | `features/roguelike/model/roguelikeExecution.ts` | 纯模型；决定走 CLI 还是 `run` + taskConfig |
| 执行前校验 | `features/roguelike/model/roguelikeValidation.ts` | 纯模型；返回面向用户的中文错误 |
| 运行提交、观察、停止（立即 / 等待战斗结束）与终态提示 | `features/roguelike/hooks/useRoguelikeExecution.ts` + `task-execution` | 页面只订阅一份快照并发送意图；额外暴露 `trackedRun` 供结果面板读取 |

维护约束：

- 不持久化 `activeMode`，也不把模式选择写进 `roguelike-tasks` 配置。
- 不改变服务端端点、配置 key、本地存储键或配置 wire 形状；停止请求与运行进度只做可选字段的增量扩展。
- 不在面板内复制配置、pending、停止确认或终态提示状态。

### 2. 组合与状态边界

```
RoguelikeTasks（app-page > app-stack-section > RoguelikeWorkspace）
└─ RoguelikeWorkspace（配置/执行/模式唯一容器）
   └─ SegmentedTabs（模式受控上下文）
      ├─ RoguelikeModePanel（共享 SegmentedTabNav + 高亮）
      ├─ SegmentedTabPanel（单个稳定区域 roguelike-mode-panel，display: contents）
      │  ├─ RoguelikeThemePanel（主题快捷项 + 自定义输入）
      │  ├─ RoguelikeSettingsPanel（高级字段 + 三态执行操作）
      │  └─ RoguelikeResultPanel（结果摘要 + 辅助诊断）
      └─ aside（DeviceMonitorPanel，共享实时会话）
```

- **当前模式**是跨面板的局部交互状态：它决定主题与高级字段面板展示哪一份 `taskInputs`/`advancedParams`。它不进入配置 wire；`Activity` 隐藏/恢复保留，真正卸载或刷新后回到默认的 `roguelike`。
- **配置草稿**只由工作区的一次 `useUserConfig(roguelikeConfigAdapter)` 读取。主题与高级字段编辑分别合并当前 `taskInputs`/`advancedParams` 后交给同一个通道；页面、面板都不直接调用 `saveUserConfig`/`loadUserConfig` 或写 `localStorage`。
- **同步反馈**由工作区从通道的 `error`/`syncState` 派生：失败时显示页内 `role="alert"` 与“重新同步”，`syncState === 'saving'` 期间按钮显示“同步中”；只有手动 `retry()` 返回 true 才提示“肉鸽配置已同步”。
- **执行**只由工作区的一次 `useRoguelikeExecution` 订阅。设置面板拿到的是 `isRunning`/`isStopping`/`isWaitingForCombat`/`pendingStopMode`/`isSubmitting` 与 `onExecute`/`onStop(mode)` 投影；停止确认、等待意图、终态提示和 run 身份仍由 hook/控制器持有，面板没有第二份状态机。结果面板另取同一次订阅返回的 `trackedRun`，不新建观察者。
- **停止**分两种意图：运行中左「立即终止」发 `mode: 'now'`，右「等待战斗结束」发 `mode: 'after-combat'`；空闲态仍是单个「立即执行」。`after-combat` 被受理后 run 仍是 `running`，等待态由 `trackedRun.progress.stopIntent`（或刚收到的 `pendingStop`）派生，右侧按钮禁用并提示最多等待 10 分钟，左侧保持可点用于取消等待并立即停止；响应没有 `pendingStop` 表示服务端退化为立即停止，页面提示“未在战斗中，已立即终止”而不进入等待态。等待态不属于停止确认，不触发 15s 确认超时。
- 模式面板使用共享 `SegmentedTabNav`，不持有测量或键盘状态。模式网格无法用单个面板包裹多个 grid-area，因此工作区保留 `roguelike-workspace-grid`，把主题、结果与设置面板放进 `display: contents` 的 `SegmentedTabPanel`；所有模式 tab 的 `aria-controls` 指向稳定的 `roguelike-mode-panel`，`aria-labelledby` 指向当前 tab。方向键/Home/End 只移动 roving focus，Enter/Space 或点击才切换模式。

### 3. 纯命令模型

字段与候选项归 `features/roguelike/model/roguelikeOptions.ts`，命令规则归 `roguelikeTasks.ts`：

| 导出 | 作用 |
| --- | --- |
| `ROGUELIKE_TASKS` | 集成战略/生息演算的任务名、命令、图标、占位与描述 |
| `ROGUELIKE_THEME_PRESETS` | 各模式的主题快捷项；只影响界面，不进入 wire |
| `DEFAULT_RECLAMATION_MODE` | 生息演算默认模式 `'1'`，与 CLI 的 `-m` 缺省一致 |
| `getRoguelikeAdvancedOptions(taskId)` | 策略字段表及其 CLI 参数名 `param` 与 Core 参数名 `coreParam`，含 `defaultValue`、`hint`、`themes`、`modes`、`requires`、`listChoices` 与栅格跨度 `span`；未知任务返回空表 |
| `getRoguelikeOptionChoices(option, theme, taskId)` | 下拉项：模式、难度、分队与职业组按主题与任务返回候选，其余字段用静态 `options` |
| `resolveRoguelikeAdvancedValue(option, advanced, theme, taskId)` | 字段显示值：显式值优先，其次默认值，select 最后回落到当前主题的首项；默认值不属于当前主题时同样回落到首项（重启锚点没有模式 `1`） |
| `isRoguelikeOptionVisible(option, taskId, theme, advanced)` | 字段在当前主题、模式与依赖字段下是否生效；隐藏字段既不下发也不显示 |
| `isRoguelikeOptionValueValid(option, theme, value, taskId)` | 下拉值是否属于当前主题的候选表；非下拉字段恒为有效 |
| `isKnownRoguelikeTheme(taskId, theme)` | 主题代号是否属于该任务的已知目录 |
| `normalizeRoguelikeModeForTheme(taskId, theme, advancedParams)` | 切主题时把新主题不支持的模式重置为该主题的默认模式（沙洲遗闻 `1`、重启锚点 `16`），没有默认值才回落到首项，其余字段保留 |
| `splitRoguelikeListValue(value)` | 列表字段按逗号、顿号、分号与空白切分 |
| `normalizeRoguelikeAdvancedParams(advancedParams)` | 补齐缺失或为空的默认值；无变化时返回原引用，不修改入参 |
| `buildRoguelikeCommandParams(taskId, taskInputs, advancedParams)` | 主题代号在前，生效字段按字段表顺序追加；只包含有 CLI 参数名的字段 |
| `requiresRoguelikeDynamicTask(taskId, taskInputs, advancedParams)` | 主题/模式不在 maa-cli 枚举内，或设置了只有 Core 参数名的字段时返回 true |
| `buildRoguelikeDynamicTaskConfig(taskId, taskInputs, advancedParams)` | 把生效字段换成 Core 参数名并构造 `{ name, type, params }`；补齐 CLI 缺省与 Core 缺省不一致的字段 |
| `buildRoguelikeExecutionPlan(taskId, taskInputs, advancedParams)` | 返回 `{ command, params, taskConfig }`：CLI 可行时保持原命令，否则换成 `run` + taskConfig |
| `validateRoguelikeTaskInput(taskId, taskInputs, advancedParams)` | `roguelikeValidation.ts`：主题必须已知；生效下拉值必须属于当前主题候选表；数字与列表字段必须合法；沙洲遗闻模式 1 要求显式填写制作工具与批次数；刷坍缩范式要求期望范式、刷常乐节点要求目标节点、黑流树海刷开局要求合法动物与奖励；未知任务交给调用方 |

命令拼接规则：

- 空字符串、未勾选的 checkbox、未设置的字段、当前主题/模式不适用的字段、不属于当前主题候选表的下拉值与没有 CLI 参数名的字段不写入命令；checkbox 为 true 时只追加参数名。
- 非 checkbox 字段追加 `参数名 值`；取值为负整数时改用 `参数名=值` 单 token 下发（如难度「不切换」的 `--difficulty=-1`），避免 clap 把空格后的负数当成未知选项；`list` 字段按切分后的每一项重复参数名（`--expected-collapsal-paradigms 目空一些 --expected-collapsal-paradigms 图像损坏`）。
- 数字字段只接受整数并限定在字段范围内：运行次数、投资次数与批次数为 `1–2147483647`；空值表示未设置，但沙洲遗闻模式 1 的批次数必填。小数、指数、负数或越界值不会写入命令，执行前校验会返回明确错误。
- 声明 `defaultValue` 的字段在缺失或为空时解析为默认值并始终写入：生息演算 `-m` 因此始终出现，沙洲遗闻缺省为 `1`、重启锚点为 `16`；开局职业组缺省 `稳扎稳打`，避免空缺时 Core 按固定位置点选职业组、与核心干员的职业不匹配。
- 未声明默认值的 select 不写命令：集成战略 `--mode` 继续省略，与 CLI 缺省 `0` 一致；界面显示由 `resolveRoguelikeAdvancedValue` 回落到当前主题的首项。
- 集成战略主题目录为傀影、水月、萨米、萨卡兹、界园与黑流树海；模式候选按主题收敛：通用 `0`（刷分）、`1`（刷源石锭）、`4`（刷开局）、`6`（刷月度小队）、`7`（刷深入调查）；萨米额外 `5`（刷坍缩范式）、萨卡兹额外 `10001`（快速通过第一层）、界园额外 `20001`（刷常乐节点）、黑流树海只有 `0`、`1`、`30001`（刷襁褓动物）与 `30003`（刷开局并保留目标局）。
- 生息演算主题目录为沙洲遗闻与重启锚点；沙洲遗闻模式 `0`（无存档刷繁荣度）、`1`（制作工具刷繁荣度），重启锚点模式 `16`（RA-1）、`32`（RA-15）、`48`（RA-4）。
- 字段的适用条件由字段表声明：`themes` 限定主题（如密文板只对萨米、指路鳞只对水月、种子只对萨卡兹刷源石锭、黑流树海参数只对黑流树海），`modes` 限定模式（如凹直升只对刷开局、第五层前停止只对刷分、投资多刷分只对刷源石锭、常乐节点只对 `20001`、黑流动物与开局奖励只对 `30003`），`requires` 依赖另一字段（如非好友助战依赖使用助战、投资次数依赖未禁用投资；种子与凹开局密文板还通过 `oneOf` 限定分队）。
- 种子开局是文本参数：命令追加 `--start-with-seed <种子>`（例如 `2b3c4d,rogue_1,120`），不是无值开关；仅在萨卡兹刷源石锭模式且分队为点刺成锭或后勤时显示与下发。
- 凹开局密文板仅在萨米刷开局模式与生活至上分队下显示与下发；其他分队在开局奖励阶段不会获得密文板。
- 生息演算的制作工具名称、加号点击方式与批次数仅在模式 1（制作工具刷繁荣度）显示与下发；`toolsToCraft` 是列表参数，多个工具重复 `-C`（`-C 荧光棒 -C 发电机`）。工具名称与批次数在模式 1 下由表单要求显式填写：maa-cli 在省略 `-C` 时会默认制作 16 批荧光棒，执行前校验要求用户确认；服务端 CLI 预检与动态任务预检都会拒绝缺少 `--tools-to-craft` 的模式 1 配置。模式 0 只使用“任务完成后清空商店”开关，该字段没有 CLI 参数，只能走动态任务。
- 例：`taskInputs.roguelike = 'Sarkaz'`，高级值 `{ mode: '1', squad: '蓝图测绘分队', useSupport: true }` 生成
  `Sarkaz --mode 1 --squad 蓝图测绘分队 --roles 稳扎稳打 --use-support`；`taskInputs.reclamation = 'Tales'` 配合 `{ mode: '1', toolsToCraft: '荧光棒，发电机', incrementMode: '1', numBatches: 16 }` 生成 `Tales -m 1 -C 荧光棒 -C 发电机 --increment-mode 1 --num-craft-batches 16`；模式 0 配合 `{ mode: '0' }` 生成 `Tales -m 0`。
- 生息演算模式字段声明 `hint`，说明两个主题各自的模式、存档与起始界面要求；面板只原样透传，文案归模型维护。
- 核心干员是单选字段而不是文本输入：点击后打开共享干员选择模态窗（有识别数据只列已拥有干员，无数据回退全量目录），选择结果只把干员中文名写回原字段；空值保持“未设置”，命令不写 `--core-char`，动态任务不写 `core_char`。字段不显示识别/拥有状态说明。旧草稿里的中文名按干员目录匹配回显头像与名字，匹配不到时原样显示并允许重新选择。
- 校验 trim 输入判断是否为空，不修改实际传给 CLI 的主题字符串。

面板只渲染 `isRoguelikeOptionVisible` 过滤后的字段：主题、模式与开关变化会同时改变字段集合、命令参数与“N 项”计数。草稿里保留的旧主题取值不删除，但下拉值必须属于当前主题的候选表：越界值在下拉项中标注“不适用于当前主题”，执行前校验会拒绝并提示重新选择，命令构造也不会写入；隐藏字段的残留值不参与校验与下发。

模型不读取配置通道或执行状态，因此可以用纯 Node 测试覆盖目录、参数顺序、可见性、空值过滤、默认值解析、归一化与校验。

### 4. 执行路径：CLI 与动态任务

maa-cli 0.7.8 只认识部分主题、模式与参数；MaaCore 新增的黑流树海、界园常乐节点、萨卡兹快速通过、重启锚点、`increment_mode` 之外的开局/结算开关等都只能通过 dynamic task 下发。工作区调用 `buildRoguelikeExecutionPlan` 得到执行计划：

- `taskConfig` 为 `null` 时保持原有 `command=roguelike|reclamation` 与空格分隔参数，停止、轮询与结果展示语义不变。
- 主题或模式不在 CLI 枚举内，或设置了仅声明 Core 参数名的字段时，改用 `command=run`，首参是 `roguelike` / `reclamation` 任务前缀，`taskConfig` 为 `{ name, type: 'Roguelike'|'Reclamation', params }`。服务端复用既有动态任务通路生成临时任务文件并执行，不需要新的顶层请求字段。
- Core 参数由字段表的 `coreParam`/`coreType` 生成；`disableInvestment`、`noStopWhenInvestmentFull` 这类与 Core 布尔字段语义相反的开关按 `coreInvert` 取反。CLI 缺省与 Core 缺省不一致的字段在动态任务中显式补齐（CLI 默认投资满时停止，因此动态任务补 `stop_when_investment_full: true`；刷开局模式补空的 `blackflow_start_animals`/`blackflow_start_rewards`）。
- 动态任务提交仍由 `useRoguelikeExecution` 落到 `run_task`，幂等键、Run 身份、停止与终态提示与 CLI 路径共用同一套控制器。

服务端对两条通路都做校验：动态任务参数由 `validateGameTaskParams('Roguelike'|'Reclamation', params)` 校验主题、模式组合、字段类型、常乐节点目标、黑流动物/奖励与重启锚点模式；CLI 参数由 `validateRoguelikeCommandArgs` 在创建 Run 之前预检，主题、模式或加号点击方式越界时返回 `AGENT_VALIDATION_TASK_ARGS_INVALID`，不再把只有 Core 支持的取值静默透传给 maa-cli 报错。

### 5. 执行结果与辅助诊断

结果面板只消费本页 owned 的 `trackedRun`，不新增执行订阅或第二份状态：

| 内容 | 规则 |
| --- | --- |
| 摘要来源 | 成功读 `run.result.summary`，失败读 `run.error.details.summary`；`features/roguelike/model/runSummary.ts` 逐字段校验，缺失或非法返回 null，原始错误文本不进入摘要 |
| 摘要素材 | 服务端从本次执行增量日志的结构化回调构建：结算、投资、战斗次数、事件与选项、通宝交换、里程碑、警告与任务链终态；生息演算没有专用回调，只表达任务链终态与主题 |
| 状态投影 | `status` 只取 `success`/`failed`/`stopped`/`incomplete`；`incomplete` 不能展示为成功 |
| 保留上一次结果 | 新 run 活动期间仍展示最近一次终态摘要（标注“上次执行结果”），不把活动 run 当成功；Activity 隐藏/恢复保留，真正卸载后重建 |
| 无摘要 | 显示“本次执行没有可用的结构化结果”，不回退原始 stderr |
| 辅助诊断 | 面板内 `RuntimeDiagnosticsPanel`（`runtime-status` 域）懒加载 `GET /agent/diagnostics`，传入当前任务 command；四项检查（运行环境、设备连接、资源完整性/版本、任务预检）输出可读结论、证据与定位信息 |
| 诊断生命周期 | 请求由 `useRuntimeDiagnostics` 持有：单在途、可取消、卸载取消；失败保留旧报告，取消不显示为失败；不写入 Query、store 或持久化 |

结果面板与诊断不改变执行身份、提交、停止或终态提示；页面仍只经控制器观察 run。

### 6. Activity 与卸载

- `Activity` 隐藏会清理工作区与共享 `SegmentedTabNav` 的 Effects（执行 hook 的确认计时器、`useFluidTabIndicator` 的 ResizeObserver/resize 监听），但保留 React state：当前模式、已加载草稿和面板输入不变。恢复时不会重新读取服务端配置（通道的 hydrated 守卫），也不会重放执行提交。
- 真正卸载/刷新会销毁 `activeMode` 与面板输入；配置草稿、pending 标记与在途提交仍属于应用级 `user-config` 通道，重新挂载后继续使用；运行身份由 `task-execution` 控制器持久化，页面重新订阅同一 run，不重新提交。
- 页面隐藏或 Activity 隐藏不改变后台 Run 的所有权；停止仍按控制器持有的 `runId` 执行。

### 7. 兼容与维护约束

- 配置 key、本地草稿、pending 与 wire 形状以[配置持久化协调器](../../architecture/config-persistence.md)为准；面板不另建持久化格式。
- 服务端端点、执行提交参数与幂等键语义未变化；停止仍走控制器 `stopTrackedRun({ mode })`，`mode` 与 `pendingStop`/`stopIntent` 都是增量字段，缺省请求仍是原来的立即停止。结果摘要只是 Run 载荷的增量字段，客户端缺失时显示“无可用结果”，不从退出码或消息推断成功。
- 辅助诊断端点只读，除 ADB 连接探测外无副作用、不创建 Run；诊断会话不进入 Query、`statusStore`、localStorage 或 URL。
- 保持渲染结构、DOM/CSS 类名与字段 `id`；字段键沿用迁移后的 camelCase，新增字段按含义插入相应分组，不改动已有键。核心干员字段的控件从原生输入换成按钮触发器，但字段 `id`、配置键与 wire 值保持不变。
- 字段的默认值语义以命令模型为准：生息演算默认模式为 `1`，集成战略默认职业组为 `稳扎稳打`；两者都会写入 wire 与命令。
- 面板只组合命令模型、配置适配器、执行控制器与只读诊断；不在页面恢复独立的配置、执行或诊断状态。

## 回归与关联

### 回归测试

以下路径相对于 `apps/web/src/`：领域回归在 `features/roguelike` 与 `pages/roguelike`；入口命令见[验证命令](#验证命令)。

关键不变量：

- 命令拼接：空值与未勾选项不写入，声明 `defaultValue` 的字段始终写入（沙洲遗闻 `-m 1`、重启锚点 `-m 16`、集成战略 `--roles 稳扎稳打`），未声明默认值的 select 省略（集成战略 `--mode`），主题/模式不适用的字段、不属于当前主题候选表的下拉值与非法整数不写入；列表字段逐项重复参数名；没有 CLI 参数名的字段不进入命令行。
- 执行路径：主题、模式或字段全部被 maa-cli 支持时保持原 CLI 命令；黑流树海、`10001`/`20001`/`30001`/`30003`、重启锚点、`clearStore` 或任一只有 Core 参数名的开关生效时改写为 `run` + taskConfig，且动态参数补齐 CLI 缺省与 Core 缺省不一致的字段。
- 可见性：主题专属字段随主题切换隐藏并停止下发，模式专属字段随模式切换隐藏；`requires` 未满足时隐藏（含开关缺省为关的情况）。
- 取值有效性：生效下拉值必须属于当前主题候选表，越界值在面板中标注且执行被拒绝；数字字段只接受范围内的整数；隐藏字段的残留值不影响校验。
- 校验：主题 trim 后非空且属于已知目录；生效下拉值越界、数字非整数或越界、列表项不在候选表、刷坍缩范式缺少期望范式、刷常乐节点缺少目标节点、黑流树海刷开局动物超过两项/羽蛇超过一项、培育目标与黑流策略不匹配时拒绝提交，切换主题后模式重置为该主题的默认模式（沙洲遗闻 `1`、重启锚点 `16`，无默认值才回落到首项）。
- 归一化不修改入参；`resolveRoguelikeAdvancedValue` 的首项回落只用于显示，不参与命令构造；重启锚点草稿缺少模式时归一化补 `16`。
- 旧草稿：没有新字段的 wire 与本地草稿仍可读，未知扩展字段与显式值原样往返。
- 模式是局部状态：不进入配置 wire，跨模式草稿合并、空主题拒绝，Activity 隐藏保留而真正卸载回到 `roguelike`。
- 执行接线：按当前模式提交，停止/超时/失败/断线恢复由控制器 runId 持有，不重新提交；等待战斗结束期间 run 仍是 `running`，页面不触发 15s 停止确认超时，也不显示“正在终止”。
- 结果摘要：成功读 `run.result.summary`、失败读 `run.error.details.summary`；字段缺失或类型不符解析为 null 并显示“无可用结果”，不把活动 run、原始 stderr 或退出码当作结算；新 run 活动期间保留上次终态摘要并标注，Activity 隐藏/恢复保留，真正卸载重建。
- 辅助诊断：默认不发起请求；显式运行后单在途、可取消，取消不显示为失败，失败保留旧报告；当前任务 command 透传到诊断请求；每项检查保留可读 summary、证据与定位信息。

### 验证命令

以下命令均在仓库根目录执行。

```sh
pnpm --filter la-pluma-next-client exec vitest run src/features/roguelike src/features/runtime-status src/pages/roguelike
```

完整验证与视觉回归入口见[开发指南](../../development/README.md)。

### 关联契约

- [配置持久化协调器](../../architecture/config-persistence.md)
- [前端执行客户端与控制器](../../architecture/execution-client.md)
- [前端架构与所有权](../README.md)
