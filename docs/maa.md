# MAA 集成说明

本文件记录 La Pluma 与 MaaCore / maa-cli 的对接现状：版本基线、未完成项、明确的边界，以及仍然有效的 CLI 与路径事实。版本差异研究和已执行计划的完整记录见 git 历史。

## 版本基线

| 组件 | 立项 | 当前 |
| --- | --- | --- |
| MaaCore | `v6.2.3` | `v6.21.4` |
| maa-cli | `v0.7.0` | `v0.7.8` |

本文只讨论能通过 maa-cli 或 MaaCore 任务 JSON / 回调使用的能力；WPF 界面独占功能标注为 `gui-only`，不要按 CLI 能力实现。

## 当前状态

资源同步、活动识别、战斗结果、材料字典四条数据管线已改为 MAA 原生来源；悖论干员映射、关卡名索引、物品图标和干员头像改为从 MaaResource 本地派生或读取；`client_type`、识别响应信封、Depot 日志解析、Agent 多关卡 Fight 等 P0 兼容问题已修复；原生委托（copilot / 动态任务 / 调度条件）已接入。

## 未完成项

| 项 | 现状 |
| --- | --- |
| 每日流程任务文件 | 仍走 `executeTaskFlowUnlocked`，逐任务结果归属未重做（`go/internal/app/scheduler`） |
| 开放日判断 | `condition` / `variants` 已支持透传，但硬编码的 `isStageOpenToday` 尚未替换（同文件） |
| 真实 CLI fixture | 尚未用真实回调固化 Depot / OperBox / Recruit / Infrast / Mall / Award / Fight 的回归样本 |

## 范围决策（明确不做）

| 能力 | 说明 |
| --- | --- |
| PC 端（Win32）连接与控制 | WPF 独占；maa-cli 无 PC/Win32 预设 |
| MuMu 触控增强（MuMu IPC） | WPF 独占；`touch_mode` 不接受 `MumuExtras` |
| 库存保持（DepotMaintain） | WPF 用 Depot + Fight 组合实现，不是 Core 任务类型 |
| 更新数据（UpdateData） | WPF 用 Depot + OperBox 组合实现，不是 Core 任务类型 |
| 外部通知 | WPF 独占；继续使用项目自己的 Telegram 通知 |
| 更新失败自动修复、任务时长上限、完成后动作 | WPF 独占 |
| 6 星自动公招的 GUI 配置项 | Core 可用星级数组等价实现，GUI 配置项本身不可用 |
| 干员识别读取一图流练度快照 | GUI-only；CLI 只能读 OperBox 回调 |
| Copilot 新动作 / `elapsed_time` / `skill` 默认 0 | 由 Core 解析，项目原样透传，不改写作业 JSON |
| 6.21 beta / 0.8 nightly 的 Breaking 项 | 不纳入当前实现；`maa://` 仅保留输入兼容 |

## 技能专精（OperProgress）

MaaCore 6.21.4 / maa-cli 0.7.8 已支持 `OperProgress` 任务类型；La Pluma 的专精队列在 `autoStartGame` 开启时，每次步骤前附加 `CloseDown` + `StartUp`，强制回到主界面，避免上一次导航停留在设置/场景页时 `OperProgress` 误点；关闭该选项后只保留 `StartUp`，游戏未启动时不会自动拉起。La Pluma 只通过 `plans` 执行单级专精：每项计划使用 `name`、可选 `role`，以及一个长度为 3 的 `skill_mastery` 数组，只把本次要推进的技能槽设为下一级，其余为 0。

- `Completed` / `PrerequisiteTraining` 只表示本次训练已经发起，不代表专精完成；只有 `AlreadySatisfied` 表示目标等级已到达。
- 一次运行最多启动一级；训练室必须空闲；MAA 只在加工站合成仓库已有材料，不刷关卡。
- 2026-11-08 已用本机 maa-cli 0.7.8 / MaaCore 6.21.4 验证：`maa run --dry-run` 接受合法 plans、拒绝非法 `skill_mastery`；真机单步观察到 `AlreadySatisfied`（`skill_mastery:[3,0,0]`）、`Completed`（训练已开始）、`TrainingRoomBusy`（训练中）、`PrerequisiteNotMet` 与 `RecognitionFailed` 回调。`Completed` / `PrerequisiteTraining` 只代表训练已开始，`AlreadySatisfied` 才代表目标等级已到达。
- 专精数据由历史 Node 脚本生成到 `operator-mastery.json`；Go 运行时不依赖该脚本，Node 后端已归档移除。

