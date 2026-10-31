# MAA 版本差异与 La Pluma 改造清单

> 生成日期：2026-10-31
>
> 对比对象：
> - **MaaCore**：立项基线 `v6.2.3`（2026-01-17）→ 当前稳定 `v6.20.1`（2026-10-20），预览 `v6.21.0-beta.3`
> - **maa-cli**：立项基线 `v0.7.0`（2026-01-17）→ 当前稳定 `v0.7.7`（2026-10-18），预览 `0.8.0-nightly`
>
> 本文只讨论**能通过 maa-cli 或 MaaCore 任务 JSON / 回调使用**的能力。WPF 界面独占功能会明确标注 `gui-only`，不要按 CLI 能力实现。

---

## 0. 版本基线与结论

| 时间点 | MaaCore | maa-cli | 说明 |
| --- | --- | --- | --- |
| 2026-02-03（立项） | `v6.2.3` | `v0.7.0` | `server/services/maaService.js:509` 的注释仍写着这对版本 |
| 2026-07-28（最后一次提交） | `v6.14.2` | `v0.7.5` | `v6.15.0` 于 7-29 发布，晚于最后一次提交 |
| 2026-10-31（当前稳定） | `v6.20.1` | `v0.7.7` | 本机 `maa version` 已经是这两个版本 |
| 当前预览 | `v6.21.0-beta.3` | `0.8.0-nightly` | 只作参考，不作为当前实现依据 |

### 0.1 一句话结论

**运行时已经是最新的，落后的是代码里的集成方式。** 项目最值得做的不是“追新功能”，而是把四条自己维护的数据管线——**资源同步、活动识别、战斗结果、材料字典**——换成 MAA 原生来源；同时先修掉 `client_type`、识别响应信封、Depot 日志解析、Agent 多关卡 Fight 这几个会静默出错的 P0。

### 0.2 改造分类

| 分类 | 含义 | 处理优先级 |
| --- | --- | --- |
| `replace-native` | 项目自己实现了一套，MAA 已有原生实现 | 高，收益最大 |
| `compat-fix` | 新版下现有实现会坏、会静默错、或语义已变 | P0/P1，先修 |
| `new-capability` | MAA 新增、项目完全没有 | 中，按用户价值排 |
| `no-action` | GUI-only、CLI 不可达、或由 Core 透传无需改动 | 明确不做 |

---

## 1. MaaCore 6.3 → 6.20.1 新增能力

### 1.1 CLI / 任务 JSON 可达

#### 1.1.1 理智作战（Fight）

| 能力 | 版本 | 用法 | 备注 |
| --- | --- | --- | --- |
| `medicine_expire_days` | 6.8.0 | `maa run` 的 Fight 任务 `params.medicine_expire_days` | 替代 `expiring_medicine`；旧键仍兼容但 deprecated；`maa fight` 0.7.7 **没有**对应参数 |
| `series` 扩到 -1~10 | 6.15.0 / 6.16.0 | `maa fight --series` 或任务 `params.series` | 0 = 自动最大倍率；CLI 帮助文本仍写 -1~6，但会透传 |
| 关卡导航值扩展 | 6.9.5 / 6.10.0 / 6.20.1 | `maa fight <stage>` | `CE-6`/`LS-6`、`CA-5`/`AP-5`/`SK-5`、`PR-A-1`、剿灭值、`SSReopen-<前缀>` |
| `-NORMAL` / `-HARD` 难度后缀 | 6.9.5 / 6.10.0 | `maa fight 15-1-HARD` | 10–14 章标准/磨难；15 章后常规/险地 |
| 战前检查 | 6.9.0 / 6.9.1 | 自动生效 | 关卡未解锁、剿灭未开全权代理、剿灭合成玉 0 掉落会提前停止，属任务链错误 |
| 剿灭周进度回调 | 6.7.1 / 6.20.1 | `StageDrops.annihilation_weekly_process` | `[已完成数, 上限]`，仅剿灭关卡 |
| 连战次数回调 | 6.20.1 | `StageDrops.cur_times` | 结算界面识别到的连战次数 |

**注意**：`maa fight` 0.7.7 只暴露 `--expiring-medicine`，没有 `--medicine-expire-days`；新字段必须走 `maa run` 任务文件。

#### 1.1.2 公开招募（Recruit）

| 能力 | 版本 | 用法 | 备注 |
| --- | --- | --- | --- |
| `preserve_tags` | 6.11.0 | `maa run` 的 Recruit 任务 `params.preserve_tags` | 命中任一 Tag 时保留槽位并跳过本次招募 |
| `level3_recruitment_permit_reserve` | 6.18.0 | `params.level3_recruitment_permit_reserve` | 剩余许可 ≤ N 时跳过 3 星；0 = 禁用 |
| 6 星自动确认 | 6.13.0 | `params.select` / `params.confirm` 加入 6 | GUI 有专用配置项；Core 层用星级数组等价实现 |
| 公招回调 | 6.11.0 / 6.18.0 | `RecruitPreservedTag`、`RecruitPermitReserved`、`RecruitPermitCountRecognitionFailed` | `RecruitSlotCompleted` 已从文档移除 |
| `skip_robot` 废弃 | 6.11.0 | — | 旧参数仅在未提供 `preserve_tags` 且为 true 时对“支援机械”生效；`元素` 不再视为旧版 1 星词条 |

#### 1.1.3 基建（Infrast）

| 能力 | 版本 | 用法 | 备注 |
| --- | --- | --- | --- |
| `facility: Recycle` | 6.20.0 | `params.facility` 加入 `Recycle` | 回收站；Rotation 模式会跳过回收站 |
| `facility: AssistantChange` | 6.18.0 | `params.facility` 加入 `AssistantChange` | 自动更换设施副手 |
| `continue_training` | 6.18.0 | `params.continue_training` | 训练室继续未完成的专精 |
| `fiammetta_targets` / `fiammetta_recovery_enabled` | 6.17.0 | `params.fiammetta_*` | 仅 `mode=0` 生效 |
| 跨设施组合开关 | 6.17.0 | `params.use_pinus_sylvestris` 等 | `use_perception_information` 优先于 `use_worldly_plight` |
| 自定义排班 `training` / `recycle` | 6.20.0 | `custom_infrast.rooms.training` / `.recycle` | `training` 用 `operatorsA`（协助者）/ `operatorsB`（训练位） |
| 房间三态语义 | 6.20.0 | — | 缺键 = 默认算法；空数组 = 设施不换班；数组短于房间数 = 剩余不换班 |
| `skip` 语义 | 6.20.0 | — | 只跳过换人和换产物；无人机、线索交流、继续训练照常 |
| 结构化回调 | 6.20.0 | `CustomInfrastRoomKeptUnchanged` 等 | 带 `reason`：`facility_empty` / `room_no_intent` / `candidates_unavailable` / `candidates_working` / `candidates_low_mood` |

#### 1.1.4 肉鸽（Roguelike）

