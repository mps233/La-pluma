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
| 当前模式、配置订阅、执行订阅、读取门控与同步反馈 | `features/roguelike/components/RoguelikeWorkspace.tsx` | 跨面板状态的唯一容器；模式选择不写入持久化载荷；配置未就绪时只门控可编辑区 |
| 模式分段控件的键盘、选中态与禁用 | `features/roguelike/components/RoguelikeModePanel.tsx` | 组合共享 `SegmentedTabNav`（内部为 shadcn Tabs）：tablist/tab 语义、方向键移动焦点、Enter/Space 激活与禁用；`disabled` 由工作区的可编辑判定注入 |
| 主题快捷项、自定义代号与主题字段错误 | `features/roguelike/components/RoguelikeThemePanel.tsx` | 从草稿派生值，编辑经回调交给工作区；`disabled` 与 `error` 由工作区注入 |
| 高级字段、配置读取占位与三态底部操作（空闲执行 / 运行中双停止 / 等待战斗结束） | `features/roguelike/components/RoguelikeSettingsPanel.tsx` | 只渲染当前生效的字段、注入的执行投影与 `editable`/`fieldError`；执行与停止之间的焦点移交也在这里；不创建执行状态机 |
| 核心干员单选字段 | `features/roguelike/components/RoguelikeCoreOperatorField.tsx` | 复用 `features/training` 的 `OperatorSelectModal`；字段值仍是单个中文干员名，只读目录用于回显头像 |
| 配置 key、本地草稿、pending 与 300ms 提交 | `features/roguelike/model/roguelikeConfig.ts` + `features/user-config` | 配置适配器维持 key、本地键和 wire 协议 |
| 主题、模式、分队、职业组、难度与黑流树海枚举 | `features/roguelike/model/roguelikeOptionCatalog.ts` | 纯数据与候选项解析；生息演算默认模式也定义在这里 |
| 两个任务的策略字段表 | `features/roguelike/model/roguelikeOptionTables.ts`、`reclamationOptionTables.ts` | CLI 参数名、Core 参数名、默认值、适用主题/模式、字段依赖、说明文案与栅格跨度 |
| 字段表查询与下拉项解析 | `features/roguelike/model/roguelikeOptions.ts` | 只组装字段表与主题候选，不含 React 或执行状态 |
| 任务目录、主题快捷项、可见性、默认值、命令拼接、模式归一化与草稿归一化 | `features/roguelike/model/roguelikeTasks.ts` | 纯模型，不访问 React、Query、配置通道或网络 |
| 执行进度面板、模式过滤与任务归属 | `features/roguelike/components/RoguelikeProgressPanel.tsx` | 只消费 `mode`、`trackedRun`、`lastRun`、`hasSnapshot`、`resolvingIdentity` 与 `taskName` 标签，不创建执行状态 |
| 运行进度快照解析、`mode` 归一、模式匹配与终态回退 | `features/roguelike/model/runProgress.ts` | 纯函数；读取 `progress.roguelike` 与 `summary.progress`，模式不匹配时拒绝展示，不从缺失字段推断数值 |
| 结果摘要解析与展示投影 | `features/roguelike/model/runSummary.ts` | 防御式读取 `run.result.summary` / `run.error.details.summary`，非法载荷返回 null；纯函数 |
| CLI/动态任务执行计划与 Core 参数构造 | `features/roguelike/model/roguelikeExecution.ts` | 纯模型；决定走 CLI 还是 `run` + taskConfig |
| 执行前字段校验 | `features/roguelike/model/roguelikeValidation.ts` | 纯模型；返回首个无效字段的 `{ key, message }`，兼容入口仍返回字符串消息 |
| 运行提交、观察、停止（立即 / 等待战斗结束）与终态提示 | `features/roguelike/hooks/useRoguelikeExecution.ts` + `task-execution` | 页面只订阅一份快照并发送意图；额外暴露 `trackedRun`/`trackedRunLabel`、`lastRun`、`hasSnapshot`、`resolvingIdentity` 与活动模式的 `trackedCommand`；`trackedCommand` 供工作区对齐活动模式 |

维护约束：

- 不持久化 `activeMode`，也不把模式选择写进 `roguelike-tasks` 配置。
- 不改变服务端端点、配置 key、本地存储键或配置 wire 形状；停止请求与运行进度只做可选字段的增量扩展。
- 不在面板内复制配置、pending、停止确认或终态提示状态。

