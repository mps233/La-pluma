# 持久化与运行数据

> [← 返回文档索引](../README.md)

本文说明服务端各类持久化数据的所有者、位置与默认值来源，以及写入原子性、损坏 fail-closed、恢复语义和单实例约束。Run 状态机、停止矩阵与关闭流程见[执行身份与生命周期契约](../architecture/execution-lifecycle.md)与[运行时初始化、就绪与关闭](runtime-lifecycle.md)；前端配置草稿协调见[配置持久化协调器](../architecture/config-persistence.md)。文档与代码冲突时以代码为准。

## 路径解析与写入基元

- 应用内路径由 `resolveAppPaths` 解析（`apps/server/src/config/runtimeConfig.ts:167-190`）：锚定模块自身位置、与进程 cwd 无关，导入无副作用。应用持久数据根目录为 `apps/server/data`（不入库）；养成数据目录默认与持久数据根目录相同，可被 `LA_PLUMA_TRAINING_DATA_DIR` 重定向（`apps/server/src/config/runtimeConfig.ts:171`）。资源更新由 maa-cli 管理，应用不再维护本地克隆暂存目录。
- 应用路径分五类互不混用：持久数据与内置/解析数据共享 `apps/server/data` 根目录但由不同字段区分，临时目录与前端产物独立锚定；外部 MAA 路径见 `apps/server/src/config/paths.ts`（`apps/server/src/config/runtimeConfig.ts:163-165`）。内置/抓取数据包括企鹅物流掉落数据（脚本抓取，`apps/server/src/config/runtimeConfig.ts:148`）等。
- 外部 MAA 的配置/数据/状态目录按平台与 XDG 约定解析（`apps/server/src/config/paths.ts:93-113`），MAA 主日志默认 `<状态目录>/debug/asst.log`（`apps/server/src/config/paths.ts:108`）。
- JSON 写入是临时文件加原子替换：同目录独占创建 `.tmp`、fsync、`rename` 覆盖、fsync 目录；失败清理临时文件，原内容不变（`apps/server/src/utils/fileHelper.ts:102-138`）。同一路径的写入、读改写与删除按路径排队串行；`updateJsonFile` 把读取、更新、写回作为同一排队单元，并发读改写不会互相覆盖（`apps/server/src/utils/fileHelper.ts:10-23,155-166`）。
- JSON 读取：文件缺失返回调用方默认值；语法损坏抛出 `JsonFileParseError`，与磁盘 IO 失败可区分（`apps/server/src/utils/fileHelper.ts:67-100`）。
- 执行租约锁文件不用替换写入，而是 `link()` 原子发布：完整内容先写临时文件再硬链接，目标已存在即失败，锁文件从可见的第一刻起就是完整 JSON（`apps/server/src/services/executionCoordinatorService.ts:198-214`）。
- 多数持久模块（进度、台词、用户配置默认实例）在模块导入时读取环境变量绑定路径，覆盖变量须在导入前生效（`apps/server/src/services/copilotPlanService.ts:25-28`、`apps/server/src/services/activityCompletionService.ts:5-10`、`apps/server/src/services/operatorQuotesService.ts:87`、`apps/server/src/services/configStorageService.ts:87`）；Run 存储的 `LA_PLUMA_AGENT_RUN_STORE` 在 `initializeAgentRunStore` 调用时读取，覆盖可在服务启动前注入（`apps/server/src/services/agentRunService.ts:860-872`）。

## 数据类别总表