| 能力 | 版本 | 用法 | 备注 |
| --- | --- | --- | --- |
| `theme: BlackFlow` | 6.17.0+ | `maa run` 的 Roguelike 任务 | 黑流树海；`maa roguelike` 0.7.7 的 Theme 枚举**不包含**它 |
| mode `6` / `7` | 6.8.0 | `params.mode` | 界园月度小队 / 深入调查；`maa roguelike --mode` 只接受 0–5 |
| mode `10001` / `20001` / `30001` / `30003` | 6.17.0+ | `params.mode` | 萨卡兹快速过一层 / 界园刷常乐 / 黑流刷襁褓动物 / 黑流刷开局 |
| `core_char_list` | 6.18.0 | `params.core_char_list` | `[{name, use_support}]`，对应第 1/2/3 次招募；三个位置职业不能相同 |
| `start_with_seed` 类型变更 | 6.3.0 | `params.start_with_seed` | 从 boolean 改为 string；maa-cli `--start-with-seed` 仍发 bool，**不兼容** |
| `difficulty` 默认值 | 6.x | `params.difficulty` | 当前默认 -1（未解锁时取最高已解锁）；旧文档默认 0 |
| 模式 2 移除 | 6.x | — | 传入会被 Core 拒绝 |
| 投资 / 折叠范式 / 月度小队参数 | 6.5–6.20 | `params.*` | `stop_when_investment_full`、`investment_with_more_score`、`expected_collapsal_paradigms`、`monthly_squad_*`、`deep_exploration_auto_iterate` 等 |
| `BlackFlowStartRun` 回调 | 6.20.0 | `SubTaskExtraInfo` | `status`：preparing/target_run/reward_missed/completed/reward_unrecognized/... |

#### 1.1.5 抄作业（Copilot）

| 能力 | 版本 | 用法 | 备注 |
| --- | --- | --- | --- |
| `prts://<id>` / `prts://s<id>` | 6.14/6.15，maa-cli 0.7.6 | `maa copilot prts://...` | `maa://` 仍可用但打印弃用警告 |
| `Click` / `Swipe` / `SetUnitLocation` 动作 | 6.18.0 | 作业 JSON 原样透传 | 由 Core 解析，项目不需要改写 |
| `role` 字段 | 6.17.0 | 作业 JSON | 区分同名干员 |
| `timeout` | 6.17.0 | 作业 JSON | 仅 `type=Skill`；`skip_if_not_ready` 废弃 |
| `elapsed_time` | 6.20.1 | 作业 JSON | 原 `time_elapsed` 更名 |
| `nav_name_override` | 6.17.0 | `copilot_list[]` | 多作业导航名；旧 `stage_name` 建议双写过渡 |
| 练度预检 | 6.16.6 | 自动生效 | `requirements.elite/skill_level/module` 实际校验；`ignore_requirements` 不再跳过精英化 |
| 练度预检回调 | 6.20.0 | `CopilotPrecheckFile` | 预匹配每个作业前上报 `nav_name` / `filename` |

#### 1.1.6 仓库 / 干员识别

| 能力 | 版本 | 用法 | 备注 |
| --- | --- | --- | --- |
| 仓库基础资源 | 6.14.0 | `type=Depot` 任务 | 额外识别源石、合成玉、龙门币、赤金、采购凭证（item id 4002/4003/4001/3003/4006） |
| 回调改名 | 6.20.1 | `DepotInfo` / `OperBoxInfo` | 旧 `Depot` / `OperBox` 不再作为 `what`；`all_oper` → `all_opers` |
| 多语言干员名 | 6.20.1 | `OperBoxInfo.all_opers[]` | 新增 `name_en` / `name_jp` / `name_kr` / `name_tw` |
| Android OCR NCNN | 6.13.0 | 自动生效 | 无参数；影响全部 OCR 场景 |
| MuMu 6.0 截图增强 | 6.12.0 | 自动生效 | 按模拟器版本自动选择 |
| 分辨率变化中断 | 6.17.0 | 自动生效 | 运行中分辨率被修改会断开连接并中断任务 |
| 连接诊断回调 | 6.14–6.17 | `ResolutionGot` / `ResolutionChanged` / `FastestWayToScreencap` / `ScreencapCost` / `EmulatorFPS` | 可用于展示诊断信息 |
| `ProcessTask` 字段字符串化 | 6.20.1 | 回调 | `action` / `algorithm` 由数字改为字符串，新增 `result`；按数字解析会失效 |

#### 1.1.7 生息演算（Reclamation）

| 能力 | 版本 | 用法 | 备注 |
| --- | --- | --- | --- |
| `theme: RelaunchAnchor` | 6.10.0 | `maa run` 的 Reclamation 任务 | 重启锚点；`Fire` 已关闭 |
| mode `16` / `32` / `48` | 6.10.0 / 6.10.5 | `params.mode` | RA-1 / RA-15 / RA-4 |
| `Tales` mode `0` / `1` | 6.x | `params.mode` | `maa reclamation` 只支持这两个 |
| `clear_store` | 6.10.0 | `params.clear_store` | 仅 Tales mode 0 |
| `tools_to_craft` | 6.x | `params.tools_to_craft` | 默认空数组；仅 Tales mode 1 |
| 外服 RA3 | 6.21.0-beta.3 | 资源适配 | YostarEN/JP/KR |

**注意**：maa-cli 0.7.7 的 `maa reclamation` 发送 `increase_mode`，而 Core 文档字段是 `increment_mode`，该参数实际不生效；新主题/模式必须走 `maa run` 任务文件。

#### 1.1.8 小工具 / Custom（项目完全缺失）

通过 `maa run` 的 `type = "Custom"` + `task_names` / `params` 可以调用：

| 工具 | 入口 | 参数 |
| --- | --- | --- |
| 像素画自动填色 | `MiniGame@PixelPaint@Begin` | `params.pixel_paint`：`color` 0–39、24×24 `points`、`swipe`、`grid_delay` |
| 自动提升潜能 | `MiniGame@AutoRaisePotential@Begin` | `params.auto_raise_potential.use_normal_token` |
| 缺口材料合成 | `MiniGame@MaterialSynthesis@Begin` | — |
| 刷傀影维多利亚皇冠 | `MiniGame@CursedRelic@Begin` | — |
| 活动商店黑名单 | `SS@Store@Begin` | `params.event_shop.blacklist`（商品名或物品 ID） |

这是 **CLI 可达、项目完全没有** 的最大功能簇。

### 1.2 Core 有、但 maa-cli 0.7.7 不可达

| 能力 | 版本 | 原因 | 处理 |
| --- | --- | --- | --- |
| `SwitchTheme` 更换主题任务 | 6.17.3 | maa-cli `TaskType` 枚举只有 17 项，无此项；`maa run` 会报 unknown variant | 暂不接，等 maa-cli 支持 |
| `OperProgress` 干员培养任务 | 6.19.0 | 同上 | 暂不接；可继续用项目自己的 `operatorTrainingService` |
| `AsstCallerExtra` 扩展 C 接口 | 6.17.0 | 实验性，非公共 API，maa-cli 不暴露 | 不接 |

### 1.3 GUI-only（明确不要实现）