### 2. 组合与状态边界

```
RoguelikeTasks（app-page > app-stack-section > RoguelikeWorkspace）
└─ RoguelikeWorkspace（配置/执行/模式唯一容器）
   └─ SegmentedTabs（模式受控上下文）
      └─ DeviceMonitorLayout(mode)
         ├─ RoguelikeModePanel（共享 SegmentedTabNav）
         ├─ SegmentedTabPanel（单个稳定区域 roguelike-mode-panel，display: contents）
         │  ├─ RoguelikeThemePanel（主题快捷项 + 自定义输入）
         │  ├─ RoguelikeSettingsPanel（高级字段 + 三态执行操作）
         │  └─ RoguelikeProgressPanel（执行进度 + 任务归属）
         └─ device-monitor-column
            └─ DeviceMonitorPanel（共享实时会话）
```

- **当前模式**是跨面板的局部交互状态：它决定主题与高级字段面板展示哪一份 `taskInputs`/`advancedParams`。它不进入配置 wire；`Activity` 隐藏/恢复保留，真正卸载或刷新后回到默认的 `roguelike`。
- **配置草稿**只由工作区的一次 `useUserConfig(roguelikeConfigAdapter)` 读取。主题与高级字段编辑分别合并当前 `taskInputs`/`advancedParams` 后交给同一个通道；页面、面板都不直接调用 `saveUserConfig`/`loadUserConfig` 或写 `localStorage`。
- **配置读取门控**：工作区以 `loadState === 'ready'` 判定配置就绪，并以 `isRunning || isSubmitting` 判定执行锁定；只有 `configReady && !isLocked` 时可编辑。未就绪时外壳、执行进度面板与底部操作区仍渲染；模式 tab 与主题预设/输入禁用，设置面板主体改为读取中 `Loading`（`role="status"`）或失败时 `InlineAlert`（`role="alert"`，含 `loadError` 与「重新加载」），高级字段、开关与核心干员区不渲染，执行按钮禁用。失败态的「重新加载」调用 `reload({ force: true })`。已有活动 run 时停止入口不因门控丢失。
- **配置同步反馈**：失败只通过固定 id `roguelike-config-save` 的 error toast 展示，附带「重新同步」action；action 调用 `retry()`，`syncState === 'saving'` 期间忽略重复触发。错误清空时关闭同 id toast；手动重试返回 true 后才提示「肉鸽配置已同步」。页面不再渲染页内 `role="alert"` 同步错误或重试按钮，也不显示同步中按钮文案。
- **执行**只由工作区的一次 `useRoguelikeExecution` 订阅。设置面板拿到的是 `isRunning`/`isStopping`/`isWaitingForCombat`/`pendingStopMode`/`isSubmitting` 与 `onExecute`/`onStop(mode)` 投影；停止确认、等待意图、终态提示和 run 身份仍由 hook/控制器持有，面板没有第二份状态机。执行进度面板另取同一次订阅返回的 `trackedRun`、`lastRun`、`hasSnapshot` 与 `resolvingIdentity`，按当前模式过滤后渲染，不新建观察者。启动提交不推送常驻进度 toast，运行反馈由「正在启动」按钮与执行进度面板承担；停止请求与终态仍使用固定 id `execution`。
- **运行期锁定**：运行或提交在途时 `editable=false`，模式 tab 输出 `aria-disabled`，主题预设与输入、高级字段、开关、核心干员的更换与清除全部禁用，开始按钮禁用；提交中按钮以 `aria-busy` 显示「正在启动」。停止按钮不受配置门控或字段锁定影响，运行中始终可达。
- **停止**分两种意图：运行中左「终止」发 `mode: 'now'`，右「等待战斗结束」发 `mode: 'after-combat'`；空闲态仍是单个「开始」。`after-combat` 被受理后 run 仍是 `running`，等待态由 `trackedRun.progress.stopIntent`（或刚收到的 `pendingStop`）派生，右侧按钮禁用并提示最多等待 10 分钟，左侧保持可点用于取消等待并立即停止；响应没有 `pendingStop` 表示服务端退化为立即停止，页面提示“未在战斗中，已立即终止”而不进入等待态。等待态不属于停止确认，不触发 15s 确认超时。
- **字段校验**：执行前校验返回首个无效字段的 `{ key, message }`；工作区把错误交给设置面板与主题面板，在对应控件上设置 `aria-invalid` 与指向 `<字段 id>-error` 的 `aria-errormessage`，控件外用共享 `FieldError` 显示同一错误文本。设置错误后聚焦首个无效字段，主题字段聚焦 `roguelike-<taskId>-theme`，其余字段聚焦 `roguelike-<taskId>-<key>`；编辑该字段时立即清除对应错误。全局 toast 只保留执行与全局错误，不再重复字段校验文案。
- **主题归一化**：主题输入是自由文本，输入过程中的 `S`、`Sark` 等未知中间态不触发模式归一化，草稿中的模式保持不变；只有确认主题属于当前任务目录时，编辑才按新主题重置不支持的模式。执行前再做一次归一化，避免旧草稿或绕过编辑的取值把越界模式带进命令。
- **执行进度与焦点**：执行进度面板按当前模式只读本页 owned run 与匹配的 `lastRun`；首屏快照未到达或身份恢复尚未取回详情时显示加载态，活动期展示 `progress.roguelike`，终态展示 `summary.progress` 或摘要回退；徽章只表达任务状态，通关结果单独成行。模式切换时面板以 `key={mode}` 重建，旧模式结果不会串入。点击开始后记录意图，run 进入活动态时聚焦「终止」；点击停止后，run 离开活动态时焦点回到「开始」。等待战斗结束期间 run 仍活动，焦点不回到「开始」。
- 模式面板使用共享 `SegmentedTabNav`（内部为 shadcn Tabs），不持有测量或键盘状态。工作区网格由 `DeviceMonitorLayout(mode)` 持有：模式面板与 `display: contents` 的 `SegmentedTabPanel` 直接作为网格项，主题/执行进度列与设置面板分别输出 `data-monitor-area="main"` / `"settings"`，设备画面位于 monitor 列并在宽屏跨两行；monitor 列输出 `data-monitor-area="monitor"` 与 `device-monitor-column`，面板输出 `device-monitor-panel`；页面网格仍定义 mode/main/settings/monitor 四个具名区域，monitor 的画面样式由 device-mirror 持有。宽屏下 mode 行高度由模式控件内容决定（`grid-template-rows: max-content auto`），不用固定行高复刻模式 tab 壳的 padding 与边框。所有模式 tab 的 `aria-controls` 指向稳定的 `roguelike-mode-panel`，`aria-labelledby` 指向当前 tab。方向键/Home/End 只移动 roving focus，Enter/Space 或点击才切换模式。
- **界面文案**：模式 tab 只保留图标与名称；主题与策略设置标题只渲染 `h2`，不再有说明段落或字段计数，主题标题保留「N 个可用」徽标。字段行统一用共享 `Field`/`FieldLabel`/`FieldError` 组合，错误状态同时标记 `data-invalid` 与控件的 `aria-invalid`；字段说明统一放到标签旁的 `FieldHint`。开关行同样使用 `Field`，开关说明使用 `FieldHint`，并把同一文案作为常驻 `sr-only` 描述关联到 `aria-describedby`。