## 关键路径与数据源

| 用途 | 路径 |
| --- | --- |
| 基资源（完整，随 Core） | `maa dir resource` |
| MaaResource Git 检出 | `maa dir hot-update`（实际是 `data/MaaResource`） |
| 热更新覆盖层 | `$(maa dir cache)/resource/**/tasks/tasks.json` |
| 活动数据 | `$(maa dir cache)/StageActivityV2.json` |
| 关卡名 / 内部 stageId 索引 | `$(maa dir resource)/Arknights-Tile-Pos/*.json`（`code`、`name`、`stageId`；悖论映射由 `char_*_<suffix>` → `mem_<suffix>_1` 派生） |
| 物品图标 | `$(maa dir resource)/template/items/*.png`（经 `/api/maa-assets/item/:key` 提供，先按物品 ID、再按 `iconId` 反查） |
| 干员头像 | `$(maa dir resource)/template/avatar/char_*.png`（经 `/api/maa-assets/avatar/:id` 提供；只在基资源中，MaaResource 上游不含该目录） |
| MirrorChyan 快照 | `$(maa dir data)/mirrorchyan/MaaResource/current.json` 指向的目录 |
| 配置/任务 | `maa dir config`（`profiles/`、`tasks/`） |
| 日志/截图 | `maa dir log`（`asst.log`、`asst.bak.log`、`debug/`） |
| 项目 Agent Run 存储 | `<LA_PLUMA_DATA_DIR>/agent-runs.json` |

`paradox-operators.json` 和 `stages.json` 旧文件已不再参与运行时；悖论干员与关卡名都从 MaaResource 推导，两个旧文件仅保留为历史数据。

`/api/maa-assets/{item,avatar}/:key` 是只读的 MaaResource 图片路由，挂在 `LA_PLUMA_TOKEN` 鉴权之前（`<img>` 无法附带 bearer 头）；它只接受受限文件名，并且只暴露 `template/items` 与 `template/avatar`。

## 关键 CLI 事实

- `maa update` = Core 更新 + 基资源 + MaaResource + hotfix；**只升不降**。
- `maa hot-update` = hotfix + 配置的资源源；**不更新基资源**。
- `maa run` 每次运行前自动 hot-update；网络失败会让任务失败。
- `maa install <channel> --force` 可切渠道/降级；`maa self update --force` 仅存在于启用 `cli_installer` 的构建。
- `maa cleanup` 默认清 `cli-cache core-cache debug`，不清 `tasks/`。
- `maa run --dry-run` 会加载 Core/资源并 append_task，不是纯语法检查。
- `maa list` 只列 `tasks/` 顶层文件，不递归子目录。
- 作业集 URI 为 `prts://s<id>`；`maa://`、`maa://<id>s`、`prts://<id>s` 仅保留输入兼容，Web 控制台执行前统一归一化为该形式。
- `maa fight --series` 帮助文本写 -1~6，实际可透传 -1~10；外服旧资源可能拒绝 >6。
- `maa roguelike` 0.7.7 只接受 Phantom/Mizuki/Sami/Sarkaz/JieGarden 和 mode 0–5。
- `maa reclamation` 0.7.7 发送 `increase_mode`，Core 文档键为 `increment_mode`，该参数实际不生效。

## 未验证项

- `all_opers` 不是项目名册的超集：本机 own=395、all=452，all 中有 33 个不在名册（NPC/预览/异格），名册中有 11 个不在 all 的联动词干员。使用前必须做 own/可玩性过滤或合并。
- `FightTimes.sanity_cost`、`SanityBeforeStage` 不在公开回调文档，只在本机 6.20.1 日志出现；`UseMedicine` 本机 0 次命中，必须容错。
- `nav_name_override` 对旧 Core 的兼容性未做设备侧验证，建议双写过渡。
- `ignore_requirements` 在 6.3.1 / 6.16.6 后的精确行为未实机验证。
- `Recruit` 的 `confirm` 星级语义涉及账号资源，不能凭 UI 文案推断。
- `asst.bak.log` 的轮转语义没有证据表明是当前窗口的续读。
- `StageActivityV2.MinimumRequired` 与已安装 Core 版本的比较、`maa cleanup cli-cache` 后的恢复路径未验证。