| 能力 | 说明 |
| --- | --- |
| PC 端（Win32）连接与控制 | WPF 独占；maa-cli 无 PC/Win32 预设 |
| MuMu 触控增强（MuMu IPC） | WPF 独占；maa-cli 的 `touch_mode` 没有 `MumuExtras` |
| 库存保持（DepotMaintain） | WPF 用 Depot + Fight 组合实现，不是 Core 任务类型 |
| “更新数据”（UpdateData） | WPF 用 Depot + OperBox 组合实现，不是 Core 任务类型 |
| 外部通知（Toast/CustomWebhook/Telegram 等） | WPF 独占；MaaCore/maa-cli 无通知接口 |
| 更新失败自动修复、任务时长上限、完成后动作 | WPF 独占 |
| 6 星自动公招的 GUI 配置项 | Core 可用星级数组等价实现，但 GUI 配置项本身不可用 |
| 干员识别读取一图流练度快照 | GUI-only；CLI 只能读 OperBox 回调 |

---

## 2. maa-cli 0.7.0 → 0.7.7 变更

| 能力 | 版本 | 影响 |
| --- | --- | --- |
| `prts://<id>` / `prts://s<id>` | 0.7.6 | 作业 URI 新格式；`maa://` 仍兼容但弃用 |
| `--loop-times` | 0.7.2 | 单关卡作业循环；多作业/`copilot_list` 模式会忽略并 warning |
| `--raid normal\|raid\|both` | 0.7.3 | 旧 0/1/2 仍作为 alias |
| `--starts-count` | 0.7.4 | 替换 `--start-count`，旧名 alias；下发给 Core 的字段改为 `starts_count` |
| `[behavior] auto_reconnect` + `--no-auto-reconnect` | 0.7.3 | 掉线时是否停止；不是恢复旧重连链 |
| `touch_mode = "MaaFwAdb"` | 0.7.3 | MaaFramework ADB 控制器；不接受 MuMu Extras |
| 连接预设 `Androws` | 0.7.5 | Windows 腾讯 Androws；自动读注册表 adb |
| Waydroid 运行时管理 | 0.7.3/0.7.5 | 忽略手填 address；自动 `session start` + `adb connect` |
| PlayCover bundle id | 0.7.3/0.7.6 | 按 bundle id 启动；Bilibili 不支持 PlayCover |
| `maa hot-update` + MirrorChyan CDK | 0.7.7 | `[resource.source] type="mirrorchyan"` + `cdk` |
| `[resource.source]` Git 配置 | 0.7.7 | 扁平字段 `backend/url/branch/ssh_key/passphrase`，不是 `remote.*` |
| `github_proxy` | 0.7.6 | 只重写 GitHub release 下载，不影响 `api.maa.plus` 或 git clone |
| `maa self update --force` | 0.7.6/0.7.7 | 默认只升不降；`self` 受 `cli_installer` feature 门控 |
| 只升不降 | 0.7.6 | `maa update` 不会降级；切渠道用 `maa install <channel> --force` |
| 渠道拆分 | 0.7.6 | `[cli].channel` = Stable/Beta/Nightly；`[core].channel` = Stable/Beta/Alpha |
| 原子写入 | 0.7.3/0.7.6 | 配置、import、copilot 缓存、hot-update 迁移 |
| 空 `MAA_*_DIR` 按未设置 | 0.7.6 | 通过环境变量启动的集成方受益 |
| `maa cleanup` 默认目标 | 0.7.x | 默认 `cli-cache core-cache debug`；不清 `tasks/` |
| `maa run --dry-run` | 0.7.x | 会 hot-update、load_core、append_task，**不是纯语法检查** |
| 0.8 nightly | nightly | `TouchMode`/`ClientType` selectable；模板解析显式 resolver（BREAKING，库层） |

### 2.1 CLI 预设落后于 Core 的清单

| 场景 | maa-cli 0.7.7 现状 | 必须走 `maa run` 的部分 |
| --- | --- | --- |
| Roguelike 主题 | 仅 Phantom/Mizuki/Sami/Sarkaz/JieGarden | `BlackFlow` |
| Roguelike 模式 | 仅 0–5 | 6/7/10001/20001/30001/30003 |
| Roguelike 开局干员 | 仅 `core_char` | `core_char_list` |
| Fight 临期药 | 仅 `--expiring-medicine` | `medicine_expire_days` |
| Fight 外服服务器 | 无 | `params.server` |
| Fight series | 帮助写 -1~6 | 7–10（可透传，但无提示） |
| Reclamation 主题/模式 | 仅 Tales / 0–1 | `RelaunchAnchor` / 16/32/48 |
| Reclamation 参数 | 发送 `increase_mode`（错误键） | `increment_mode` |
| Copilot 多作业导航名 | 仍发 `stage_name` | `nav_name_override` |
| Copilot 单关突袭 | 单文件分支丢 `is_raid` | 动态 `copilot_list[].is_raid` |

---

## 3. 可直接换原生实现（含改造方案）

### 3.1 资源同步：删除自定义 git clone 脚本

**现状**

- `server/scripts/update-maa-resources.js`：固定 clone `MaaResource` 的 `main` 分支，再递归复制到 `maa dir data` 下的 `resource`（即 MaaCore 基资源目录）。
- `server/services/resourceUpdateService.js:48-88`：用 Node 子进程执行该脚本，并在租约里把 command 伪记为 `hot-update`。
- `server/routes/agent.js:1410-1467` 与 `server/services/schedulerService.js:1649-1700`：在 `maa update` 后又跑一遍该脚本，形成重复更新，并把 GitHub main 资源与已安装 Core 版本混合。

**原生方案**

- `maa update` 本身已经执行 **Core 更新 + 基资源 + MaaResource + hotfix**（`main.rs:45-49`）。
- `maa hot-update` 执行 **hotfix + 配置的资源源**（Git 或 MirrorChyan），**不更新基资源**。
- 目录语义（已在本机核实）：
  - `maa dir resource` → 基资源（完整、随 Core 版本）。
  - `maa dir hot-update` → `data/MaaResource`（Git 检出）。
  - `maa dir cache` → `cache/`；`StageActivityV2.json` 与 `resource/**/tasks/tasks.json` 在这里。
  - MirrorChyan 快照 → `data/mirrorchyan/MaaResource/current.json` 指向的 `snapshot-*/resource`。
- 项目读取 `item_index.json` / `stages.json` / `tasks/Stages/*` 时，**基资源优先读 `maa dir resource`**；热更新覆盖层只有 `cache/resource/**/tasks/tasks.json`，不要把它当成完整资源目录。

**实施步骤**

- [ ] 删除 `server/scripts/update-maa-resources.js` 及其调用。
- [ ] `updateMaaResources()` 改为在租约内执行 `maa hot-update`，不再跑 Node 脚本。
- [ ] `update-core` 改为 `maa update`（或 `maa install <channel> --force`），不再追加自定义资源脚本。
- [ ] 自动更新改为 `maa update` + 可选 `maa hot-update`；持久化 `[core].channel`。
- [ ] `getMaaResourceInfo()` 继续读 `maa dir resource` 的 `version.json`；如需展示热更新信息，另读 `cache/StageActivityV2.json` 的 mtime。
- [ ] 读取资源路径的代码统一走 `maa dir resource`；不要假设 `data/resource` 或 `data/MaaResource` 是完整资源。