| 数据类别 | 所有者 | 位置（默认 / 覆盖变量） | 恢复语义 |
| --- | --- | --- | --- |
| Run 与幂等记录 | `agentRunService` | `apps/server/data/agent-runs.json`；`LA_PLUMA_AGENT_RUN_STORE`（`apps/server/src/services/agentRunService.ts:31,872`） | 启动恢复并逐字段校验；损坏 fail-closed |
| 用户配置（白名单类型） | `configStorageService` | `apps/server/data/user-configs/<类型>.json` | 缺失按 `null` 读取；损坏读取报错；启动恢复通知/自动化任务/自动更新 |
| 养成队列与设置 | `operatorTrainingStore` | `<trainingDataDir>/user-configs/training-queue.json`（`apps/server/src/services/operatorTrainingStore.ts:44-45`） | 非法条目忽略；语法损坏读取抛错 |
| 自动化任务配置 | `operatorTrainingStore` | `<trainingDataDir>/user-configs/automation-tasks.json`（`apps/server/src/services/operatorTrainingStore.ts:46`） | 结构无效抛错，不覆盖原文件 |
| 养成数据快照 | `operatorTrainingStore`（脚本/识别产物） | `<trainingDataDir>/` 下 `materials.json`、`material-formulas.json`、`operator-materials.json`、`depot.json`、`operbox.json` | 结构不符回退空表 |
| 掉落记录 | `dropRecordService` | `apps/server/data/drop-records/<YYYY-MM-DD>.json`；`LA_PLUMA_DROP_RECORDS_DIR`（`apps/server/src/config/runtimeConfig.ts:177`） | 写入遇损坏 fail-closed；读取历史跳过损坏日 |
| 作业集/活动完成进度 | `copilotPlanService`、`activityCompletionService` | `apps/server/data/copilot-progress.json`；`LA_PLUMA_COPILOT_PROGRESS_STORE`（`apps/server/src/services/copilotPlanService.ts:25-28`）、`apps/server/data/activity-copilot-progress.json`；`LA_PLUMA_ACTIVITY_COPILOT_PROGRESS_STORE`（`apps/server/src/services/activityCompletionService.ts:5-10`） | 损坏抛错，不静默清零 |
| 本地导入的作业文件 | `copilotFileService` | `apps/server/data/copilot-imports/<uuid>.json`（权限 `0o600`） | 不恢复；每次上传新建文件，不自动清理 |
| 干员台词 | `operatorQuotesService` | `apps/server/data/operatorQuotes.json`；`LA_PLUMA_OPERATOR_QUOTES_STORE`（`apps/server/src/services/operatorQuotesService.ts:87`） | 缺失用内置兜底文案；损坏读写报错，不用兜底覆盖 |
| 执行租约 | `executionCoordinatorService` | `apps/server/data/maa-execution.lock`；`LA_PLUMA_MAA_LOCK_FILE`（`apps/server/src/services/executionCoordinatorService.ts:21,89-91`） | PID 存活即占用；不存活可回收；无法解析按 `unknown` |
| MAA 日志与调试截图 | MAA CLI 产物；`maaLogFileService` 只读 | `maa dir log` 解析的日志目录；MAA 状态目录 `debug/` | 不恢复；检查点仅在内存 |
| MAA profile 连接与实例选项 | `maaConfigService` | `maa dir config` 解析的 MAA 配置目录 `profiles/<profile>.toml`（TOML） | 在 MAA 侧持久化，不入 `apps/server/data`；按 section 合并写入，未知 section 原样保留 |
| 更新渠道与资源源 | `updateChannelService`、`resourceSourceService` | 同一配置目录下的 `cli.toml`（TOML） | 在 maa-cli 侧持久化；凭据只落本地文件，HTTP 只回显形态 |
| 自定义基建排班文件 | `infrastScheduleService` | `maa dir config` 解析的 MAA 配置目录下 `infrast/*.json`（相对路径与 maa-cli 一致） | 读取返回原文；保存前按 Core 协议校验并原子替换，未知扩展字段原样保留 |

`<trainingDataDir>` 默认 `apps/server/data`；`LA_PLUMA_TRAINING_DATA_DIR` 同时重定向养成队列、自动化任务与养成数据快照的目录。

## Run 存储与幂等记录

