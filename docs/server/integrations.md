# MAA、ADB 与通知渠道

> [← 返回文档索引](../README.md)

本文描述服务端与外部系统的集成行为：MAA CLI 子进程与日志流、执行租约与动态任务、MAA profile 与连接解析、ADB 设备探测、MAA 日志文件、活动查询与任务缓存、MaaCore 回调解析与各领域结果服务，以及 Telegram 通知渠道与 Bot 轮询。

这些模块只产出步骤结论与子进程投影；Run 身份与租约的完整语义见[执行身份与生命周期契约](../architecture/execution-lifecycle.md)，HTTP 端点与命令白名单见 [Agent API 使用指南](../api/agent.md)。文档与代码冲突时以代码为准。

## MAA CLI 子进程与实时日志

MAA CLI 可执行文件路径在模块导入时按 `MAA_CLI_PATH` 解析一次：Docker 缺省 `/usr/local/bin/maa`，本地缺省 `maa`（`apps/server/src/config/connectionDefaults.ts:18-23`、`apps/server/src/config/runtimeConfig.ts:271-276`）。

- 资源热更新经 `maa hot-update` 原生执行。Git 使用官方 HTTPS 仓库，MirrorChyan 使用单独的镜像配置。`maa install`/`maa update` 本身已同步资源。Web UI 的「配置 → 资源」通过维护路由读写下文所述的资源源配置。
- 资源状态探测与版本、更新结果共用同一候选目录解析：按 `cli.toml` 的资源源定位生效基础资源——Git 源读 `maa dir hot-update` 的 checkout，MirrorChyan 源读数据目录 `MirrorChyan/MaaResource` 下 `current.json` 指向的代快照（非法指针回退旧布局根）；连同 MaaCore 附带资源（`maa dir resource`）一起按 `last_updated` 取最新，与 MaaCore 的加载顺序一致。热更新补丁覆盖层只含 tasks 补丁文件、没有版本信息，不进入候选。目录查找失败不会被当成目录不存在静默降级；资源源配置不可读时改为同时探测两种来源，避免配置损坏放大成资源状态不可用。
- 资源消费者（干员目录、养成材料表、物品图标与头像、作业关卡目录与预设编队任务）共用同一份候选目录清单与按文件解析：自后向前取第一个存在该文件的资源层，与 MaaCore「后加载者覆盖同名文件」一致，更新层缺文件时回落基础资源；显式 `MAA_RESOURCE_DIR` 独占生效并跳过 CLI 解析。候选目录清单缓存至资源同步或 Core 更新成功时失效，CLI 解析失败不缓存失败，当次回退到进程内可解析的基础资源根。物品索引/物品表缓存按文件 mtime/size 签名复用，文件更新后自动重读。
- Git 同步启动前读取 maa-cli 实际选用的配置，优先级为 `cli.json`、`cli.yaml`、`cli.yml`、`cli.toml`。检查已有资源 checkout 的 `origin`，以及系统 Git 和 libgit2 可读取的 Git URL 重写规则。遇到旧仓库地址、SSH 设置或会改变官方目标的规则时，错误会指出需要人工修正的位置，现有资源保留。Git 同步需要系统 Git 进行离线核验，系统 Git 无法核验时暂停同步。容器首装、Core 定时更新和任务中的 Git 自动更新也经过同一检查。MirrorChyan 独立使用其镜像配置。
- `maaProcessService` 是唯一持有可写子进程状态 `taskStatus` 与实时日志缓冲的模块（`apps/server/src/services/maaProcessService.ts:371-380`）。对外投影 `getTaskStatus` 只回答"是否有受管子进程、任务名与停止请求"，不能当作流程或 Run 终态（`apps/server/src/services/maaProcessService.ts:383-393`）。
- 命令按三种形态执行：
  - 带任务名且不等待完成时用 `spawn` 后台执行：非 Windows 加 `detached`，stdio 为 `ignore/pipe/pipe`，spawn 后立即返回"任务已在后台启动"（`apps/server/src/services/maaProcessService.ts:800-813,856-862`）。
  - 带任务名且等待完成时同样 `spawn`，但等待 `close` 后才 resolve 或 reject，失败错误携带 stdout/stderr、退出码、信号与诊断信息（`apps/server/src/services/maaProcessService.ts:898-997`）。
  - 无任务名的命令用 `execFile` 同步执行，缺省 15 秒超时并 SIGKILL；Core 安装/更新等维护命令经 `managedTaskName` 端口传入受管任务名，子进程同样登记进 `taskStatus`，停止请求与关闭流程按同一任务进程路径识别并终止它，端口忽略 `timeout` 选项时在退出宽限内兜底 SIGKILL（`apps/server/src/services/maaProcessService.ts:248,152-163,999-1080`）。
  - `execFile` 的超时包装在超时裁决后先等待底层子进程实际退出（默认端口由 `execFile` 按 `killSignal` 终止，毫秒级结算；宽限上限 `EXEC_FILE_TIMEOUT_EXIT_GRACE_MS`）再交还超时错误：维护命令的租约与任务状态释放不早于子进程终止（`apps/server/src/services/maaProcessService.ts:279-316`）。