### 3. 纯命令模型

字段与候选项归 `features/roguelike/model/roguelikeOptions.ts`，命令规则归 `roguelikeTasks.ts`：

| 导出 | 作用 |
| --- | --- |
| `ROGUELIKE_TASKS` | 集成战略/生息演算的任务名、命令、图标与占位 |
| `ROGUELIKE_THEME_PRESETS` | 各模式的主题快捷项；只影响界面，不进入 wire |
| `DEFAULT_RECLAMATION_MODE` | 生息演算默认模式 `'1'`，与 CLI 的 `-m` 缺省一致；定义在 `roguelikeOptionCatalog.ts`，`roguelikeTasks.ts` 只 re-export |
| `getRoguelikeAdvancedOptions(taskId)` | 策略字段表及其 CLI 参数名 `param` 与 Core 参数名 `coreParam`，含 `defaultValue`、`hint`、`themes`、`modes`、`requires`、`listChoices` 与栅格跨度 `span`；未知任务返回空表 |
| `getRoguelikeOptionChoices(option, theme, taskId)` | 下拉项：模式、难度、分队与职业组按主题与任务返回候选，其余字段用静态 `options` |
| `resolveRoguelikeAdvancedValue(option, advanced, theme, taskId)` | 字段显示值：显式值优先，其次默认值，select 最后回落到当前主题的首项；默认值不属于当前主题时同样回落到首项（重启锚点没有模式 `1`） |
| `isRoguelikeOptionVisible(option, taskId, theme, advanced)` | 字段在当前主题、模式与依赖字段下是否生效；隐藏字段既不下发也不显示 |
| `isRoguelikeOptionValueValid(option, theme, value, taskId)` | 下拉值是否属于当前主题的候选表；非下拉字段恒为有效 |
| `isKnownRoguelikeTheme(taskId, theme)` | 主题代号是否属于该任务的已知目录 |
| `normalizeRoguelikeModeForKnownTheme(taskId, theme, advancedParams)` | 仅在主题属于已知目录时归一化模式；未知中间态原样返回，不在输入过程中重置草稿 |
| `normalizeRoguelikeModeForTheme(taskId, theme, advancedParams)` | 把新主题不支持的模式重置为该主题的默认模式（沙洲遗闻 `1`、重启锚点 `16`），没有默认值才回落到首项，其余字段保留 |
| `splitRoguelikeListValue(value)` | 列表字段按逗号、顿号、分号与空白切分 |
| `normalizeRoguelikeAdvancedParams(advancedParams, taskInputs?)` | 按当前主题补齐缺失或为空的默认值；无变化时返回原引用，不修改入参 |
| `buildRoguelikeCommandParams(taskId, taskInputs, advancedParams)` | 主题代号在前，生效字段按字段表顺序追加；只包含有 CLI 参数名的字段 |
| `requiresRoguelikeDynamicTask(taskId, taskInputs, advancedParams)` | 主题/模式不在 maa-cli 枚举内，或设置了只有 Core 参数名的字段时返回 true |
| `buildRoguelikeDynamicTaskConfig(taskId, taskInputs, advancedParams)` | 把生效字段换成 Core 参数名并构造 `{ name, type, params }`；补齐 CLI 缺省与 Core 缺省不一致的字段 |
| `buildRoguelikeExecutionPlan(taskId, taskInputs, advancedParams)` | 返回 `{ command, params, taskConfig }`：CLI 可行时保持原命令，否则换成 `run` + taskConfig |
| `validateRoguelikeTaskInputError(taskId, taskInputs, advancedParams)` | `roguelikeValidation.ts`：返回首个无效字段的 `{ key, message }` 或 `null`。校验顺序为主题是否已知、生效下拉/数字/列表字段是否合法，再检查模式专属必填项；主题错误归 `theme`，其余错误归对应字段 key |
| `validateRoguelikeTaskInput(taskId, taskInputs, advancedParams)` | 兼容入口：返回 `validateRoguelikeTaskInputError` 的消息或 `null`，不改变命令构造 |