- 磁盘快照为单文件 `{version, savedAt, runs[]}`，版本固定 `1`（`apps/server/src/services/agentRunService.ts:30,113-117`）。
- 状态变更只置脏标记，由微任务排队把整份快照原子写盘（`apps/server/src/services/agentRunService.ts:286-335`）；执行控制器、调度入口与关闭收尾在关键点显式 flush（`apps/server/src/controllers/agentExecutionController.ts:267,293`、`apps/server/src/services/schedulerService.ts:151`、`apps/server/src/services/executionShutdownService.ts:119`）。
- 启动恢复（`apps/server/src/services/agentRunService.ts:860-940`）：每条记录从 `unknown` 逐字段校验身份、状态、时间戳与序号（`apps/server/src/services/agentRunService.ts:661-770`）；重复 `runId`/`sequence`/幂等键、版本不符或缺终态时间戳都抛不可重试的 `AGENT_RUN_STORE_INVALID`（`apps/server/src/services/agentRunService.ts:641-647,779-858`）。恢复时所有活动 run 一律转为 `interrupted` 终态并写入 `AGENT_RUN_INTERRUPTED`（`reason=server_restart`），不自动续跑（`apps/server/src/services/agentRunService.ts:833-850`）；随后按保留策略清理终态。
- 损坏 fail-closed：JSON 语法损坏、形状或版本不符使初始化失败，纳入 Run 的执行接口与 `/readiness` 保持不可用，不删除或重建文件绕过（`apps/server/src/services/agentRunService.ts:889-906`）。`/readiness` 的 `runStore` 检查取「已启用且无持久化错误」，启动恢复失败与运行期写入失败都会让它转为不可就绪（`apps/server/src/services/agentRunService.ts:366-375`；`runtime-lifecycle.md:42-44`）。
- 运行期写入失败会记录持久化错误并使后续准入 flush 失败，返回可重试的 `AGENT_RUN_PERSISTENCE_FAILED` 或不可重试的 `AGENT_RUN_STORE_INVALID`（`apps/server/src/services/agentRunService.ts:242-253`；`apps/server/src/controllers/agentExecutionController.ts:291-297`）。
- 终态保留：24 小时或 500 条先到先淘汰，淘汰后按 `runId` 查询返回 404，同幂等键请求会创建新 run（`apps/server/src/services/agentRunService.ts:25-26,487-510`）。幂等键按 `operationId` 分区持久化：同键同输入跨重启重放原 run，同键不同输入返回 409（`apps/server/src/services/agentRunService.ts:980-1003`）。

## 用户配置白名单

- 类型白名单 `USER_CONFIG_TYPES` 固定为 `activity-cache`、`auto-update`、`automation-tasks`、`combat-tasks`、`notification`、`roguelike-tasks`、`training-queue`，与磁盘 `<类型>.json` 一一对应；白名单外的类型读写被拒绝，`getAllUserConfigs` 也只收集白名单文件（`apps/server/src/services/configStorageService.ts:18-26,216-238`）。
- 载荷只要求顶层 JSON 对象，不收窄字段（`apps/server/src/services/configStorageService.ts:60-79`）。
- `saveUserConfig` 整份覆盖，不与已有内容合并；`updateUserConfig` 是排队读改写；跨调用「先 load 再 save」不构成原子读改写（`apps/server/src/services/configStorageService.ts:148-186,201-213`）。
- 读取：缺失文件返回 `null`；损坏文件返回错误 envelope，不返回部分内容（`apps/server/src/services/configStorageService.ts:189-198`）。删除：文件不存在也按已完成处理（`apps/server/src/services/configStorageService.ts:241-256`）。
- 启动时恢复通知、自动化任务与自动更新配置并重新注册定时任务，只注册不执行（`apps/server/src/services/runtimeInitializationService.ts:181-184`）。

## 养成队列与计划

- 队列文件包含 `queue`、`settings` 与 `lastUpdated`，未知顶层字段原样保留回写（`apps/server/src/services/operatorTrainingStore.ts:73-81,193-208`）。解析时缺少 `operatorId` 的条目忽略并告警；JSON 语法错误由 `readJsonFile` 抛出，不被吞掉（`apps/server/src/services/operatorTrainingStore.ts:177-209`）。
- 队列内容指纹 `queueRevision` 是条目列表的 SHA-256（`apps/server/src/services/operatorTrainingStore.ts:211-217`）；养成计划应用必须校验它，并保留「队列已保存但流程/定时同步失败」的部分成功结果，不伪装成全成功。
- 养成计划不落盘：服务端没有计划存储、版本或迁移。应用时在写入 automation 配置与队列之前，按当前连接 profile 的客户端类型、当前游戏日和活动窗口重新校验计划上下文；游戏日、客户端类型或打算应用的关卡已失效时返回 409 并保持零写入。
- `GET /training/queue` 的计划上下文 `gameDate`/`clientType` 只读取连接 profile 与游戏日历，不读取活动表，也不改变队列文件。
- 自动化任务配置读取时校验最小结构（对象、`taskFlow` 数组、任务 `params/stages` 形态），无效抛错；写回经 fileHelper 路径队列整体替换，不丢弃本领域未读取的字段（`apps/server/src/services/operatorTrainingStore.ts:493-533`）。
- 养成数据快照（材料库、合成配方、干员材料、OperBox、仓库）结构不符时按空表处理并告警，不抛错（`apps/server/src/services/operatorTrainingStore.ts:288-300,335-366,441-481`）。
- `operbox.json` 在 `data`（已识别拥有）之外可带 `allOpers`（识别目录，含 `owned` 标记与多语言名称）、`operTotal` 与 `recognition`；`recognition.status` 是写入时唯一的完整度信号，读取时不从目录存在与否反推，缺少该字段的快照一律按部分识别处理（`allOpers` 缺失不视为损坏），消费方据此区分已拥有、确认未拥有与未知（`apps/server/src/services/operatorCatalogModel.ts`、`apps/server/src/services/dataParserService.ts`、`apps/server/src/services/operatorTrainingService.ts`）。
- 仓库/干员识别缓存只接受当前任务链最后一条 `details.done=true` 的载荷；未完成、跨事件或上一轮运行的旧结果不写盘，保留上一份完整快照（`apps/server/src/services/dataParserService.ts`）。