- 两种 spawn 路径共用 UTF-8 按行采集器，跨 chunk 重建字符与回调，保留行内空白和空行，关闭或错误时冲刷末尾无换行内容且只结算一次。stderr 按完整行中的 `ERROR` / `WARN` 提升级别；单行超过 64 KB 时省略内容并写明确的截断标记，避免无换行输出无限积压或截掉凭据前缀后泄漏尾部。
- 实时日志条目经脱敏后写入，并携带执行上下文的 `runId`/`operationId`——归属来自执行上下文而不是发起请求，请求返回后仍在运行的子进程输出继续携带同一标识（`apps/server/src/services/maaProcessService.ts:422-436`）。
- 实时条目同时携带进程实例身份和单调递增序号组成的 `id`、数值 `sequence`；同一记录在轮询快照中保持身份，清空和缓冲淘汰不重置序号，服务重启生成新实例身份。`logs/recent` 保留数组响应与最近窗口语义，不提供游标、按 Run 回读或持久归档。
- 实时缓冲的内存上限由 `LA_PLUMA_MAX_REALTIME_LOGS` 控制，缺省 5000，非法环境变量回落默认值（`apps/server/src/services/maaProcessService.ts:41-52`）；对外单次返回行数上限为 `MAX_REALTIME_LOG_LINES` 500（`apps/server/src/services/maaProcessService.ts:36,397-407`）。
- 后台执行可能持续很久：命令结果的捕获输出只保留最后 256 KB，裁剪从有效 UTF-8 字符边界开始。stdout/stderr 逐行写入实时日志；maa-cli 在任务结束时打印的 `Summary` 报告块（标题、分隔线与任务明细）在采集器中合并成一条实时日志，任务结束时不再重复写入整段聚合输出。被捕获淘汰的旧字节不会重新写入日志，避免失去凭据前缀。
- stderr 会匹配稳定的诊断码并写入日志：未知掉落、企鹅物流/一图流汇报失败、ADB 连接失败、账号切换失败、游戏启动失败（`apps/server/src/services/maaProcessService.ts:466-517`）。
- `stopCurrentTask` 先按进程组发 SIGTERM（非 Windows；ESRCH 回落到子进程信号），缺省 3000ms 未退出升级 SIGKILL；重复停止只返回等待中，不重复发送信号（`apps/server/src/services/maaProcessService.ts:1082-1118`）。
- 退出语义：只有 `stopRequested` 置位的退出算 `stopped`；外部信号（OOM、SIGSEGV、被其他进程 kill）属于失败，保留退出码与信号信息（`apps/server/src/services/maaProcessService.ts:632-669`）。
- 生命周期回调 `onBeforeStart`/`onStarted`/`onSettled` 可注入；`onSettled` 只在子进程真实退出或启动失败时运行，后台 HTTP 返回不触发（`apps/server/src/services/maaProcessService.ts:215-229`）。spawn、execFile、停止信号与强制终止计时器都是可注入端口（`apps/server/src/services/maaProcessService.ts:152-163,351-369`）。
- Core/CLI/资源更新作为 Run 执行：Core 与资源更新经 `execMaaCommand` 的 `managedTaskName` 登记受管子进程；CLI 更新（`maa self update` 或 `brew`/`winget`）经 `runCliUpdater` 以带任务名的 spawn 同步执行，同样写入 `taskStatus`。三种更新的停止与关闭都走 `stopCurrentTask` 的同一任务进程路径（`apps/server/src/services/updateExecutionService.ts`、`apps/server/src/services/cliUpdaterService.ts`）。

## 执行租约与命令构建

- `maaExecutionService` 维护固定的设备变更命令集合，`requiresMaaExecutionLease` 据此决定是否先取得 `executionCoordinatorService` 的执行租约（`apps/server/src/services/maaExecutionService.ts:33-37,117-119`）。
- `execMaaCommand` 在取得租约后先运行 `onBeforeStart` 门禁再 spawn；后台执行的租约在子进程实际退出（`onSettled`）后释放，HTTP 返回"已启动"响应不等于执行完成、也不释放租约（`apps/server/src/services/maaExecutionService.ts:176-228`）。非设备变更命令直接进入子进程模块，不申请租约（`apps/server/src/services/maaExecutionService.ts:186-188`）。
- 动态任务 `execDynamicTask` 在 MAA 配置目录的 `tasks/` 下为每次执行创建独立临时目录后以 `run` 执行：目录名由固定前缀、净化为字母数字的任务名与随机 nonce 组成，目录内写 `task.toml` 与记录持有进程 PID/开始时间的 `owner.json`；顶层 `client_type` 依次取运行时显式覆盖、任务 `params.client_type` 与连接 profile（`apps/server/src/services/maaExecutionService.ts`），供 maa-cli 加载对应服务区资源并设置 MaaCore 客户端类型；`StartUp`/`Fight`/`CloseDown` 的 variant 若声明了与顶层不同的 `client_type`，或任务未声明顶层 `client_type` 而只在 variant 里声明，会在写入任务文件前返回 400，避免 maa-cli 用顶层值静默覆盖；`[[tasks]]` 与 `[tasks.params]` 表由配置对象生成，字符串形式的数组参数会尝试 JSON 解析；命令行固定追加 `--batch`，任务文件中的输入参数按默认值处理，不会等待交互提示（`apps/server/src/services/maaExecutionService.ts:479-760`）。
- 动态任务目录与租约在失败和完成时都清理释放；进程启动时 `cleanupStaleDynamicTaskDirectories` 扫描同一 `tasks/` 根目录，只删除“持有 PID 已不存活且 `owner.json` 已超过 24 小时”的固定前缀目录，缺失或损坏的归属标记、仍存活的 PID、未过期目录与其他目录一律保留；`MAA_EXECUTION_BUSY` 与 `stopped` 错误原样抛出，其余错误重建字段后抛出（`apps/server/src/services/maaExecutionService.ts:320-359`）。
- `getMaaVersion` 执行 `maa version` 并解析输出中的 `maa-cli` 与 `MaaCore` 版本行（`apps/server/src/services/maaExecutionService.ts:233-255`）。