字段表只维护 `hint` 文案，面板统一在标签旁渲染 `FieldHint`，不再输出控件下方的常驻说明。checkbox 的说明同样走标签旁 `FieldHint`，同时把同一文案作为 `sr-only` 常驻描述关联到开关。具体参数名、默认值与适用条件以字段表源码为准，不在文档复制参数表。

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
- 生息演算模式字段声明 `hint`，说明两个主题各自的模式、存档与起始界面要求；面板以标签旁的 `FieldHint` 呈现，文案归模型维护。
- 核心干员是单选字段而不是文本输入：点击后打开共享干员选择模态窗（有识别数据只列已拥有干员，无数据回退全量目录），选择结果只把干员中文名写回原字段；空值保持“未设置”，命令不写 `--core-char`，动态任务不写 `core_char`。字段不显示识别/拥有状态说明。旧草稿里的中文名按干员目录匹配回显头像与名字，匹配不到时原样显示并允许重新选择。
- 校验 trim 输入判断是否为空，不修改实际传给 CLI 的主题字符串。

面板只渲染 `isRoguelikeOptionVisible` 过滤后的字段：主题、模式与开关变化会同时改变字段集合与命令参数，但策略设置标题不再显示字段计数。草稿里保留的旧主题取值不删除，但下拉值必须属于当前主题的候选表：越界值在下拉项中标注“不适用于当前主题”，执行前校验会拒绝并提示重新选择，命令构造也不会写入；隐藏字段的残留值不参与校验与下发。