## 掉落记录

- 按天一文件，业务日期取 `TZ` 时区、缺省 `Asia/Shanghai`（`apps/server/src/services/dropRecordService.ts:127-136,237-239`）；单次记录经 `updateJsonFile` 排队读改写，同时增量累加当日汇总。
- 写入时既有文件不可解析则按失败处理，不覆盖或清空历史；读取历史时单日文件损坏只跳过该天并告警（`apps/server/src/services/dropRecordService.ts:272-280,377-387`）。
- 旧记录缺 `source`/`mode` 时补默认值 `fight`/`normal`（`apps/server/src/services/dropRecordService.ts:157-191`）；历史查询天数夹取到 1-`MAX_DROP_HISTORY_DAYS`（365，`apps/server/src/services/dropRecordService.ts:20,361-365`）。
- 作业集与显式队列执行写入的记录（`source: 'copilot'`）只在计划解析出关卡理智消耗时携带 `sanity`；理智来自本地关卡资源，解析不到时省略该字段而不是写 0，当日汇总也不因此增加（`apps/server/src/services/copilotPlanService.ts:1985-1998`）。记录写入失败（envelope `success: false`）会让本次执行以该错误结束，已结算的条目不回退为失败。
- 后加字段 `recordKey`、`sanityBefore`、`maxSanity` 均可选（`apps/server/src/services/dropRecordService.ts:33-48,167-189`）：`recordKey` 是同日记录的幂等键，同键重复写入被忽略；`sanityBefore`/`maxSanity` 记录开战前理智与理智上限。旧记录缺失或类型不符时按缺省处理，不使整份记录判为损坏；写盘时仅在请求提供合法值时落字段（`apps/server/src/services/dropRecordService.ts:272-295`）。
- 统计的材料表读取同时接受旧数组格式与脚本产出的 `{materials, recipes, stageSchedule}` 对象格式：对象按物品 id 取值，条目缺 `iconId` 时回退物品 id 作为图标键，统计条目同时带上独立的 `id` 供客户端优先按物品 id 取图，旧数组格式没有 `id` 时客户端回退图标键（`apps/server/src/services/dropRecordService.ts:458-530`）；对象格式与养成计算的读取约定一致（`apps/server/src/services/operatorTrainingStore.ts:318-336`）。材料表无法解析或格式无法识别时返回空映射，并按文件路径只告警一次，材料表恢复正常后再次损坏仍会重新告警。

## copilot 与 activity 进度

- 两个进度文件都是「单文件多键」的共享状态：原子替换、路径排队与完整读改写由 fileHelper 承担（`apps/server/src/services/copilotProgressStore.ts:1-50`）。copilot 进度仍会写入；activity 进度只读历史数据，供 `/api/agent/activity` 的 completion 展示。
- 读取值显式为 `unknown`，由各领域服务在读取处收窄；损坏文件抛出可识别错误而不是静默清零（`apps/server/src/services/copilotProgressStore.ts:42-48`）。

## 本地导入的作业文件

- `POST /api/copilot-files` 校验通过后把上传原文写入 `apps/server/data/copilot-imports/`；文件名使用 `randomUUID()`，权限 `0o600`，目录按需创建（`apps/server/src/services/copilotFileService.ts`）。
- 展示文件名只存在于接口响应，不参与落盘路径；上传副本由服务端在队列执行前重新读取并写入队列计划目录，不供 maa-cli 直接读取，也不与 Run、配置或进度文件共享写入路径。
- 目录迁移前加入队列的本地 JSON 作业记录了旧绝对路径。升级后请移除这些条目，再重新导入作业文件。
- 该目录当前没有自动清理机制，属于运行数据：整目录备份会一并带走上传副本，部署方如需回收磁盘空间应在上传来源空闲时自行清理。

