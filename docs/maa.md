# MAA 集成说明

本文件记录 La Pluma 与 MaaCore / maa-cli 的对接现状：版本基线、未完成项、明确的边界，以及仍然有效的 CLI 与路径事实。版本差异研究和已执行计划的完整记录见 git 历史。

## 版本基线

| 组件 | 立项 | 当前 |
| --- | --- | --- |
| MaaCore | `v6.2.3` | `v6.20.1`（预览 `v6.21.0-beta.3`） |
| maa-cli | `v0.7.0` | `v0.7.7`（预览 `0.8.0-nightly`） |

本文只讨论能通过 maa-cli 或 MaaCore 任务 JSON / 回调使用的能力；WPF 界面独占功能标注为 `gui-only`，不要按 CLI 能力实现。

## 当前状态

资源同步、活动识别、战斗结果、材料字典四条数据管线已改为 MAA 原生来源；`client_type`、识别响应信封、Depot 日志解析、Agent 多关卡 Fight 等 P0 兼容问题已修复；原生委托（copilot / 动态任务 / 调度条件）已接入。

## 未完成项

| 项 | 现状 |
| --- | --- |
| 每日流程任务文件 | 仍走 `executeTaskFlowUnlocked`，逐任务结果归属未重做（`server/services/schedulerService.js`） |
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
| `SwitchTheme` / `OperProgress` | Core 有，但 maa-cli 0.7.7 的 `TaskType` 不支持，`maa run` 会报 unknown variant |
| Copilot 新动作 / `elapsed_time` / `skill` 默认 0 | 由 Core 解析，项目原样透传，不改写作业 JSON |
| 6.21 beta / 0.8 nightly 的 Breaking 项 | 不纳入当前实现；`maa://` 仅保留输入兼容 |

## 关键路径与数据源

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

## 关键 CLI 事实

- `maa update` = Core 更新 + 基资源 + MaaResource + hotfix；**只升不降**。
- `maa hot-update` = hotfix + 配置的资源源；**不更新基资源**。
- `maa run` 每次运行前自动 hot-update；网络失败会让任务失败。
- `maa install <channel> --force` 可切渠道/降级；`maa self update --force` 仅存在于启用 `cli_installer` 的构建。
- `maa cleanup` 默认清 `cli-cache core-cache debug`，不清 `tasks/`。
- `maa run --dry-run` 会加载 Core/资源并 append_task，不是纯语法检查。
- `maa list` 只列 `tasks/` 顶层文件，不递归子目录。
- `maa://` 在 0.7.7 仍可用，但首次使用会打印弃用警告；输出优先 `prts://`。
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