模型不读取配置通道或执行状态，因此可以用纯 Node 测试覆盖目录、参数顺序、可见性、空值过滤、默认值解析、归一化与校验。

### 4. 执行路径：CLI 与动态任务

maa-cli 0.7.8 只认识部分主题、模式与参数；MaaCore 新增的黑流树海、界园常乐节点、萨卡兹快速通过、重启锚点、`increment_mode` 之外的开局/结算开关等都只能通过 dynamic task 下发。工作区调用 `buildRoguelikeExecutionPlan` 得到执行计划：

- 提交顺序固定：先 `normalizeRoguelikeModeForKnownTheme` 归一化参数，再以同一份归一化结果调用 `validateRoguelikeTaskInputError`；校验通过且归一化产生变化时提交配置，最后用同一份参数构造 `buildRoguelikeExecutionPlan` 并交给执行 hook。校验失败只设置字段错误，不持久化、不提交 run。
- `taskConfig` 为 `null` 时保持原有 `command=roguelike|reclamation` 与空格分隔参数，停止、轮询与结果展示语义不变。
- 主题或模式不在 CLI 枚举内，或设置了仅声明 Core 参数名的字段时，改用 `command=run`，首参是 `roguelike` / `reclamation` 任务前缀，`taskConfig` 为 `{ name, type: 'Roguelike'|'Reclamation', params }`。服务端复用既有动态任务通路生成临时任务文件并执行，不需要新的顶层请求字段。
- Core 参数由字段表的 `coreParam`/`coreType` 生成；`disableInvestment`、`noStopWhenInvestmentFull` 这类与 Core 布尔字段语义相反的开关按 `coreInvert` 取反。CLI 缺省与 Core 缺省不一致的字段在动态任务中显式补齐（CLI 默认投资满时停止，因此动态任务补 `stop_when_investment_full: true`；刷开局模式补空的 `blackflow_start_animals`/`blackflow_start_rewards`）。
- 动态任务提交仍由 `useRoguelikeExecution` 落到 `run_task`，幂等键、Run 身份、停止与终态提示与 CLI 路径共用同一套控制器。

服务端对两条通路都做校验：动态任务参数由 `validateGameTaskParams('Roguelike'|'Reclamation', params)` 校验主题、模式组合、字段类型、常乐节点目标、黑流动物/奖励与重启锚点模式；CLI 参数由 `validateRoguelikeCommandArgs` 在创建 Run 之前预检，主题、模式或加号点击方式越界时返回 `AGENT_VALIDATION_TASK_ARGS_INVALID`，不再把只有 Core 支持的取值静默透传给 maa-cli 报错。

### 5. 执行进度

执行进度面板按 `mode` 只消费本页 owned 的 `trackedRun` 与快照中的 `lastRun`；状态选择归 `features/roguelike/model/runProgress.ts`，面板不新增执行订阅或第二份状态：