**验收标准**

- `maa update` 后资源版本与 Core 版本匹配；不再出现 GitHub main 资源覆盖基资源。
- `maa hot-update` 可独立运行；配置 MirrorChyan CDK 后能从快照更新。
- 离线时 `maa run` 的 hot-update 失败能被识别并提示，不会静默成功。

**风险**

- `maa hot-update` 不更新基资源；仍需 `maa update`。
- `maa run` 每次运行前都会 hot-update（`run/mod.rs:130-131`），网络失败会导致任务失败。
- 启用 Git 源后，`data/MaaResource/resource` 会覆盖同名基资源；如果检出落后，会反向遮蔽新基资源。
- MirrorChyan 需要 CDK 与配额。

### 3.2 活动识别：改读 `StageActivityV2.json`

**现状**

- `server/services/maaService.js:1265-1360` 用多条正则从 `maa activity` 的中文输出里猜活动代号；失败后 `activityFallbackService` 降级到 Penguin 或缓存。

**原生方案**

- maa-cli 会把 `StageActivityV2.json` 下载到 `$(maa dir cache)/StageActivityV2.json`。
- 结构：顶层按客户端类型分组（`Official` / `YostarEN` / `YostarJP` / `YostarKR` / `txwy`）；每个客户端有 `sideStoryStage`、`resourceCollection`、`miniGame`。
- `sideStoryStage` 的 key 是活动代号（复刻活动 key 为 `SSReopen`），`Activity.UtcStartTime/UtcExpireTime` 是 `TimeZone` 指定时区的本地时间，不是 UTC。
- `Stages[]` 的 `Value` 是实际关卡名（`SSReopen-AT`、`AT-8`），`Display` 是展示名，`Drop` 是掉落提示或物品 ID。

**实施步骤**

- [ ] 新增资源活动数据读取器：读 `cache/StageActivityV2.json`，按 clientType 归一化（项目 `YoStarEN` ↔ 文件 `YostarEN`，`Txwy` ↔ `txwy`）。
- [ ] `getCurrentActivity()` 顺序改为：本地 `StageActivityV2.json` → `maa activity` → Penguin → 缓存。
- [ ] 用 `TimeZone` 解析开始/结束时间；判断“当前活动”时过滤未开始/已结束。
- [ ] 读取 `MinimumRequired`，低于当前 Core 版本的活动跳过或提示。
- [ ] 复刻活动用 `SSReopen` 的 `Stages` 推导实际关卡，不要拿 key 当代号。
- [ ] 保留 `hd-N` → 当前活动代号的兼容替换。
- [ ] 处理 `maa cleanup cli-cache` 删除文件和 `maa run` 自动 hot-update 的恢复。

**验收标准**

- 当前活动能在不依赖 `maa activity` 文本的情况下识别。
- 复刻活动、资源收集、小游戏不会误判为主活动。
- 时区/跨日边界正确；文件缺失时能降级。

### 3.3 战斗结果 / 掉落：改用结构化回调

**现状**

- `server/services/fightResultService.js` 用文本判断理智耗尽。
- `server/services/dropRecordService.js` 依赖 `parseTaskSummary` 的 `total drops:` 文本。
- `server/services/schedulerService.js:1432-1519` 的 `parseTaskSummary` 仍按旧格式匹配 `Fight <stage> <n> times`、`medicine: N`、`stone: N`、`Recruit: [tags] -> N*`、`Infrast: ...`。

**原生方案**

- `maaCallbackService.parseMaaCallbackEvents` 已经能解析 `Assistant::append_callback` 行；扩展 handler：
  - `StageDrops`：`stats[].itemId`、`itemName`、`addQuantity`（**本次增量**）、`quantity`（累计值）；`cur_times`；`annihilation_weekly_process`。
  - `FightTimes`：`sanity_cost`（本机 6.20.1 日志可见，但不在公开文档，必须容错）。
  - `SanityBeforeStage`：本机日志可见，必须容错。
  - `TaskChainError.details.error`：`OpenCVException` / `OutOfMemory` / `UnhandledException` / `UnknownException`。
  - `ExceededLimit`：`task` / `exec_times` / `max_times`。
- Summary 只做兜底，不再作为唯一来源。

**实施步骤**

- [ ] 在 `maaCallbackService` 或新 `fightEventService` 中增加 `StageDrops` / `FightTimes` / `SanityBeforeStage` 提取。
- [ ] `dropRecordService.recordDrops` 接受结构化 `[{itemId, name, count}]`；0 掉落也记录。
- [ ] 用真实理智值替代 `times * 20` 估算。
- [ ] `parseTaskSummary` 增加 0.7.7 格式：`used N medicine`、`used N stone`、`Detected tags`、`Recruited N times`、设施明细；删除 `Fight ... 0 times` 假分支。
- [ ] 剿灭周进度从 `annihilation_weekly_process` 读取。
- [ ] 为回调/Summary 两条路径都加 fixture 测试。

**验收标准**

- 掉落统计与结算界面一致；0 掉落对局不会丢失。
- 理智消耗准确；剿灭周进度可展示。
- Summary 缺失时仍能从回调得到结果。

### 3.4 材料字典：改用 MaaResource

**现状**

- `server/services/operatorTrainingService.js` 依赖 `server/data/materials.json`、`material-formulas.json`、`stages.json`。
- `server/services/copilotPlanService.js:68-69` 直接 `for (const stage of stages)`，但 `stages.json` 是对象，异常被 catch 后返回空 Map，导致 AP 成本全 0。

**原生方案**

- 从 `maa dir resource` 读取：
  - `item_index.json`：`name` / `rarity` / `formula`。
  - `item_table.json`：`iconId` / `stageDropList`。
  - `stages.json`：`stageId` / `code` / `apCost`。
  - `Arknights-Tile-Pos`：`stageId` → `code`。
  - `character_table.json`：`evolveCost`（LMD 仍可能需要）。
- 对 `stages.json` 使用 `Object.values()`；对 `Map` 解析注意 `stageId` 带 `#f#` 的情况。

**实施步骤**

- [ ] 新增 `server/services/maaResourceDataService.js`，带缓存加载上述文件。
- [ ] `operatorTrainingService` 的材料/公式来源改为该服务。
- [ ] `dropRecordService` 的物品名/图标来源改为该服务。
- [ ] `copilotPlanService` 的 stage map 改为 `Object.values` + `stageId` 匹配。
- [ ] 保留本地缓存作为 MAA 资源缺失时的降级，但要记录来源和版本。

**验收标准**

- 新干员/新材料在 MAA 资源更新后无需改项目数据即可出现。
- AP 成本、关卡代号、材料公式与游戏一致。
- 资源缺失时有明确提示，不静默返回空。

### 3.5 抄作业：能委托给 `maa copilot` 的就委托

**现状**

- `activityCopilotDiscoveryService.js` 查询 PRTS 作业集/作业，`copilotPlanService.js` 逐个下载、写本地 JSON、拼 `copilot_list`；自己做 raid、进度、预设编队。

**原生方案**