## 干员台词

- 自定义文件缺失视为尚未自定义，读取返回内置兜底文案；首次写入把兜底文案连同变更一并落盘（`apps/server/src/services/operatorQuotesService.ts:5-11`）。
- 文件存在但解析失败或顶层不是数组视为损坏：读取与写入一律报错，绝不用兜底文案覆盖原文件（`apps/server/src/services/operatorQuotesService.ts:9-11`）。读改写整体在同一排队单元内执行，写回为原子替换（`apps/server/src/services/operatorQuotesService.ts:12-14`）。

## MAA 日志与检查点

- MAA 日志目录由 `maa dir log` 解析并在进程内缓存，失败在 30 秒冷却期内复用同一错误（`apps/server/src/services/maaLogFileService.ts:105-128`）。
- 读取只允许日志目录内 `.log` 文件：两侧 realpath 后按目录边界判定，目录外符号链接被拒绝（`apps/server/src/services/maaLogFileService.ts:268-278,345-349`）；内容从尾部按块读取，单次最多 2 MB，行数上限 5000（`apps/server/src/services/maaLogFileService.ts:24-29,337-380`）。
- 增量日志检查点只保存在内存中。日志轮转后的恢复条件与读取状态见[日志文件边界与检查点](integrations.md#日志文件边界与检查点)。
- 手动清理按修改时间从新到旧累加，累计超出保留上限（1-1024 MB）后删除较旧的 `.log` 文件；调试截图列表只读 MAA 状态目录 `debug/`（`apps/server/src/services/maaLogFileService.ts:229-262,386-424`）。实时日志缓冲不在这里，属于 `maaProcessService` 的子进程投影（`apps/server/src/services/maaLogFileService.ts:18`）。

## 单实例约束

- Run 存储是单实例语义：不得让多个 Node 进程共用同一份 Run 文件；fileHelper 的路径队列与 Run 存储去重都在单进程内生效，跨进程没有协调（`docs/architecture/execution-lifecycle.md:26`）。
- 跨进程互斥只覆盖设备变更权：协作进程经执行租约锁文件竞争，PID 存活即视为占用，无法解析的锁按 `unknown` 拒绝获取而不是当作空闲（`docs/architecture/execution-lifecycle.md:222-227`）。

## 备份与迁移注意事项

- 全部应用持久化数据默认集中在 `apps/server/data`，目录不入库、打包时与源码隔离。整目录复制即可带走默认位置的 Run、用户配置、掉落与进度数据；使用 `LA_PLUMA_AGENT_RUN_STORE`、`LA_PLUMA_DROP_RECORDS_DIR`、`LA_PLUMA_TRAINING_DATA_DIR` 等覆盖变量的部署，需同步移动对应文件。
- 从目录迁移前的源码版本升级时，先停止服务并备份旧 `server/data/`。Git 更新后，仍留在旧目录的运行数据和参考数据需移到 `apps/server/data/`，遇到同名文件时先核对内容。若覆盖变量指向旧目录，也需更新对应路径。
- Run 存储版本固定 `1`，不支持旧版本自动迁移；升级格式必须能读取旧文件或提供明确迁移路径，不支持时保持 fail-closed，不得删除 Run 文件绕过准入关闭（`docs/architecture/execution-lifecycle.md:311`）。
- Run 存储逐字段严格校验，手工编辑容易触发不可重试的 `AGENT_RUN_STORE_INVALID` 并关闭执行接口；备份或替换该文件应在服务停止时进行，避免出现两个写入者。
- 现有前向兼容面：养成队列与自动化任务配置回写时保留未识别顶层字段；用户配置载荷不限制字段；掉落记录旧条目缺 `source`/`mode` 自动补默认值。新增字段时沿用同一策略，引用见上文各节。

## 延伸阅读

- [执行身份与生命周期契约](../architecture/execution-lifecycle.md)：Run 身份、重启恢复与持久化失败语义的完整契约。
- [运行时初始化、就绪与关闭](runtime-lifecycle.md)：启动顺序、`/readiness` 投影与关闭预算。
- [Agent API 使用指南](../api/agent.md)：幂等键、执行入口与错误码。