| 内容 | 规则 |
| --- | --- |
| 数据来源 | 活动 Run 读 `run.progress.roguelike`；终态 Run 读 `run.result.summary.progress`，失败或中断时回退 `run.error.details.summary.progress`。`runSummary.ts` 只用于终态摘要、生息演算“上次结果”与旧服务端的最小回退 |
| 模式字段 | 快照的 `mode` 原样取自 Run input；缺失或非整数按未知处理，不用主题或模式名反推 |
| 模式化统计 | `mode` 为 0 / 30001 / 30003 时展示已结束、通关、成功率（分母大于 0 时）与已结算；`mode` 为 1 时展示已开始、已结束，通关与成功率仅在 `roundsPassed > 0` 时展示；其它已知 mode 展示已开始、已结束，已结算仅在 `roundsSettled > 0` 时展示，通关与成功率仅在 `roundsPassed > 0` 时展示；mode 未知时只展示已开始、已结束与已观察到的计数，不假设支持结算或投资。`settlementSupported === false` 时显示“该模式不提供结算数据”，不显示“已结算 0 局” |
| 投资统计 | `investment` 非空时独立成组展示投资轮次、投资次数、投资总额与投资存款；`total`/`deposit` 缺失时整项不渲染，不补 0；`deposit` 固定标注为“投资存款”，不写成源石锭余额 |
| 模式过滤 | 以 `progress.command` / `summary.command` 判定模式，不用 `theme` 猜模式；只保留 command 与当前模式一致的一侧。两侧都没有 command 时仍按终态展示但不带结构化数据；两侧都有 command 且均不匹配时拒绝该 run，改用匹配的 `lastRun` 或空态/加载态，不把另一模式的执行或结果放进本模式视图 |
| 首屏与身份解析 | `hasSnapshot = false` 时显示“正在确认执行状态…”；本页身份已恢复但 run 详情尚未取回时（`resolvingIdentity`）继续显示加载态，不冒充空闲，也不展示旧结果 |
| 活动期 | 展示当前局、已结束/已结算/通关局数、成功率、当前动作、本次任务与本局耗时、最近事件相对时间、目标局数与剩余局数、最近 5 局以及 `degraded` 提示；`targetRounds` 未知时不显示目标行，成功率分母为 0 时不显示成功率 |
| 终态 | 有 `summary.progress` 时复用活动期统计与最近 5 局；没有时用现有摘要的 message 与 settlement 关键字段做最小回退；再没有摘要时明确“本次执行没有可用的结构化结果” |
| 黑流子区块（Phase 2B） | 仅 `mode === 'roguelike'` 且 `progress.blackflow` 非空时渲染：活动期位于计时之后、统计之前，终态位于状态行之后、本局结果之前。首屏展示楼层、当前节点名/类型（节点存在但身份未知时显示“当前节点未知”）、`actionPoints.before` 观测行动力、最近一次路由或节点完成、最多 3 条里程碑、策略 profile/结果/建议与相对更新时间。新鲜度按字段时间分 60/180/300 秒三档：60 秒内用当前语义，60–180 秒标“最近已知”，180–300 秒标“可能已过期”，超过 300 秒隐藏当前节点与行动力、楼层保留并标“最近已知”；终态统一用“最后记录”，缺失时间不显示相对时间。策略结果与任务 Badge 分离，不得写成“任务成功/通关”；不展示地图、节点边、候选/runners-up、OCR 或搜索耗时、revision/observation/decision/transaction ID、原始节点 ID 与原因细节；里程碑最多 3 条且不显示原始 id。该区块不改变 Phase 1/2A 计数、不改执行状态机 |
| 徽章 | 只表达任务状态：未开始 / 启动中 / 运行中 / 正在停止 / 已完成 / 失败 / 已停止 / 已中断；通关/未通关放在独立结果行，不出现“成功 + 通关：否”的歧义 |
| 刷新回退 | `lastRun` 是全局最近终态，只在 `operationId === 'run_task'` 且摘要 `command` 等于当前模式时展示；command 未知、其他 operation 或其他模式的 lastRun 不展示。lastRun 回退不继承当前 tracked run 的任务标签，避免跨模式串用 |
| 模式空态 | 空闲态按模式显示“还没有开始探索”或“还没有开始演算”，无图标、无执行入口 |
| 生息演算 | 只显示任务级状态、本次时长、最近活动相对时间与上次结果；不显示天数、批次、资源、基地或局数 |
| 展示更新 | 相对时间与已用时由面板内 1 秒 interval 驱动，仅在活动 Run 且时间戳有效时启动，卸载时清理；页面不持有计时器 |
| 边界 | 不新增推送或统计存储，Run 终态仍只由控制器观察 |

当前动作由 `RoguelikeProgressPanel` 的 `ACTION_LABELS`/`describeCurrentAction` 映射为中文文案，最近局结果由 `runProgress.ts` 的 `describeRoguelikeRoundOutcome` 映射；未知动作显示“任务执行中”，未知字段不显示，不用 0 补齐。最近局最多展示 5 条且最新在前，行使用共享 `ItemGroup`/`Item`；投资统计独立成组，不与通关指标混排。执行进度面板只渲染非交互状态与计数 `Badge`、`InlineAlert` 警示行与只读进度内容，不改变执行身份、提交、停止或终态提示；页面仍只经控制器观察 run。

### 6. Activity 与卸载