- 单作业且需要自动编队：`maa copilot prts://<id>`。
- 未执行过、且全部不是预设编队的完整作业集：`maa copilot prts://s<id>`。
- 单关循环：`filename + --loop-times`。
- 单关突袭：动态 `copilot_list[].is_raid = true`（不要用 `maa copilot --raid raid` 单文件分支）。
- 多作业导航名：`nav_name_override`，旧 `stage_name` 双写过渡。

**实施步骤**

- [ ] 在 `copilotPlanService` 增加“原生委托”分支：满足条件时调用 `maa copilot`，否则走现有自定义计划。
- [ ] 原生委托必须加 `--batch`，或强制 `formation`，避免 `formation=false` 的交互提示挂住。
- [ ] 单关循环改用 `--loop-times`；多作业不要传 `--loop-times`。
- [ ] `copilot_list[]` 写 `nav_name_override`，同时保留 `stage_name` 作为过渡。
- [ ] 单关突袭走动态 `copilot_list`，不要依赖 CLI 的 `--raid raid`。
- [ ] `planDir` 对 setId 做路径白名单，避免路径注入。
- [ ] AP 成本缺失时显示“未知”，不要显示 0。

**验收标准**

- 单普通作业 + 自动编队可原生执行；完整非预设作业集可原生执行。
- 预设编队、突袭跳过、进度记录仍按现有逻辑正确。
- 任何情况下不会因交互提示挂住。

### 3.6 每日流程：静态任务链合并为一份 `maa run`

**现状**

- `schedulerService` 按 taskFlow 逐项启动 `maa` 进程，任务之间固定等待 2s、startup 15s、closedown 3s（`schedulerService.js:1218-1244`）。

**原生方案**

- 生成一份任务文件，顶层写 `client_type`、`startup = true`、`closedown = true`；maa-cli 会自动补 StartUp/CloseDown、开启 `start_game_enabled`。
- 一次 `maa run` 在同一个 Core 会话里顺序执行。
- 只合并**静态任务链**；以下仍拆多次运行：
  - 多关卡 Fight（需要逐关跳理智、逐关结果）。
  - startup 的 ADB 预检/重试。
  - closedown 前的仓库识别。
  - 需要逐任务日志 checkpoint 的步骤。
  - 停止语义依赖进程边界的步骤。

**实施步骤**

- [ ] 新增任务文件生成器：把静态任务编译成 JSON/TOML，放 `tasks/_lapluma/`。
- [ ] 顶层写 `client_type`、`startup`、`closedown`。
- [ ] 执行一次 `maa run --batch <taskId>`；通过 Summary/回调聚合结果。
- [ ] 保留多关卡 Fight 的逐关执行路径。
- [ ] 停止时仍对整个 `maa run` 进程发信号，确保清理。

**验收标准**

- 每日流程结果与现在一致；重复连接和固定等待明显减少。
- 停止、超时、单任务失败仍能定位到具体任务。
- 多关卡 Fight 仍能逐关跳理智。

### 3.7 动态任务文件：补 `client_type`、换 JSON、加 `--batch`、放子目录

**现状**

- `server/services/maaService.js:772-810` 的 `generateTaskToml` 只写 `name/type/params`。
- `execDynamicTask` 把临时文件直接放在 `tasks/`，本机已残留 17 个 2026-07 的 `*_temp` 文件。
- `resolveConnection().clientType` 目前基本恒为 `Official`，因为 maa-cli 的 `ConnectionConfig` 没有 `client_type` 字段（未知键被静默忽略）。

**原生方案**

- 任务文件顶层写 `client_type = "Bilibili"` 等；0.7.5+ 会将其写入 MaaCore 的 `ClientType` 实例选项。
- 用 JSON 代替手写 TOML；放 `tasks/_lapluma/` 子目录；启动时清理超时残留。
- 加 `--batch`，避免交互提示。
- `maa run --dry-run` 只当“加载预检”，不要当纯语法检查（它会 hot-update、load_core、append_task）。

**实施步骤**

- [ ] `execDynamicTask` 增加 `clientType` 参数，生成顶层 `client_type`。
- [ ] 项目自己持久化 clientType（profile 里 maa-cli 不认的 `client_type` 不要依赖）。
- [ ] 从 `schedulerService` / `agentActionService` 传入 `resolveConnection().clientType`。
- [ ] 临时文件放 `tasks/_lapluma/`，文件名带 runId；启动时清理超过 N 小时的残留。
- [ ] 所有 `maa run` 调用加 `--batch`。
- [ ] 更新 `maaProfileConfig` 测试，覆盖非 Official。

**验收标准**

- Bilibili / Txwy / YoStar 用户的动态任务按对应客户端资源识别。
- `tasks/` 目录不再残留临时文件；`maa list` 不出现 `*_temp`。
- 交互输入不会挂住。

### 3.8 调度条件：能交给 maa-cli `condition`/`variants` 的就别硬编码

**现状**

- `schedulerService` 自己用 node-cron 和硬编码的 `RESOURCE_STAGES` / `isStageOpenToday` 判断开放日。

**原生方案**

- 任务文件支持 `condition` / `variants`：`Time`、`DateTime`、`Weekday`、`DayMod`。
- 适合“周三才打剿灭”“活动期间才跑某关”这类单次运行内条件。
- 项目仍需要 cron 定时拉起 `maa run`；两者不冲突。

**实施步骤**

- [ ] 把可表达的星期/活动条件改成 `variants`。
- [ ] 保留 node-cron 作为 daemon 调度。
- [ ] 时区按客户端映射（官方 04:00 日界）。
- [ ] 用 `maa remainder <divisor>` 校验 `DayMod` 偏移。

**验收标准**

- 星期/活动条件不再依赖硬编码关卡表。
- 时区/跨日边界正确。

---

## 4. 兼容性修复清单

### 4.1 P0（先修，阻塞/静默错误）

| ID | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| P0-1 | `server/services/agentActionService.js:3-20` | `reclamation` 不在 `AGENT_TASK_COMMANDS`，CLI 有但 Agent 拒绝 | 加入白名单；补 contract/route/test |
| P0-2 | `server/services/maaService.js:772-810`、`schedulerService.js:203-236` | 动态任务没有顶层 `client_type` | 加参数并写顶层；项目侧持久化 clientType |
| P0-3 | `server/routes/agent.js:867,882`、`apiHelper.js:50-60`、`dataParserService.js:180-187` | `sendSuccess` 又包一层 `successResponse`，识别失败被当成功 | 路由返回 `parseDepotData().data` 或直接返回原始数据；错误向上抛 |
| P0-4 | `server/services/dataParserService.js:131-145` | Depot 正则要求 `what` 在 `details` 之前，真实日志相反，会跨事件匹配 | 按行解析 `SubTaskExtraInfo` JSON；取 `what=DepotInfo` 的 `details.data`；检查 `done` |
| P0-5 | `server/services/dataParserService.js:255-275` | OperBox `done=false` 时用部分结果覆盖完整缓存 | 只有 `done=true` 才覆盖；否则合并或保留旧数据 |
| P0-6 | `server/services/dataParserService.js`、`schedulerService.js` | 日志轮转/截断/读取失败时返回空串当成功 | 检测 `asst.log` / `asst.bak.log`，按时间戳去重；失败返回错误 |
| P0-7 | `server/services/copilotPlanService.js:68-69` | 对 `stages.json` 对象用 `for...of`，异常被吞，AP 成本全 0 | 改 `Object.values(stages)` |
| P0-8 | `server/config/paths.js` | Windows 路径与 maa-dirs 不一致；忽略 `MAA_*_DIR` | 运行时用 `maa dir` 或按 maa-dirs 规则修正；尊重环境变量 |
| P0-9 | `server/routes/agent.js:586-601` | `/actions/fight` 把多关卡拼成 `"1-7:3,CE-6"` 传给 `maa fight`，CLI 不解析 | 拆多次 `maa fight`，或走任务文件 |
| P0-10 | `server/services/maaService.js:638-745` | 临时任务文件放在 `tasks/` 根目录，残留 17 个 2026-07 文件 | 放 `tasks/_lapluma/`；启动清理；`--batch` |