## profile 与连接配置

- MAA 配置目录由 `maa dir config` 解析并按进程缓存：并发调用共享同一次查询，失败在 30 秒冷却期内复用同一错误，避免 CLI 故障期间反复 spawn（`apps/server/src/services/maaConfigService.ts:46-65`）。
- profile 名必须匹配 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`；配置路径经 `resolve` 后校验未越出 `profiles/` 目录，拒绝路径穿越（`apps/server/src/services/maaConfigService.ts:67-83`）。
- 读取 profile 时返回 `{ connection, instance_options }`：`connection` 并入 `[behavior]` 的 `auto_reconnect`，旧版误写在 `[connection].auto_reconnect` 的值只在 `[behavior].auto_reconnect` 缺失时兼容读取；`preset` 与 `touch_mode` 的别名和大小写归一为 maa-cli 规范名（`PlayTools`→`PlayCover`、`maatouch`→`MaaTouch`）。文件不存在或读取失败时返回环境默认连接与空实例选项（`apps/server/src/services/maaConfigService.ts`）。
- 保存配置走 `updateTextFile` 的读改写排队单元与文本原子替换：同一 profile 的读取、合并与写入串行完成，解析或写入失败时不写回、已有配置保持原样；`connection` 与 `instance_options` 两个 section 各自合并，`auto_reconnect` 写入 `[behavior]`，旧版 `[connection].auto_reconnect` 在保存时迁移过去，其余未知字段原样保留。写入前校验受支持的 `preset` 与 `touch_mode`；非法值返回 400 `AGENT_CONFIG_PROFILE_INVALID` 且不落盘（`apps/server/src/services/maaConfigService.ts`）。
- `resourceSourceService` 读写 `cli.toml` 的 `[resource]` 与 `[resource.source]`，保存时将旧版 `backend` 和 `[resource.remote]` 布局转为现行布局。保存会保留其他 section、非活动来源与未知键。已有的非官方 URL 或 SSH 设置仍需在本机配置中人工纠正。`cliConfigService` 统一协调更新渠道与资源源的读改写，按文件路径排队并原子替换文件。设置端点及可写字段见 [Agent API](../api/agent.md)。
- `connectionService.resolveConnection` 是执行、预览、定时与维护入口共用的连接解析：profile 值按 `snake_case` 优先、`camelCase` 兼容，只有非空字符串生效，其余回落连接默认值；profile 名不合法抛 400 `AGENT_VALIDATION_PROFILE_ID_INVALID`（`apps/server/src/services/connectionService.ts:73-96`）。
- `resolveConnectionInput` 只在调用方声明 `allowOverrides` 时应用请求级显式覆盖；空白或缺失的覆盖值保留 profile 值（`apps/server/src/services/connectionService.ts:102-117`）。

## ADB 探测、连接测试与截图

`maaDeviceService` 只读设备事实，不持有任务状态、执行租约或 Run 终态（`apps/server/src/services/maaDeviceService.ts:10-19`）。

- ADB 路径与地址在进入子进程前统一校验：路径拒绝 shell 元字符（Windows 绝对路径单独放行），地址限 `host:port` 或 `emulator-<serial>` 形态（`apps/server/src/services/maaDeviceService.ts:127-150`）。
- `discoverAdbDevices` 合并三类来源：
  - 当前 ADB 的 `adb devices -l`（`apps/server/src/services/maaDeviceService.ts:384-392`）。
  - Windows 上运行中模拟器进程旁的内置 ADB：按进程名匹配 BlueStacks、LDPlayer、夜神、MuMu、逍遥，并在进程目录及其上级目录检查内置 adb 可执行文件（`apps/server/src/services/maaDeviceService.ts:244-309`）。
  - 五个常见本机模拟器端口的 TCP 探测候选；候选状态为 `candidate`，不会被自动连接（`apps/server/src/services/maaDeviceService.ts:25-31,210-227,397-409`）。
- 设备按地址合并，同名 serial 优先采用当前配置 ADB 的结果（`apps/server/src/services/maaDeviceService.ts:343-354`）。
- `testAdbConnection` 依次检查 `adb version` 与设备列表状态：`device` 直接成功，`unauthorized`/`offline` 返回对应提示；否则尝试 `connect`，等待 1 秒后复查状态（`apps/server/src/services/maaDeviceService.ts:466-548`）。
- `getGameClientState` 用 `dumpsys window` 解析前台包名（优先 `mCurrentFocus`，回落 `mFocusedApp`），与客户端类型对应的期望包名比对（`apps/server/src/services/maaDeviceService.ts:39-46,435-461`）。
- `captureScreen` 分三步执行并按步骤设置超时与 SIGKILL：检查设备 3 秒、按需连接 5 秒、`exec-out screencap -p` 读取屏幕 8 秒；超时错误标注失败步骤，图像以 base64 与采集时间返回（`apps/server/src/services/maaDeviceService.ts:553-614`）。

## 日志文件边界与检查点

- MAA 日志目录由 `maa dir log` 解析并按进程缓存，失败同样有 30 秒冷却（`apps/server/src/services/maaLogFileService.ts:105-128`）。文件列表递归收集目录内 `.log` 文件并按修改时间倒序（`apps/server/src/services/maaLogFileService.ts:130-154,212-224`）。
- `readLogFile` 先对日志目录与请求路径取 `realpath`，再按目录边界判定与扩展名检查：只允许日志目录内的 `.log` 文件，目录外符号链接与悬空目标都被拒绝（`apps/server/src/services/maaLogFileService.ts:268-278,337-349`）。
- 日志内容从文件尾部按 64 KB 分块读取，单次最多 2 MB；窗口起始于行中间时丢弃首行残片。`totalLines` 按 split 语义分块统计换行数；行数上限 `MAX_LOG_FILE_LINES` 5000（`apps/server/src/services/maaLogFileService.ts:24,27,284-329,337-381`）。
- `cleanupLogs` 按修改时间从新到旧累加，把超出保留上限的文件删除；上限限定 1–1024 MB（`apps/server/src/services/maaLogFileService.ts:229-262`）。
- `createMaaLogCheckpoint` 在执行前记录 `asst.log` 的路径、字节数、文件身份（`dev/ino`）和检查点边界前最多 256 字节的 SHA-256 摘要。`readMaaLogIncrement` 在文件身份与内容边界可验证时读取检查点之后的新增字节（`apps/server/src/services/maaLogFileService.ts`）。
- MaaCore 将 `asst.log` 改名为 `asst.bak.log` 后，增量读取先核对备份的文件身份。检查点偏移大于零时还要求边界摘要匹配。核验通过后，按顺序读取备份从检查点偏移到文件末尾的内容和新 `asst.log` 从头开始的内容。两段共用 `maxBytes` 上限，默认取最后 2 MiB。备份缺失或核验失败时返回空文本。
- `ok` 表示从原文件完整读取新增字节。文件原地变小、超出读取上限或短读时返回 `truncated`。文件被替换或原地重写时返回 `rotated`，从备份恢复的两段内容均在上限内完整读取时也保留此状态。检查点缺失或文件读取失败时返回 `unreadable`。轮转或截断后仍可采信实际读到的回调。依赖完整日志来判断回调是否缺失或计算整次执行统计时，只接受 `ok`，也可根据完整 CLI 摘要或任务内累计回调补充可确认的字段。
- 调试截图列表从 MAA 状态目录的 `debug/` 读取图片文件；响应只暴露文件名，不返回服务器绝对路径（`apps/server/src/services/maaLogFileService.ts:386-424`）。

## 活动查询与本地任务缓存

- `maaActivityService` 产出带状态的快照：`active`/`none` 是来源给出的肯定答案，`stale` 是全部来源失败但保留了上次成功数据，`unavailable` 是既无可确认结果也无旧数据（`apps/server/src/services/maaActivityService.ts:41-42`）。
- 读取顺序为内存缓存 → 持久化 `activity-cache` 用户配置 → 短负缓存 → `maa activity` → 备用数据源；同一 `clientType` 的并发调用共享同一次在途查询（`apps/server/src/services/maaActivityService.ts:564-626`）。正缓存 TTL 10 分钟、负缓存 60 秒（`apps/server/src/services/maaActivityService.ts:30,36`）。
- 解析不出活动代号的结果只进短负缓存，不写正缓存，避免每次轮询重复启动 CLI（`apps/server/src/services/maaActivityService.ts:653-655,740-749`）。
- CLI 空输出不能单独证明"没有活动"：还需 MAA 活动表 `StageActivityV2.json` 存在且在 24 小时内与远端确认过——确认时间取 ETag 旁注文件 mtime 与内容 mtime 的较大者（`apps/server/src/services/maaActivityService.ts:82-92,281-291,660-683`）。
- 活动缓存持久化经 `configStorageService` 的 `activity-cache` 受控类型，读改写合并其他服务区条目；保存失败只告警，不否决本次读取结果（`apps/server/src/services/maaActivityService.ts:752-775`）。
- 资源收集全开放窗口从活动表 `resourceCollection` 节点解析（服务区当地时刻减 `TimeZone` 小时得 UTC）；成功结果（包括"表里没有窗口"）缓存 60 秒，读取失败只退避 5 秒，窗口不可读时按周表判定关卡开放（`apps/server/src/services/maaActivityService.ts:326-468`）。
- `replaceActivityCode` 把 `hd-数字` 关卡代号替换为当前活动代号；取不到代号时保持原值（`apps/server/src/services/maaActivityService.ts:780-802`）。
- `maaTaskCacheService.prepareMaaTaskCache` 在执行本地资源命令前，把共享缓存中的热更新文件快照进 `mkdtemp` 临时目录并写入私有 ETag 旁注文件，使 maa-cli 强制的启动更新保持本地而不标记真实缓存为已远端确认；`MAA_CACHE_DIR` 环境变量优先于 `maa dir cache` 查询（`apps/server/src/services/maaTaskCacheService.ts:17-19,50-69,106-134`）。
- 该任务缓存由 `execMaaCommandUnlocked` 挂接：后台任务在子进程退出后清理，其余命令在返回前清理（`apps/server/src/services/maaProcessService.ts:730-775`）。

## 回调解析与领域结果服务

- `maaCallbackService.parseMaaCallbackEvents` 只保留 `Assistant::append_callback | ` 标记行中 `taskchain` 与目标值一致的 JSON 对象载荷；断行、非法 JSON、非对象载荷与其他 taskchain 一律跳过，因此增量日志从半行开始也不会产生错误事件（`apps/server/src/services/maaCallbackService.ts:12,34-69`）。
- `details`、`what`、`class`、子任务名与字符串列表都由读取函数逐字段收窄；缺字段或类型不符按"未观察到"处理，不会中断解析（`apps/server/src/services/maaCallbackService.ts:72-106`）。
- 六个结果服务都只描述单次步骤的检查结论（`success`/`failed`/`skipped`），不能当作整个 Run 的终态；`skipped`、`failed` 与 `success` 不可混同。
- award 不依赖结构化回调：按日志中 `"first":["<BeginTask>"]` 分段和分段内 `"task":"..."` 事件判断六个领取项是否已领取；未启用任何项目返回单项 `skipped`，分段缺失时回退为"流程已完成"（`apps/server/src/services/awardResultService.ts:84-153`）。
- recruit 解析 `Recruit` taskchain：统计开始/收取/加急/刷新次数与最高星级，`TaskChainError` 为 `failed`，保留标签或许可不足为 `skipped`；无事件时回退"流程已完成"。任务参数中的 `force_refresh` 与 `level3_recruitment_permit_reserve` 由 MaaCore 直接消费，结果解析不重算它们（`apps/server/src/services/recruitResultService.ts:60-174`）。
- infrast 解析 `Infrast` taskchain：按 `class` 字段映射十一类设施（含回收站与副手换人），识别收产物、换班、无人机、线索收送与交流、专精训练；未选择设施返回 `skipped`（`apps/server/src/services/infrastResultService.ts:53-80,200-270`）。
- mall 解析 `Mall` taskchain：好友访问、信用购物、信用作战三项严格 `false` 才整体跳过；购买计数只统计 `exec_times` 缺失或为 1 的 `CreditShop-Bought` 事件（`apps/server/src/services/mallResultService.ts:40-139`）。
- fight 基于任务总结、命令输出与错误文本：理智耗尽、关卡未开放、剿灭奖励已领完归为 `skipped`，其余错误为 `failed`；理智判定同时检查输出短语与 Summary 段（`apps/server/src/services/fightResultService.ts:56-178`）。
- 游戏任务解析 `OperProgress` 与 `SwitchTheme` taskchain：培养按 `OperProgressDetail` 与 `OperProgressSummary` 汇总成功、失败与跳过，并按配置计划反推没有回调的未执行专精目标为 `deferredMastery`（Core 每轮最多启动一项专精训练；训练室占用只对该目标发一条跳过回调，后续专精目标不再发回调）；主题按 `SwitchThemeByName*` 子任务与 `SwitchThemeNotFound`、`SwitchThemeSkipped` 判定；缺少有效回调时保持 `observed: false`（`apps/server/src/services/gameTaskResultService.ts:79-301`）。
- 肉鸽/生息演算的 `run_task` 先取得设备执行租约、再创建 `asst.log` 检查点，并在释放租约之前读取本次新增日志构建结果摘要（`apps/server/src/controllers/agentExecutionController.ts`、`apps/server/src/services/roguelikeResultService.ts`）：`Roguelike` taskchain 的 `RoguelikeSettlement`（楼层、步数、得分、战斗/招募/收藏品等）、`RoguelikeInvestment*`、`RoguelikeEvent*`、`RoguelikeCombatEnd`、通宝替换与黑流策略回调都保留结构，`TaskChainCompleted`/`TaskChainError`/`TaskChainStopped` 决定 `success`/`failed`/`stopped`；没有观察到任务链终态时为 `incomplete`，不能当成成功。`Reclamation` 没有专用回调，摘要只表达任务链终态与主题。`command=run` 且单个 `taskConfig.type` 为 `Roguelike`/`Reclamation` 的动态任务（CLI 无法表达的主题、模式、重启锚点等参数改走该通路）按同样规则建立检查点，摘要的 `command` 按任务类型映射为 `roguelike`/`reclamation`，`theme` 取 `taskConfig.params.theme`；批量 `taskConfigs` 不建立检查点。摘要成功时挂在 `run.result.summary`，失败时挂在 `run.error.details.summary`。同步执行在返回前采集摘要，后台执行在子进程退出后的收尾回调中采集；被设备占用拒绝或未真正启动（没有出现 spawn 生命周期）的执行不建立采集、不产出摘要；日志检查点创建或读取失败只跳过摘要，不影响执行本身。捕获启动时同时注册肉鸽进度跟踪器：运行中按 `asst.log` 增量维护 `mode`、局数、结算、最近 5 局、最近事件与目标局数，通过 `run.progress.roguelike` 暴露；观察到 `BlackFlow*` 回调时同一进度带 `blackflow`（楼层、当前节点、行动力、最近路由与节点完成、里程碑、策略结果），普通集成战略与生息演算为 `null`。结束时先收尾跟踪器再把最终快照并入 `summary.progress`，`summary.observed` 合并 `progress.observed`，同步、后台、停止、失败与服务关闭路径都会释放跟踪器。

### 作业集逐项进度与文件加载事件

作业集执行期间，服务端每 2 秒增量读取 `asst.log`，把 `CopilotListLoadTaskFileSuccess` 中的 `file_name` 映射回条目并推进逐项生命周期（`apps/server/src/services/copilotPlanService.ts`）。出现第 k 份计划文件的加载时，此前尚未结算的条目结算为 `success`，该文件所属条目置为 `running`。现有流程按计划文件路径映射，原生委托按文件名中的 copilot id 映射（见下节）；两条路径共用同一套观察、结算与进度汇总。

载荷由共享回调解析器按 JSON 解析，`details.file_name` 是 JSON 转义后的原生路径（Windows 为 `C:\\...`），必须解码后再比较；计划文件路径由 `path.join` 生成，两者在分隔符、盘符与目录名大小写上可能不同，匹配前统一分隔符并在 Windows 上忽略大小写。

这条推断依赖 MaaCore 的 `copilot_list` 执行顺序，依据是上游实现而不是集成协议文本：

- `MultiCopilotTaskPlugin::_run` 在当前条目 `Copilot.load` 成功后、跳转关卡与战斗之前发回调，一轮只处理一份文件；
- 每轮末尾的三星确认（`Copilot@WaitUntilEndOfAction`）失败会让 `PackageTask` 中止整条任务链，后续文件不再加载。

因此下一份文件开始加载时，上一轮的全部完成检查已经通过。观察只是执行中的投影：组结束仍按命令退出码与最后加载的文件重新结算；读取窗口缺失或路径无法匹配时只会让更多条目留在未确认状态（失败记为 `failed`，停止记为 `stopped` 或 `pending`），不会把未确认条目算作成功。

该前提随 MaaCore 版本变化。单元测试与假 CLI 只回放事件顺序，不能证明真实回调时序；合入相关改动或升级 MaaCore 后，应用真实设备执行并核对加载事件与最终完成事件的先后：

| 场景 | 核对内容 |
| --- | --- |
| 多关连续作业 | 每关的加载事件出现在上一关完成之后，逐项状态与关卡顺序一致，不提前显示成功 |
| 中途失败（未三星或任务失败） | 失败条目之后不再出现新的加载事件；已通过条目保留 `success`，其余为 `failed` |
| 主动终止 | 终止后不再出现新的加载事件；已开始的条目按 `stopped` 处理，未开始的保持 `pending` |
| 重复作业（循环次数 > 1） | 同一作业的多次重复只在后续条目加载或组结束时统一结算一次，不重复计数 |

### 原生 Copilot 委托与回退

`executeCopilotEntries` 在取得设备租约后先判定整组条目能否交给原生 `maa copilot` 预设命令（`apps/server/src/services/copilotPlanService.ts` 的 `evaluateCopilotNativeDelegation`）。原生命令按 uri 顺序生成一份 `copilot_list`：每条目一份计划文件、统一 `--raid`、多条目时强制编队、列表模式忽略 `loop_times`，并且没有 `user_additional`、`nav_name_override` 与逐条 `is_raid` 入口。因此只在下列条件同时成立时委托，其余一律走现有流程：

| 条件 | 原因 |
| --- | --- |
| 条目数至少为 2 | 单条目会让原生命令改用 `filename` + `loop_times` 的单文件模式，不再下发 `stage_name`，也无法表达突袭 |
| 全部非预设编队 | 预设编队会关闭自动编队并写入 `LaPlumaPresetBattleConfirm`，原生命令没有对应入口 |
| `mode` 全组一致 | `--raid` 只有整组一个值，`both` 产生的 normal/raid 交替条目无法逐条表达 |
| 自动编队开启（`formationMode !== 'off'`） | 多条目时原生命令强制 `formation = true` |
| `loopTimes` 为 1 | 列表模式丢弃 `loop_times`，现有流程用重复计划文件表达循环 |
| 无 `user_additional` | 原生命令没有该参数 |
| 编队序号与助战参数为可表示的整数 | 0 值与缺省等价，非整数无法映射到命令行 |
| copilot id 不重复 | 原生缓存文件按 `<id>.json` 命名，重复 id 无法区分条目 |
| 每个条目的 `displayStage` 等于本地 `Arknights-Tile-Pos` 中该关卡的 `code` | 原生命令用这个代号作 `stage_name`，MaaCore 在缺省 `nav_name_override` 时同样按它导航；现有流程把 `displayStage` 作为 `nav_name_override` 下发 |
| 本机 overlay 不改变用户已选择的参数 | 原生命令会叠加 `<config>/overlays/copilot.<ext>` 的任务默认值，用户未显式开启的布尔开关、为 0 的编号与空字符串都可能被 overlay 重新打开，命令行没有反向覆盖入口 |

overlay 与命令行参数的优先级依据 maa-cli 仓库源码：预设命令在 `crates/maa-cli/src/run/preset/mod.rs` 按 `json`、`yaml`、`yml`、`toml` 的顺序取第一个存在的 overlay 文件作为任务默认值；`crates/maa-cli/src/run/preset/copilot.rs` 随后把用户布尔开关与默认值取或（`use_sanity_potion`、`add_trust`、`ignore_requirements`、`formation`），数字与字符串参数只在用户显式给出时才覆盖，预设会重写的 `copilot_list`、`formation` 等键之外的内容（含 `filename`）原样保留。`maa run <task file>` 直接解析任务文件、不读取 overlay，这是现有流程不受影响的原因。委托资格读取同一份生效 overlay：overlay 里与用户选项冲突且 CLI 无法显式改回的值（关闭的开关被设为 `true`、用户为 0/空而 overlay 非 0/非空、未知参数）判为 `overlay-conflict`；YAML 格式无法在服务端解析、overlay 不可读或格式损坏时判为 `overlay-unreadable`，两者都沿现有动态执行路径。

原生失败后，仅在增量日志状态为 `ok`、未出现 `CopilotListLoadTaskFileSuccess` 且没有条目已结算为成功时回退到现有流程。计划文件加载发生在跳转关卡与开始战斗之前，这项检查避免重复消耗理智或重复结算关卡。轮转恢复的回调可用于确认实际发生的加载。回退仍要求状态为 `ok`，因为跨轮转时可能缺失加载回调。停止请求按停止结算（`apps/server/src/services/copilotPlanService.ts`）。

原生命令把下载的作业文件写在 maa-cli 共享缓存 `<cache>/copilot/<id>.json`，缓存命中时不会校验远端内容；现有流程则每次执行都重新获取计划内容。原生委托在启动命令前删除本次条目的对应缓存文件（`invalidateCachedCopilotFiles`），让命令重新下载，保证原生路径与计划构建使用同一份作业内容；其它 copilot 缓存文件不受影响。删除失败时按原生失败处理，并按上述条件判断是否回退。

委托结果写在 `CopilotEntriesOutcome.delegation` 并透传到作业集 `summary.delegation`。`outcome` 显式给出最终走向：`native-succeeded`、`native-failed`、`native-stopped` 表示原生路径直接收尾；`fallback-succeeded`、`fallback-failed`、`fallback-stopped` 表示原生失败后已回退到现有流程，并按现有流程的结果收尾。`attempted` 恒为 `true`，`fallback` 为真表示发生过回退，`nativeError` 保留原生失败信息（仅回退时出现）；这些兼容字段保留给旧客户端，判断走向以 `outcome` 为准。回退成功后整体仍是成功；回退后现有流程也失败时 `outcome` 为 `fallback-failed`，与原生直接失败的 `native-failed` 区分。未委托的原因只在调试日志中记录。

原生委托处于灰度期，**默认关闭**：未设置 `LA_PLUMA_COPILOT_NATIVE_DELEGATION`、设为空值、显式关闭值（`0`、`false`、`off`、`no`、`disabled`）或任何无法识别的取值时，满足上表全部条件的作业集也走现有流程；只有显式开启值 `1`、`true`、`on`、`yes`、`enable`、`enabled`（大小写不敏感，忽略首尾空白）才交给原生 `maa copilot`。开关只决定是否尝试委托，等价条件、回退判据、缓存失效与 `delegation` 结果字段不随开关变化；灰度结束后再单独调整默认值。

进程内首次判定委托时（首次执行含待执行条目的作业集，包括不满足等价条件的作业集）输出一条一次性的 `INFO` 日志，服务名为 `CopilotPlan`：启用时为 `原生 Copilot 委托已启用：满足等价条件的作业集交给 maa copilot`，未启用时为 `原生 Copilot 委托未启用（<原因>）：作业集走现有流程`，`data` 带环境变量名与原始取值，原因区分未设置/空值、显式关闭和取值无法识别。在服务进程标准输出（本地终端或容器日志，如 `docker logs`）查看该行即可确认实例的实际生效状态。

回滚：停止服务后删除该变量、置空或改为任一关闭值，重启即可整体回到现有流程；不需要回退代码或清理数据，已写入的作业集进度与掉落记录继续有效。灰度期间出现下列任一现象时先回滚再排查：游戏内进入的关卡或突袭模式与计划不符、已完成条目被重复执行、编队/助战参数未生效、进度把未通关条目显示为成功、手动模式出现原生委托。

上线前按下面的真机验证清单在真实 MAA Core 与设备上执行；先确认服务日志中的委托状态为已启用，再让原生委托与现有流程使用同一作业集对照，逐项核对：

| 核对点 | 操作 | 通过标准 |
| --- | --- | --- |
| 选段 | 多条目（至少 2 条）作业集只勾选部分条目执行 | 原生命令只包含待执行选中条目的 URI 且顺序与计划一致；游戏只进入选中关卡，导航关卡名与计划 `displayStage` 相同，未选条目不执行 |
| 跳过已完成 | 先完成首条目，再对其余条目发起执行 | 原生命令不包含已完成条目的 URI；剩余条目按顺序执行，进度与掉落不重复计数 |
| 编队 | 开启自动编队并设置编队序号、助战参数后执行 | 游戏内编队与 `--formation-index`、`--support-unit-*` 一致；`--ignore-requirements`、`--use-sanity-potion`、`--add-trust` 的对应行为生效；含预设编队的作业集不出现原生命令 |
| 进度 | 执行中同时观察 Run 进度与逐条目状态 | 每个条目在其计划文件加载后转执行中，并在下一条目开始前结算；未三星或失败条目不显示成功；终止后未开始条目保持 `pending` |
| 手动交接 | 手动逐关模式执行首关，再点「开始下一关」 | 手动模式始终走现有流程：服务日志不出现 `maa copilot` 命令、`summary.delegation` 不出现；Run 在条目间转 `waiting`，继续动作只执行下一关 |

## 通知发送与 Telegram Bot 轮询

- `createNotificationService` 创建持有配置、渠道注册表与出站端口的实例；渠道注册表当前只有 `telegram`，微信、钉钉、邮件、Bark 为预留（`apps/server/src/services/notificationService.ts:362-388,602-614,734-753`）。
- `sendNotification` 只发给启用渠道；单渠道失败记入 `errors`，不阻断其他渠道。总开关关闭时直接返回"通知功能未启用"（`apps/server/src/services/notificationService.ts:645-683`）。
- `shouldCaptureScreenshot` 在存在配置完备且支持图片的启用渠道时为 true（`apps/server/src/services/notificationService.ts:631-640,748,772-774`）。
- Telegram 渠道文本消息用 `sendMessage` 加 Markdown；图片消息用原生 FormData/Blob 构造 multipart `sendPhoto`。图片超过 10MB 或三次重试（间隔 2 秒、4 秒）后仍失败时回退纯文本消息（`apps/server/src/services/notificationService.ts:439-548`）。
- 渠道凭据（botToken）只存在于运行时配置，不进入发送结果 DTO 或日志；`getConfig` 返回完整配置且与运行时配置不共享引用（`apps/server/src/services/notificationService.ts:7-11,625-629`）。
- `testChannel` 支持仅用于本次测试的配置覆盖，走同一解析边界，不写回运行时配置（`apps/server/src/services/notificationService.ts:707-727`）。
- `buildTaskCompletionMessage` 按 actions/reports 中的失败与跳过条目归一化通知级别与标题（success/warning/info），并组装执行结果、掉落汇报、任务总结、跳过与失败任务段落（`apps/server/src/services/notificationService.ts:815-994`）；游戏任务动作在汇总行下追加逐干员的培养结果、原因与本轮未执行的专精目标，专精条目的 `Completed` 按已启动目标专精训练展示。
- Telegram Bot 是独立的命令接收通道，进程级默认实例绑定真实出站端口与 MAA 服务（`apps/server/src/services/telegramBotService.ts:491-506,1664-1671`）。
- 同一实例同一时刻只有一个轮询会话：`init` 先同步停止旧会话再按新配置启动；旧会话的在途请求被中止，迟到更新不再派发命令（`apps/server/src/services/telegramBotService.ts:625-656`）。
- 长轮询停留 30 秒、请求时限 40 秒，`getUpdates` 为 POST 且出站端口不自动重放；无更新间隔 2 秒、出错重试 5 秒；多实例 `Conflict: terminated by other getUpdates` 错误静默降级；offset 在派发更新时推进（`apps/server/src/services/telegramBotService.ts:47-53,698-767`）。
- 会话持有独立 AbortController：长轮询请求、轮询间隔、等待与命令内倒计时绑定同一 signal；`attachLifecycle` 把停止能力注册进运行时关闭流程，同一 lifecycle 只注册一次（`apps/server/src/services/telegramBotService.ts:77-85,679-693`）。
- 授权优先 `allowedUserIds`，为空时按单 `chatId` 兼容比较 chat 或 user ID；缺少整数 `update_id` 的更新被忽略，非文本消息或缺少 chat/from 的条目只推进 offset（`apps/server/src/services/telegramBotService.ts:306-327,769-775`）。
- 文本按"作业 URI → 关键词 → 带参关键词 → `/命令`"顺序解析为命令领域输入（`apps/server/src/services/telegramBotService.ts:392-483`）。startup、fight、copilot、roguelike 命令先停止当前任务再执行新任务；`/run` 流程直接调用 `executeScheduleNow`，不创建 HTTP Run 包装（`apps/server/src/services/telegramBotService.ts:841-882,1358-1471`）。
- 启动初始化读取持久化 `notification` 配置恢复通知服务，再以其中 `channels.telegram`（叠加当前 profile 的 ADB 路径与地址）启动 Bot；未启用时不启动轮询，生命周期接入失败则放弃本次启动（`apps/server/src/services/runtimeInitializationService.ts:181-196,250-274`）。

## 测试用假 CLI 与临时目录

- 子进程测试不启动真实 CLI：spawn/execFile/停止端口注入同形状的假子进程，覆盖 close/error、退出码、信号与 kill 升级（`apps/server/src/services/maaProcessService.ts:90-101`、`apps/server/src/services/__tests__/maaServicePorts.test.ts:44-55`）。
- 需要真实进程行为的测试在临时目录写入可执行的假 CLI 脚本，并在模块导入前设置 `MAA_CLI_PATH` 等环境变量；导入时读取的环境变量必须在导入前设置（`apps/server/src/services/__tests__/maaConfigDirCache.test.ts:7-32`）。
- MAA 缓存、profile 目录与任务缓存目录用 `mkdtemp` 隔离，用例结束后删除（`apps/server/src/services/__tests__/maaConfigDirCache.test.ts:9,43-45`、`apps/server/src/services/__tests__/maaTaskCacheService.test.ts:10`）。
- 外部依赖整体可注入：活动查询的 runtime（`apps/server/src/services/maaActivityService.ts:94-108`）、日志检查点的 stat/open 端口（`apps/server/src/services/maaLogFileService.ts:72-82`）、通知服务的出站客户端（`apps/server/src/services/notificationService.ts:574-580`）与 Telegram Bot 的全部依赖（`apps/server/src/services/telegramBotService.ts:218-232`），测试不触碰真实网络、设备或 MAA CLI。
- 测试入口、逐文件进程隔离与定向回归命令见[服务端架构与请求契约](README.md#测试入口)。

## 延伸阅读

- [执行身份与生命周期契约](../architecture/execution-lifecycle.md)：Run 身份、租约、停止与持久化语义。
- [Agent API 使用指南](../api/agent.md)：端点、命令白名单与错误码。
- [持久化与运行数据](persistence.md)：MAA profile、日志与运行数据的落盘位置与恢复语义。