- `Activity` 隐藏会清理工作区与共享 `SegmentedTabNav` 的 Effects（如执行 hook 的确认计时器与共享 Tabs 的内部订阅），但保留 React state：当前模式、已加载草稿和面板输入不变。恢复时不会重新读取服务端配置（通道的 hydrated 守卫），也不会重放执行提交。
- 配置读取失败不标记 hydrated；`Activity` 恢复或下次挂载会再次尝试读取。恢复后按最新 `loadState` 重新计算门控，读取失败时的「重新加载」仍走 `reload({ force: true })`。
- 页面隐藏或 `Activity` 隐藏不改变后台 Run 的所有权；停止仍按控制器持有的 `runId` 执行，配置门控与编辑锁定都不会移除运行中的停止入口。
- 真正卸载/刷新会销毁 `activeMode`、字段错误与面板输入；配置草稿、pending 标记与在途提交仍属于应用级 `user-config` 通道，重新挂载后继续使用；运行身份由 `task-execution` 控制器持久化，页面重新订阅同一 run，不重新提交。

### 7. 兼容与维护约束

- 配置 key、本地草稿、pending 与 wire 形状以[配置持久化协调器](../../architecture/config-persistence.md)为准；面板不另建持久化格式。
- 服务端端点、执行提交参数与幂等键语义未变化；停止仍走控制器 `stopTrackedRun({ mode })`，`mode` 与 `pendingStop`/`stopIntent` 都是增量字段，缺省请求仍是原来的立即停止。运行中的 `progress.roguelike` 与终态的 `summary.progress` 都是 Run 载荷的增量字段，客户端缺失时按旧服务端回退到摘要或任务状态，不从退出码或消息推断成功。
- 保持字段 `id`、配置键、本地键、wire 形状与可访问语义（label、`aria-invalid`/`aria-errormessage`、状态 badge 文本与标题层级）；视觉原语与 CSS 类名可以替换，但字段仍必须能由标签稳定定位。核心干员字段的控件从原生输入换成按钮触发器，但字段 `id`、配置键与 wire 值保持不变。
- 字段的默认值语义以命令模型为准：生息演算默认模式为 `1`，集成战略默认职业组为 `稳扎稳打`；两者都会写入 wire 与命令。
- 配置同步失败固定使用 `roguelike-config-save` toast 与「重新同步」action；启动提交不发全局进度 toast，停止请求与终态提示继续使用 `execution` id，两者互不覆盖。
- 面板只组合命令模型、配置适配器、执行控制器与只读 run 投影；本页不恢复独立的配置或执行状态。

## 回归与关联

### 回归测试