**补充说明**

- P0-3：只有 POST 识别接口是双层信封；GET `/data/depot` 是单层。不要把所有接口都按双层改。
- P0-4：真实日志顺序是 `class → details → what`；本机 84 条 `DepotInfo` 只命中 83 条。
- P0-6：`asst.bak.log` 是上一轮轮转日志，直接回退会重放旧事件；需要时间戳/事件去重。
- P0-8：maa-dirs 的 Windows 路径是 `%APPDATA%\loong\maa\config`、`%APPDATA%\loong\maa\data`、`%LOCALAPPDATA%\loong\maa\cache`。

### 4.2 P1（结果解析 / 活动 / 抄作业 / 配置）

| ID | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| P1-1 | `schedulerService.js:1432-1519` | `parseTaskSummary` 仍按旧格式解析 0.7.7 输出 | 支持 `used N medicine/stone`、`Detected tags`、`Recruited N times`、设施明细；删假分支 |
| P1-2 | `recruitResultService.js` | `RecruitPreservedTag` 是 `details.tag` 字符串，不是 `details.tags` 数组 | 改读 `details.tag`；`RecruitNoPermit` 是 `what` 不是 `task` |
| P1-3 | `awardResultService.js` | 未识别 `SignInEvent` | 增加限时签到事件解析 |
| P1-4 | `infrastResultService.js` | 仍用文本/设施标签，未用结构化事件 | 用 `EnterFacility` / `ProductOfFacility` / `CustomInfrast*` 事件 |
| P1-5 | `mallResultService.js` | `VisitNext`/`VisitNextOcr` 可能重复 | 去重后再汇总 |
| P1-6 | `activityNavigationService.js:56-76` | 只认 `CODE-OpenOpt`，不认隐式 `@CODE-OpenOpt` | 解析 `@` 引用；补测试 |
| P1-7 | `activityCopilotDiscoveryService.js:146-170` | PRTS 查询用展示关卡号，不是内部 `stageId` | 用 `act52side_07` 这类内部 stageId |
| P1-8 | `activityFallbackService.js` | 繁中服无 Penguin 数据时无明确提示 | 增加 `txwy` 降级/提示 |
| P1-9 | `activityCopilotDiscoveryService.js:112`、`agent.js:1040,1091`、`CombatTasks.tsx` | 仍生成 `maa://` | 输出优先 `prts://`，输入两者都接受 |
| P1-10 | `copilotPlanService.js:204`、`agent.js` | `copilot_list[].stage_name` 旧键 | 写 `nav_name_override`，双写过渡 |
| P1-11 | `copilotPlanService.js` | 单关 `--raid raid` 丢 `is_raid` | 改动态 `copilot_list[].is_raid` |
| P1-12 | `copilotPlanService.js` | `loop_times` 只在单文件模式生效 | 多作业不要传；单关才传 |
| P1-13 | `CombatTasks.tsx` | `ignore_requirements` 文案仍说“忽略属性要求” | 改为“仅忽略等级/技能，精英化仍校验” |
| P1-14 | `copilotPlanService.js` | `planDir` 直接拼 setId | 白名单/路径校验 |
| P1-15 | `maaService.js:638-745` | 动态任务 AP 成本缺失时显示 0 | 显示“未知” |
| P1-16 | `maaService.js:561-611` | `auto_reconnect` 写在 `[connection]`，maa-cli 读 `[behavior]` | 写入并读取 `[behavior]`；透传 `--no-auto-reconnect` |
| P1-17 | `ConfigManager.tsx` / `connectionService.js` | 未暴露 `preset` / `touch_mode` | 增加连接预设与触控模式；`MaaFwAdb` 可用 |
| P1-18 | `schedulerService.js:1649-1700`、`agent.js:1470-1484` | 假设 `maa self` 存在 | 先探测 `maa self --help`；Homebrew 构建没有 |
| P1-19 | `agent.js:1410-1467` | `maa update` 只升不降；自动更新不持久化渠道 | 切渠道用 `install <channel> --force`；持久化 `[core].channel` |
| P1-20 | `agent.js` / `agentContract.js` | update/hot-update/识别未进入 tracked Run；`run-task` 未拒绝未声明 task type | 统一 tracked Run；白名单/契约同步 |
| P1-21 | `operatorTrainingService.js` | 材料文件缺失导致 `stages=[]`、LMD 全 0、库存递归抵扣重复 | 改用 MaaResource；修 LMD/抵扣/`currentElite` 快照 |
| P1-22 | `DataStatistics.tsx` | 固定 2 秒等待；解析错误不展示原因 | 改为轮询/事件；展示错误原因 |
| P1-23 | `AutomationTasks.tsx` | `clientType` 对动态任务无效 | 接顶层 `client_type`，或在 UI 明确标注只对 startup/fight 生效 |
| P1-24 | `RoguelikeTasks.tsx:358` | 仍用 `--start-count` | 改 `--starts-count`（旧名 alias 仍可用） |

---

## 5. 建议新增功能

| 优先级 | 功能 | 范围 | 落点 |
| --- | --- | --- | --- |
| 高 | Custom / 小工具工具箱 | 像素画、自动提升潜能、缺口材料合成、刷傀影皇冠、活动商店黑名单 | 新“小工具”页 + `type=Custom` 执行器 + 参数模型 |
| 高 | 肉鸽完整参数面 | BlackFlow、mode 6/7/10001/20001/30001/30003、`core_char_list`、投资/折叠范式/月度小队 | `RoguelikeTasks.tsx` + 动态任务 |
| 中 | 理智作战参数 | `medicine_expire_days`、`server`、series 7–10、`-NORMAL/-HARD` 提示 | `AutomationTasks.tsx` + 动态任务 |
| 中 | 基建新设施 | Recycle、AssistantChange、training、continue_training、fiammetta/use_* | `AutomationTasks.tsx` + `infrastResultService` |
| 中 | 公招 / 奖励 | `level3_recruitment_permit_reserve`、`preserve_tags` 展示；`signinevent` | 对应任务表单 + 结果解析 |
| 中 | 生息演算 | RelaunchAnchor、mode 16/32/48、`increment_mode`、`clear_store` | Agent 白名单 + 动态任务 |
| 中 | 连接配置 | `preset`、`touch_mode`、`[behavior].auto_reconnect` | `ConfigManager.tsx` + `connectionService` |
| 中 | 仓库/干员 | 基础资源分组、`all_opers` 过滤、识别后刷新养成队列 | `DataStatistics.tsx` + `dataParserService` |
| 低 | ParadoxCopilot `{id, filename}` | 逐关跟踪 | `CombatTasks.tsx` |
| 低 | 结构化诊断展示 | 分辨率变化、截图耗时、模拟器 FPS、`ReportToPenguinStats` | 日志/状态面板 |

**注意**：`all_opers` 不是项目名册的超集。本机 own=395、all=452，但 all 有 33 个不在名册（NPC/预览/异格），名册有 11 个不在 all 的联动词干员，还有 4 个已拥有 2 星不在名册。必须做 own/可玩性过滤或合并。

---

## 6. 明确不做

- [ ] PC 端（Win32）连接与控制：GUI-only，maa-cli 无预设。
- [ ] MuMu 触控增强（MuMu IPC）：GUI-only，`touch_mode` 不接受 `MumuExtras`。
- [ ] 库存保持（DepotMaintain）：GUI 组合，不是 Core 任务类型。
- [ ] “更新数据”（UpdateData）：GUI 组合，不是 Core 任务类型。
- [ ] 外部通知：GUI-only；继续用项目自己的 Telegram/通知。
- [ ] `SwitchTheme` / `OperProgress`：Core 有，但 maa-cli 0.7.7 `TaskType` 不支持，`maa run` 会报 unknown variant。
- [ ] Copilot 新动作/`elapsed_time`/`skill` 默认 0：Core 解析，项目原样透传，不改写作业 JSON。
- [ ] 6.21 beta / 0.8 nightly 的 Breaking 项：不作为当前实现依据；`maa://` 保留输入兼容即可。

---

## 7. 分阶段实施计划

### Phase 0：基线与护栏（不改行为）

- [ ] 用真实 maa-cli 0.7.7 输出/回调建立 fixture：Depot、OperBox、Recruit、Infrast、Mall、Award、Fight。
- [ ] 记录当前 `maa dir` 路径、`StageActivityV2.json`、`tasks/` 残留。
- [ ] 补测试基线：`npm run verify` 通过。
- [ ] 明确设备副作用边界：研究/CI 不触发真实战斗、不消耗理智/药品/源石、不发送通知。

### Phase 1：P0 兼容性

- [x] P0-1 `reclamation` 白名单。
- [x] P0-2 动态任务 `client_type`。
- [x] P0-3 识别响应信封。
- [x] P0-4 Depot 解析。
- [x] P0-5 OperBox `done=false`。
- [x] P0-6 日志轮转/截断。
- [x] P0-7 `stages.json` 对象遍历。
- [x] P0-8 `paths.js` Windows/`MAA_*_DIR`。
- [x] P0-9 Agent 多关卡 Fight。
- [x] P0-10 临时任务文件清理。

> **Phase 1 实施记录（2026-10-31）**
>
> - 已改：`server/services/agentActionService.js`、`maaService.js`、`dataParserService.js`、`copilotPlanService.js`、`schedulerService.js`、`activityCopilotRunService.js`、`server/routes/agent.js`、`server/config/paths.js`、`server/utils/apiHelper.js`、`server/server.js`。
> - 新增测试：`server/config/__tests__/paths.test.js`、`server/services/__tests__/dataParserService.test.js`；扩充 `maaDynamicTask`、`agentActionService`、`agentRoutes`、`schedulerPlan`。
> - 验证：`npm run verify` 通过（server 39 个测试文件、client 42 个测试文件）。
> - P0-2 的 `clientType` 来源目前支持：任务 `params.clientType`、profile `[connection].client_type`、请求覆盖、`MAA_CLIENT_TYPE` 默认值；全局连接表单的客户端类型选择仍属于 P1-17。
> - P0-6 不自动回退 `asst.bak.log`：当前日志找不到识别结果时返回明确错误，避免重放旧事件；如需读取轮转日志，应结合时间戳去重后再实现。

### Phase 2：数据管线换原生

- [x] 3.1 资源同步（`maa update` + `maa hot-update`）。
- [x] 3.2 活动识别（`StageActivityV2.json`）。
- [x] 3.3 战斗结果/掉落（`StageDrops` / `FightTimes` / `SanityBeforeStage`）。
- [x] 3.4 材料字典（MaaResource）。
- [x] P1 结果解析（Recruit/Award/Infrast/Mall/Summary）。

> **Phase 2 实施记录（2026-10-31）**
>
> - 3.1：删除 `server/scripts/update-maa-resources.js`；`resourceUpdateService.updateMaaResources()` 改为执行 `maa hot-update`；`update-core` 依赖 `maa update` / `maa install` 自带的资源更新，不再二次 clone；自动更新同样不再重复同步资源。
> - 3.2：新增 `server/services/activityDataService.js`；`getCurrentActivity()` 优先读 `$(maa dir cache)/StageActivityV2.json`，失败后降级到 `maa activity` / Penguin。
> - 3.3：`maaCallbackService` 新增 `summarizeFightCallbacks()`；调度器在每关战斗前后读写日志检查点，用 `StageDrops.stats[].addQuantity`、`FightTimes.sanity_cost`、`SanityBeforeStage` 补齐掉落和理智；`parseTaskSummary` 支持 0.7.x 的 `used N medicine/stone`、`Detected tags`、`Recruited/Refreshed N times`、设施明细。
> - 3.4：新增 `server/services/maaResourceDataService.js`，统一读取 `item_index.json` / `item_table.json` / `stages.json` / `battle_data.json`；Depot 物品信息、掉落统计、养成材料/配方改用该服务。
> - P1 结果解析：Recruit 支持 `RecruitPreservedTag.details.tag`、`RecruitNoPermit` 作为 `what`、`RecruitPermitReserved`、`RecruitPermitCountRecognitionFailed`、`RecruitError.refresh_limit`；Award 支持 `signinevent` / `SignInEventAllClaimed`；Infrast 支持 `EnterFacility`、`ProductOfFacility`、`CustomInfrastRoomKeptUnchanged` 等结构化事件；Mall 对 `VisitNext`/`VisitNextOcr` 去重，并兼容 `CreditShop-BuyIt` 计数。真实日志验证：Recruit 4 次开始/4 次收取、Mall 2 位好友/6 件商品。
> - 实机验证：`maa hot-update` 成功；Depot 识别 83 项；OperBox 识别 406 名干员；多关卡 Fight 两关均完成；真实日志回调汇总为 `1-7`、`sanityUsed: 12`、掉落聚合正确；`StageActivityV2` 的 Txwy 活动识别成功；AP 成本恢复正常。
> - 页面验证（生产模式 `:3100` + 隔离 headless Chrome）：数据页显示 406 名干员 / 430 项；仓库识别页显示 82 项、77 种材料；页面点击“立即执行”完成真实 Depot（14s）和 OperBox（40s）；掉落记录页正确显示 MaaResource 图标（GOLD.png、MTL_ASC_SNP1.png）；配置页点击“仅同步游戏资源”返回“资源文件更新成功”；自动化页临时改为两关 `1-7 ×1` 后点击执行，结果“成功 1 · 184 秒 / 1-7 2 次 / 掉落 6 种”，并写入 `server/data/drop-records/2026-10-31.json`（每关 `sanity: 6`，总计 12）。测试后已恢复原 6 任务流程。
> - 验证：server 42 个测试文件、client 42 个测试文件全部通过。