以下路径相对于 `apps/web/src/`：领域回归在 `features/roguelike/model`；入口命令见[验证命令](#验证命令)。

执行进度回归集中在 `runProgress.test.ts`：快照解析与字段归一、模式过滤、最近 5 局截断、`lastRun` 选择（含 operation/模式/摘要校验与不继承 tracked 标签）、旧服务端回退、黑流块解析与 60/180/300 秒新鲜度、里程碑去重与策略标签；`runSummary.test.ts` 覆盖终态摘要与结算字段回退。任务目录、默认值、归一化、执行计划与校验分别由 `roguelikeTasks.test.ts`、`roguelikeValidation.test.ts`、`roguelikeConfig.test.ts` 与 `executionState.test.ts` 覆盖；`hooks/useRoguelikeExecution.test.tsx` 覆盖启动不推送全局进度提示、提交失败仍使用 `execution` 通知。面板渲染与宽屏栅格需在浏览器中人工核对。

关键不变量：

- 命令拼接：空值与未勾选项不写入，声明 `defaultValue` 的字段始终写入（沙洲遗闻 `-m 1`、重启锚点 `-m 16`、集成战略 `--roles 稳扎稳打`），未声明默认值的 select 省略（集成战略 `--mode`），主题/模式不适用的字段、不属于当前主题候选表的下拉值与非法整数不写入；列表字段逐项重复参数名；没有 CLI 参数名的字段不进入命令行。
- 执行路径：主题、模式或字段全部被 maa-cli 支持时保持原 CLI 命令；黑流树海、`10001`/`20001`/`30001`/`30003`、重启锚点、`clearStore` 或任一只有 Core 参数名的开关生效时改写为 `run` + taskConfig，且动态参数补齐 CLI 缺省与 Core 缺省不一致的字段。
- 可见性：主题专属字段随主题切换隐藏并停止下发，模式专属字段随模式切换隐藏；`requires` 未满足时隐藏（含开关缺省为关的情况）。
- 取值有效性：生效下拉值必须属于当前主题候选表，越界值在面板中标注且执行被拒绝；数字字段只接受范围内的整数；隐藏字段的残留值不影响校验。
- 校验：主题 trim 后非空且属于已知目录；生效下拉值越界、数字非整数或越界、列表项不在候选表、刷坍缩范式缺少期望范式、刷常乐节点缺少目标节点、黑流树海刷开局动物超过两项/羽蛇超过一项、培育目标与黑流策略不匹配时拒绝提交，切换主题后模式重置为该主题的默认模式（沙洲遗闻 `1`、重启锚点 `16`，无默认值才回落到首项）。
- 归一化不修改入参；`resolveRoguelikeAdvancedValue` 的首项回落只用于显示，不参与命令构造；重启锚点草稿缺少模式时归一化补 `16`。
- 配置门控：`loadState` 非 `ready` 时外壳、执行进度面板与停止入口保留，只门控可编辑区；读取中显示 `Loading`（`role="status"`），失败显示 `InlineAlert`（`role="alert"`）与 `loadError`，点「重新加载」走 `reload({ force: true })` 并恢复编辑；已有活动 run 时停止仍可用。
- 编辑锁定：运行或提交在途时模式 tab、主题、字段、开关与核心干员入口全部禁用，停止入口保持可达；提交中执行按钮显示「正在启动」，重复点击不产生第二个提交。
- 主题归一化：逐字符输入未知中间态时模式不重置；确认已知主题后不支持的模式回落到默认值；执行时按「归一化 → 同一份参数校验 → 必要时持久化 → 构造 plan」的顺序处理，非法模式不会进入命令。
- 字段错误：结构化校验返回首个错误字段；控件带 `aria-invalid` 与指向错误文本的 `aria-errormessage`，错误文本可见且聚焦该字段，编辑后清除；全局 toast 不重复字段错误。
- 配置同步：失败只出现一个固定 id `roguelike-config-save` 的 error toast 与「重新同步」action，不渲染页内同步 alert 或重试按钮；重试成功后关闭同 id toast，仅在 `retry()` 返回 true 后提示成功。
- 执行进度：活动 Run 展示当前局、结束/结算/通关计数、成功率、当前动作、计时、目标与最近 5 局；统计项按 `mode` 控制可见性，投资单独成组且 `deposit` 只称“投资存款”；终态复用 `summary.progress` 或摘要回退；徽章只表达任务状态，失败/停止/中断即使没有结构化摘要也保留终态；`degraded` 为 true 时提示进度可能不完整；模式不匹配的进度、摘要或 `lastRun` 不展示，`lastRun` 回退不带 tracked run 任务标签。
- 焦点移交：执行后焦点到「终止」，停止并进入终态后回到「开始」；等待战斗结束期间焦点不被抢走。
- 可访问语义：模式 tab 无描述，主题与策略设置标题无描述，策略设置无字段计数而主题保留计数；字段标签与错误走共享 `Field`/`FieldLabel`/`FieldError`，难度/职业组与生息演算四项说明走 `FieldHint`；开关有常驻 `sr-only` 描述；执行进度面板为 `role="region" aria-label="执行进度"`，标题为 `h2`，状态与统计计数为非交互 `Badge`，`role="status"` 只包状态文本而不包每秒变化的计时，最近局使用列表语义。
- 旧草稿：没有新字段的 wire 与本地草稿仍可读，未知扩展字段与显式值原样往返。
- 模式是局部状态：不进入配置 wire，跨模式草稿合并、空主题拒绝，Activity 隐藏保留而真正卸载回到 `roguelike`。
- 执行接线：按当前模式提交，停止/超时/失败/断线恢复由控制器 runId 持有，不重新提交；等待战斗结束期间 run 仍是 `running`，页面不触发 15s 停止确认超时，也不显示“正在终止”。
- 执行进度回退：活动期读 `run.progress.roguelike`，终态成功读 `run.result.summary.progress`、失败或中断读 `run.error.details.summary.progress`；字段缺失或类型不符时回退到摘要/任务状态，不把活动 run、原始 stderr 或退出码当作结算；刷新后仅当 `lastRun` 的 `operationId` 与摘要 command 匹配时展示，身份解析期间显示加载态。

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