### Phase 3：执行路径换原生

- [ ] 3.5 抄作业原生委托。
- [ ] 3.6 每日流程任务文件。
- [ ] 3.7 动态任务文件 JSON/子目录/`--batch`。
- [ ] 3.8 调度条件 `condition`/`variants`。
- [ ] P1 配置/连接/更新流程。

### Phase 4：新增功能

- [ ] Custom / 小工具。
- [ ] 肉鸽完整参数面。
- [ ] Fight/Infrast/Recruit/Award 参数。
- [ ] 生息演算。
- [ ] 连接预设/触控模式。
- [ ] 仓库/干员数据展示。
- [ ] UI 暴露与文案。

### Phase 5：清理与文档

- [ ] 删除死代码/旧脚本/旧注释。
- [ ] 更新 README / COMPONENT_LIBRARY_GUIDE（如涉及 UI）。
- [ ] 更新 `server/routes/agentContract.js` 与契约测试。
- [ ] 更新本文档的“已完成/未完成”状态。

---

## 8. 验证与回归

### 8.1 常规命令

```bash
npm run lint --prefix client
npm run type-check --prefix client
npm run test --prefix client
npm run build --prefix client

npm run check --prefix server
npm run test --prefix server

npm run verify
```

### 8.2 隔离存储

```bash
cd server
LA_PLUMA_AGENT_RUN_STORE=/tmp/la-pluma-agent-runs-test.json node --test services/__tests__/agentRunPersistence.test.js
```

### 8.3 外部副作用规则

- 默认使用 mock / dry-run / 只读预检。
- 不启动真实战斗、不消耗理智/药品/源石、不发送通知、不更新 MAA Core/资源，除非用户明确要求。
- `maa run --dry-run` 只作加载预检；它会 hot-update、load_core、append_task，仍可能联网。
- 真机验证需用户显式授权，不能作为 CI 步骤。

### 8.4 每阶段的验收

- Phase 1：P0 单测 + 契约测试；真实日志 fixture 通过。
- Phase 2：资源/活动/掉落/材料四类数据与 MAA 实际输出一致。
- Phase 3：原生委托不挂起；每日流程结果与旧路径一致；停止/超时可控。
- Phase 4：UI 初始/加载/空/错误/禁用/长内容状态在桌面与移动端、亮暗主题下检查。

---

## 9. 附录

### A. 关键路径与数据源

| 用途 | 路径 |
| --- | --- |
| 基资源（完整，随 Core） | `maa dir resource` |
| MaaResource Git 检出 | `maa dir hot-update`（实际是 `data/MaaResource`） |
| 热更新覆盖层 | `$(maa dir cache)/resource/**/tasks/tasks.json` |
| 活动数据 | `$(maa dir cache)/StageActivityV2.json` |
| MirrorChyan 快照 | `$(maa dir data)/mirrorchyan/MaaResource/current.json` 指向的目录 |
| 配置/任务 | `maa dir config`（`profiles/`、`tasks/`） |
| 日志/截图 | `maa dir log`（`asst.log`、`asst.bak.log`、`debug/`） |
| 项目 Agent Run 存储 | `server/data/agent-runs.json`（可用 `LA_PLUMA_AGENT_RUN_STORE` 覆盖） |

### B. 关键 CLI 事实

- `maa update` = Core 更新 + 基资源 + MaaResource + hotfix；**只升不降**。
- `maa hot-update` = hotfix + 配置的资源源；**不更新基资源**。
- `maa run` 每次运行前自动 hot-update（`run/mod.rs:130-131`）；网络失败会让任务失败。
- `maa install <channel> --force` 可切渠道/降级；`maa self update --force` 仅存在于启用 `cli_installer` 的构建。
- `maa cleanup` 默认清 `cli-cache core-cache debug`，不清 `tasks/`。
- `maa run --dry-run` 会加载 Core/资源并 append_task，不是纯语法检查。
- `maa list` 只列 `tasks/` 顶层文件，不递归子目录。
- `maa://` 在 0.7.7 仍可用，但首次使用会打印弃用警告；输出优先 `prts://`。
- `maa fight --series` 帮助文本仍写 -1~6，但实际可透传 -1~10；外服旧资源可能拒绝 >6。
- `maa roguelike` 0.7.7 只接受 Phantom/Mizuki/Sami/Sarkaz/JieGarden 和 mode 0–5。
- `maa reclamation` 0.7.7 发送 `increase_mode`，Core 文档键为 `increment_mode`，该参数实际不生效。

### C. 证据来源

- MaaCore 发布说明：`v6.3.0`–`v6.21.0-beta.3` 的 GitHub Release body。
- maa-cli 发布说明与源码：`v0.7.0`、`v0.7.7` tag；`crates/maa-cli`、`crates/maa-types`、`crates/maa-dirs`。
- MaaCore 协议文档：`docs/zh-cn/protocol/integration.md`、`callback-schema.md`、`copilot-schema.md`、`base-scheduling-schema.md`、`integrated-strategy-schema.md`、`task-schema.md` 在 `v6.2.3` 与 `v6.20.1` 的 diff。
- maa-cli 手册：`docs/zh-cn/manual/cli/config.md`、`usage.md`、`install.md`。
- 本机实测：`maa version`、`maa <cmd> --help`、`maa dir *`、`~/Library/Caches/com.loong.maa/StageActivityV2.json`、`~/Library/Application Support/com.loong.maa/debug/asst.log`。
- 项目代码：见各条目中的 `file:line`。

### D. 未验证项 / 需真机确认

- `FightTimes.sanity_cost`、`SanityBeforeStage` 不在公开回调文档，只在本机 6.20.1 日志出现；`UseMedicine` 本机 0 次命中，必须容错。
- `nav_name_override` 对旧 Core 的兼容性：本机 dylib 同时含 `stage_name` 与 `nav_name_override`，但未做设备侧验证；建议双写过渡。
- `ignore_requirements` 在 6.3.1/6.16.6 后的精确行为：文档说不再跳过精英化，还会校验技能/模组，未实机验证。
- `Recruit` 的 `confirm` 星级语义：6 星自动确认涉及账号资源，不能凭 UI 文案推断。
- `asst.bak.log` 的轮转语义：本机同时存在 33MB `asst.log` 与 67MB `asst.bak.log`，但没有证据 bak 是当前窗口的续读。
- `maa self` 在其他发行包/安装方式下是否存在，需运行时探测。
- `StageActivityV2.MinimumRequired` 与已安装 Core 版本的比较、`maa cleanup cli-cache` 后的恢复路径，未验证。
- 6.21 beta / 0.8 nightly 的 Breaking 项未纳入当前实现。

### E. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-31 | 初版：基于 MaaCore 6.2.3/6.14.2 → 6.20.1、maa-cli 0.7.0/0.7.5 → 0.7.7 的差异与项目代码审计 |
