# 设置

> [← 返回前端架构](../README.md) · [文档索引](../../README.md)

本文集中维护本领域的面板、模型与命令约定；通用契约通过链接引用。

- [页面与面板](#页面与面板)
- [配置编辑与保存](#配置编辑与保存)
- [设备连接与系统资源](#设备连接与系统资源)
- [组件更新与自动更新](#组件更新与自动更新)
- [回归与关联](#回归与关联)

## 页面与面板

连接草稿、设备命令、版本/目录读取、组件更新与自动更新的所有者、Query key、wire 与失效语义均未改变；自动保存只新增 UI 触发层（`useAutoSave`），草稿仍由原 owner 持有，不新增第二份 revision、缓存或存储。

### 1. 定位与边界

| 内容 | 唯一归属 | 说明 |
| --- | --- | --- |
| 页面壳与工作区组合 | `pages/settings/ConfigManager.tsx` | 渲染 `app-page` 页面壳与 `app-stack-section`，并组合工作区 |
| 区块布局与目录 | `features/settings/components/SettingsWorkspace.tsx` | 六段区块、右侧目录与工作区网格；不持有配置草稿 |
| 区块顺序与文案 | `features/settings/model/settingsSections.ts` | 六个区块的 id、顺序与名称；不持有存储或滚动状态 |
| 区块标题与锚点 | `features/settings/components/SettingsSection.tsx` | `h2`、`aria-labelledby`、`data-settings-section` 与锚点 id |
| 页内目录 | `features/settings/components/SettingsSectionNav.tsx` | 右侧 sticky 目录；滚动高亮与点击跳转，使用 `aria-current="location"` |
| 滚动定位与兼容事件 | `features/settings/hooks/useSettingsSectionNavigation.ts` | 监听滚动宿主、计算当前区块、跳转与兼容事件；不持有草稿 |
| 外观主题 | `features/settings/components/AppearanceCard.tsx` | 读取 `useTheme()` 的 `themeId`/`resolvedMode`，通过 `setThemeId` 切换主题；选项来自 `THEMES`，不新增主题存储 |
| 表单与开关行 | `features/settings/components/ConfigFieldControls.tsx`、`SwitchSettingRow.tsx` | 单行设置行：标签在左、控件在右；统一 44px 触达高度与提示排版 |
| 配置面板页内反馈 | `features/settings/components/SettingsFeedback.tsx` | 错误用 `Alert`（可带重试 action），成功/警告用 `role="status"` 语义块；不重复全局通知正文；组件更新与自动更新不使用该组件 |
| connection 表单、自动保存与读取反馈 | `features/settings/components/ConnectionConfigPanel.tsx` | Query/草稿适配、自动保存、迟到读取提示 |
| 设备查找与连接测试 | `features/settings/components/DeviceConnectionPanel.tsx` | 命令 owner 订阅、查找弹窗入口与连接测试 toast；设备列表由 `DeviceConnectionDialog` 渲染 |
| resource 资源源表单 | `features/settings/components/ResourceSourcePanel.tsx` | Git / MirrorChyan 来源、自动更新开关与 MirrorChyan CDK；MAA 运行中只读 |
| instance 实例选项表单 | `features/settings/components/InstanceOptionsPanel.tsx` | 触控模式与三项实例开关 |
| 配置编辑卡外壳 | `features/settings/components/ConfigEditorCard.tsx` | 页内错误与失焦冲刷入口，三个配置区块共用 |
| 配置目录 | `features/settings/components/ConfigDirectoryPanel.tsx` | 路径三态、重试与“打开目录” |
| 组件更新卡片容器 | `features/settings/components/SettingsUpdatesPanel.tsx` | `app-stack-card` 内容布局；标题由区块提供 |
| 自动更新策略 | `features/settings/components/AutoUpdateConfigPanel.tsx` | 自动更新草稿、本地回退、防抖自动保存与反馈 |
| 自动保存调度 | `features/settings/hooks/useAutoSave.ts` | 600ms 防抖、失焦/Activity 隐藏/卸载冲刷、执行中锁定；不持有草稿 |
| 版本与组件更新 | `features/settings/components/ComponentUpdatePanel.tsx` | 版本 Query、core/渠道/CLI/资源命令与反馈 |

维护约束：

- 不改变 connection 字段与 wire；保存保持 600ms 防抖自动提交，失焦、Activity 隐藏、卸载与 `pagehide` 立即冲刷。自动更新仍先写 user config 再应用调度。
- 不改变 Query key、失败/重试、失效作用域与展示文案；三个配置 Query 在页面挂载时一起读取。
- 不改变设备发现/连接测试的迟到响应与草稿回填语义；查找弹窗关闭会取消在途查找，页面/Activity 则取消两条链；区块可见性与滚动位置不触发取消。
- 不改变配置面板的字段结构与表单 id；保存保持自动保存，成功静默，失败保留页内 `Alert` 与带重试的 error toast；资源源在 MAA 运行中只读。页内导航使用右侧目录与滚动高亮。页面视觉已按设置页治理调整，视觉基线冻结至后续统一重生成。

### 2. 组合与订阅边界

```
ConfigManager（app-page > app-stack-section > SettingsWorkspace）
└─ SettingsWorkspace（区块布局、滚动导航、设备命令的 Activity 清理）
   ├─ SettingsSection(connection)
   │  └─ ConnectionConfigPanel（connection Query/草稿/保存反馈）
   │     └─ DeviceConnectionPanel（设备命令订阅 + 查找弹窗入口/测试 toast）
   │        └─ DeviceConnectionDialog（查找弹窗、设备列表与选择）
   ├─ SettingsSection(resource)
   │  └─ ResourceSourcePanel（resource Query/草稿/保存反馈）
   ├─ SettingsSection(instance)
   │  └─ InstanceOptionsPanel（instance Query/草稿/保存反馈）
   ├─ SettingsSection(config-directory)
   │  └─ ConfigDirectoryPanel（目录 Query + 打开目录）
   ├─ SettingsSection(appearance)
   │  └─ AppearanceCard（themeId 单选项，来自 THEMES）
   ├─ SettingsSection(updates)
   │  └─ SettingsUpdatesPanel（卡片壳）
   │     ├─ AutoUpdateConfigPanel（自动更新草稿/保存）
   │     └─ ComponentUpdatePanel（版本 Query + 更新命令/反馈）
   └─ SettingsSectionNav（右侧目录，xl 及以上）
```

- **页面无请求。** `ConfigManager` 不导入 API、Query、领域所有者或 localStorage，只组合页面壳与工作区。
- **目录状态只有一份。** `SettingsWorkspace` 是唯一调用 `useSettingsSectionNavigation()` 的位置；当前区块由滚动位置派生，点击目录只滚动并更新高亮。目录项使用 `aria-current="location"`；页面不再使用 tablist/tabpanel、`aria-controls` 或 roving focus。
- **六个区块同时可见。** 三个配置面板始终挂载并渲染，不再有隐藏面板的 `enabled: false` 门控；进入页面即订阅 `settings/maa-config`、`settings/resource-source`、`settings/maa-instance-options`，滚动或目录跳转不重建 Query，也不清空草稿或读取/保存反馈。
- **设备面板常驻，命令不随滚动取消。** `DeviceConnectionPanel` 始终订阅 `DeviceConnectionOwner`；滚动或目录跳转不会卸载面板，owner 继续持有在途命令与已完成结果。查找弹窗关闭会显式取消在途查找；Activity 隐藏或页面真正卸载则由 `useDeviceConnectionActivityCleanup` 取消两条链。
- **更新用例分成两个面板。** `SettingsUpdatesPanel` 只提供卡片壳；`AutoUpdateConfigPanel` 订阅 `AutoUpdateConfigOwner`，`ComponentUpdatePanel` 订阅版本 Query 与 `SettingsUpdateOwner`。自动更新草稿/保存状态不会重渲染组件更新按钮，组件更新/版本状态也不会重渲染自动更新表单。
- **目录 Query 只有一个观察者。** 配置目录卡片是 `settings/config-directory` 的唯一观察者；滚动或目录跳转不产生目录请求，失败后的重试入口仍只在目录卡片。

订阅隔离（渲染边界的验收依据）：

| 状态变化 | 会重渲染 | 不会重渲染 |
| --- | --- | --- |
| connection 草稿编辑 | `ConnectionConfigPanel`、其内的设备面板（adb 路径/地址 props） | 更新卡片内两个面板、`ConfigDirectoryPanel` |
| 设备发现/连接测试状态 | `DeviceConnectionPanel`、`DeviceConnectionDialog` | `ConnectionConfigPanel` 的表单、更新/目录面板 |
| 版本读取/重取 | `ComponentUpdatePanel` | 连接、设备、目录、自动更新面板 |
| 组件更新命令状态 | `ComponentUpdatePanel` | 连接、设备、目录、自动更新面板 |
| 自动更新草稿/保存状态 | `AutoUpdateConfigPanel` | 连接、设备、目录、组件更新面板 |
| 配置目录状态 | `ConfigDirectoryPanel` | 连接、设备、更新卡片内面板、资源源/实例表单 |

`ConfigManager.subscriptions.test.tsx` 用领域 hook 的调用次数作为面板渲染次数的代理，覆盖“设备/更新状态不驱动连接表单”和“草稿编辑不驱动更新/目录面板”。各面板通过 `notify` 发送全局提示，不订阅通知正文，因此更新/设备产生的全局提示也不会重渲染连接表单。

### 3. 区块导航与草稿生命期

| 状态 | 所有者 | 滚动/目录跳转 | Activity 隐藏/恢复 | 真正卸载/刷新 |
| --- | --- | --- | --- | --- |
| 当前区块 | `useSettingsSectionNavigation` | 根据滚动位置更新高亮；配置区块写入兼容键 | Effect 清理后恢复时重新测量 | 从首屏与滚动位置重新计算 |
| connection 草稿/revision | `ConnectionConfigOwner` | 保留 | 保留 | 保留（模块级 owner） |
| connection Query 快照 | `settings/maa-config` Query | 观察者保持 | 观察者注销/恢复 | 缓存按新鲜度重取 |
| 连接自动保存与反馈 | `ConfigDraftOwner` + `ConnectionConfigPanel` 派生反馈 | 保留 | 保留；隐藏时冲刷 | 草稿保留在模块级 owner，反馈清空 |
| 设备列表/测试反馈 | `DeviceConnectionOwner` | 保留 | 保留已完成结果 | 保留（未完成已取消） |
| 目录路径/状态 | `settings/config-directory` Query | 保留（共享缓存） | 观察者注销/恢复 | 按新鲜度重取 |
| 版本 | `settings/version` Query | 保留 | 观察者注销/恢复 | 按新鲜度重取 |
| 自动更新草稿/dirty/反馈 | `AutoUpdateConfigOwner` | 保留 | 保留；初始化标记阻止重读 | 保留；重挂载会重读，本地回退草稿不自动提交 |
| 更新命令状态/反馈 | `SettingsUpdateOwner` | 保留 | 保留；命令继续完成 | 保留 |

- 保存进行中继续滚动或跳转：保存继续在 owner 中执行；下一次编辑或恢复排程会提交最新草稿。
- MAA 运行中资源源表单只读，运行状态来自 `useStatusStore` 的 `isRunStatusBusy` 投影；服务端执行租约仍是最终防线。
- 六个区块同时存在，滚动不会替换编辑器 Card 的 DOM；各自的草稿、Query 快照与保存反馈不随之销毁。
- `Resource`/`Instance` 各自持有草稿与反馈，同时可见时不会互相清空或覆盖。

### 4. 设备命令的取消边界

设备命令的取消仍属于页面/Activity 生命周期，而不是区块可见性或滚动位置：

- `useSettingsDeviceConnection()` 只订阅 owner 并转发动作，不再在自身 Effect cleanup 中取消命令。
- `SettingsWorkspace` 调用 `useDeviceConnectionActivityCleanup()`，在 Activity 隐藏或页面真正卸载时执行 `cancelAll()`。
- 因此滚动或目录跳转不会中断在途查找/测试；设备面板常驻，直接读取 owner 的最新结果，不自动重发。
- 地址输入变更仍只清除旧测试反馈，不取消在途测试。

### 5. 错误反馈的归属

| 反馈 | 渲染位置 | 来源 |
| --- | --- | --- |
| 连接读取失败 | 编辑卡 `CardContent` 内 `Alert` + “重新读取” | `ConnectionConfigPanel` 本地反馈 + Query 初始失败 |
| 连接保存失败 | 编辑卡 `CardContent` 内 `Alert` + “重试保存”；同一结果也发带重试 action 的全局 error toast | `ConfigDraftOwner` 结果 |
| 自动保存成功、`superseded` | 无提示；`superseded` 由后续自动保存补齐 | `ConfigDraftOwner` 结果 |
| 设备查找失败/取消/空结果 | 查找弹窗内展示 | `DeviceConnectionOwner.discovery` |
| 连接测试结果 | 全局 toast（成功/失败） | `DeviceConnectionOwner.test` |
| 目录读取失败与重试 | 目录卡片内 `Alert` + `AlertAction` | `config-directory` Query 状态 |
| 自动更新读取/保存/调度失败 | 仅全局 error toast；保存/调度失败带“重试保存” action | `AutoUpdateConfigOwner` |
| 自动更新非法时间 | 仅 error toast，不发请求 | `useAutoSave` 的 `canSave` 前置拦截 |
| 自动更新保存成功 | 无提示；本地回退 warning 仍走全局 toast | `AutoUpdateConfigOwner` 结果 |
| 组件更新失败与资源重试 | 仅全局 error toast；资源重试作为 toast action | `SettingsUpdateOwner` |
| 组件更新成功 | 仅全局 toast | `SettingsUpdateOwner` 结果 |

配置面板只渲染自己的页内反馈；一个用例的失败不会写入另一个面板的页内状态。组件更新与自动更新失败只写全局 toast，不再渲染页内 `Alert`。自动保存成功不发通知；失败由反馈 hook 发送带重试 action 的 error toast，读取失败仍只提示一次。

### 6. 兼容与维护约束

- Query key、失效作用域、失败保旧、设备命令 wire、更新顺序与自动更新本地键均未变；三个配置 Query 改为页面挂载时一起读取。
- 保持三个配置表单的标签关联、字段 id 与行为契约；DOM 使用 `Card` / `Field` / `Alert` 结构，页内目录滚动定位、草稿保留与保存反馈由下列回归测试覆盖。
- 设备面板常驻；在途命令只在 Activity 隐藏或页面卸载时取消，滚动与目录跳转不卸载面板。

## 配置编辑与保存

配置读取走 `settings/maa-config` Query，草稿与保存由 `features/settings/model/connectionConfig.ts` 的模块级所有者持有。

设备发现、连接测试、版本、配置目录与打开目录由设置设备领域负责，见[设置设备连接与系统资源](#设备连接与系统资源)；组件更新与自动更新由 `model/updateCommands.ts`、`model/autoUpdateConfig.ts` 及其 hooks 持有，见[设置组件更新与自动更新](#组件更新与自动更新)。自动更新的归一化模型仍在 `model/configNormalization.ts`，草稿、提交与调度状态机归自动更新所有者。

验证入口见文末[回归测试](#回归测试)。

### 1. 定位与边界

| 配置区块 | 可编辑 | 服务端资源 | 保存方式 |
| --- | --- | --- | --- |
| `connection` | 是 | `settings/maa-config` Query + `ConnectionConfigOwner` 草稿 | 自动保存（600ms 防抖 + 失焦/Activity 隐藏/卸载冲刷） |
| `resource` | 是 | `settings/resource-source` Query + `ResourceSourceOwner` 草稿 | 自动保存；MAA 运行中只读 |
| `instance` | 是 | `settings/maa-instance-options` Query + `InstanceOptionsOwner` 草稿 | 自动保存（600ms 防抖 + 失焦/Activity 隐藏/卸载冲刷） |

归属：

| 能力 | 所有者 | 不负责 |
| --- | --- | --- |
| 服务端只读快照、取消与重试 | `settings/maa-config`、`settings/maa-instance-options`、`settings/resource-source` Query（`model/connectionConfig.ts`、`model/instanceOptions.ts`、`model/resourceSource.ts`） | 草稿合并、保存时机 |
| 草稿、revision、迟到读取裁决、保存去重与结果 | `ConfigDraftOwner`（`model/configDraftOwner.ts`）及其 `ConnectionConfigOwner` / `InstanceOptionsOwner` / `ResourceSourceOwner` 实例 | 服务端事务、跨客户端条件写 |
| 兼容存储键、window 事件与清理 | `model/configSection.ts` | 配置读取或保存 |
| 页内导航与滚动定位 | `model/settingsSections.ts`、`hooks/useSettingsSectionNavigation.ts`、`SettingsSection`、`SettingsSectionNav` | 配置读取或保存 |
| 页面反馈、自动保存调度、区块组合 | `ConfigEditorCard`、三个配置面板、`useAutoSave`、`SettingsWorkspace` | 再维护一份 revision 或草稿副本 |

三个配置区块各自持有草稿与保存状态：connection/instance 读写同一 MAA profile 的不同 section，resource 读写 `cli.toml` 的 `[resource]`。三个表单同时可见，失焦、Activity 隐藏与卸载会冲刷待保存值；保存进行中继续编辑时保存继续执行，新草稿由下一次排程提交。

### 2. 读取与草稿

#### 2.1 Query 身份与载荷

`maa-config` 的 profile 参数与 Query key 以[Query 缓存与键规范](../../architecture/query-cache.md)为准。

- Query 只保存服务端只读快照，不直接写页面；`queryFn` 把 Query 的 `AbortSignal` 传给 `getConfig(profileName, signal)`，Activity 隐藏或卸载时由 Query 取消观察并按既有策略保留缓存。
- `getConfig` 收紧载荷校验：profile 载荷为 `{ connection, instance_options }`，`connection` 已知字段出现时必须是正确类型（`adb_path`/`address`/`config` 字符串、`auto_reconnect` 布尔），`instance_options` 出现时必须是对象；类型不合法返回 `INVALID_DOMAIN_PAYLOAD`。`preset` 不在客户端校验范围内，由服务端读取时归一别名、保存时校验。兼容旧版直接返回 connection 段的扁平载荷。缺失字段是合法的 MAA profile 形态，由归一化模型补页面默认值。
- 归一化保留 `connection` 与 `instance_options` 段中的未知字段，保存时随快照原样回写；已知字段缺失或类型不合法时使用默认值：connection 为 `/opt/homebrew/bin/adb`、`127.0.0.1:16384`、`CompatMac`、`preset=ADB`、自动重连开启；实例选项为 MaaCore 默认值（`Adb`、三项开关关闭）。
- `auto_reconnect` 在 MAA profile 中属于 `[behavior]` 段：服务端读取时并入 connection 视图，保存时写回 `[behavior]`，并兼容旧版写在 `[connection]` 的值。
- `preset` 与 `touch_mode` 由服务端归一别名与大小写（`PlayTools`→`PlayCover`、`maatouch`→`MaaTouch`），页面只提供受支持的规范值；保存前服务端再次校验，非法值返回 400 `AGENT_CONFIG_PROFILE_INVALID`。
- Query 默认策略与失败分类沿用[Query 缓存与键规范](../../architecture/query-cache.md)。

#### 2.2 草稿状态

`ConnectionConfigOwner` 是模块级对象，寿命不跟随页面或 Activity：

| 字段 | 含义 |
| --- | --- |
| `draft` | 当前可编辑草稿；包含服务端未知 connection 字段 |
| `persisted` | 最近一次服务端读取采用或成功保存的值 |
| `revision` | 草稿可观察版本；编辑、采用服务端值与保存成功都会推进 |
| `dirty` | `draft` 与 `persisted` 是否存在差异 |
| `syncState` | `idle` / `saving` / `failed` |
| `error` | 最近一次保存失败的原始原因 |
| `loaded` | 是否已成功采用服务端读取或完成一次保存 |
| `lastSavedAt` | 最近一次保存成功的时间戳 |

#### 2.3 迟到读取与 refresh

一次读取开始时 owner 记录 `{ revision, dirty, saving }` 快照；Query 返回时只有以下条件全部满足才采用服务端值：

1. 读取开始后没有新编辑或保存（`revision` 未变）；
2. 读取开始时没有未保存草稿（`dirty=false`）；
3. 读取开始时没有保存在途（`saving=false`）；
4. 当前没有保存在途，也没有未保存草稿。

因此：

- **首次加载完成前不接收编辑**：`loaded=false` 时 `update()` 返回 `false`，表单控件禁用且自动保存不排程；首次响应因此总能按当前 revision 采纳，不会因加载期间的编辑被丢弃而停留在未加载状态。
- **refresh 不覆盖编辑**：重新读取（remount、失效后的重取或显式重新读取）在草稿未保存时不会改页面值；草稿干净时才采用服务端快照。
- **保存前发出的读取不会回滚保存**：保存成功会推进 revision，使保存前开始的读取即使更晚返回也失效。

页面把 Query 快照交给 owner 裁决（`adoptServer(snapshot)`），不直接把 `query.data` 写进表单。

#### 2.4 自动保存

保存由 `useAutoSave` 调度，写请求仍是 `POST /agent/config/maa/:profileName`，connection 与 instance 各发 `{ connection: snapshot }` 或 `{ instance_options: snapshot }`，服务端按 section 合并，因此两个表单不会互相覆盖。

- 文本输入停止 600ms 后提交；开关/复选/下拉在变更后立即冲刷；文本框失焦、Activity 隐藏、组件卸载与 `pagehide` 立即冲刷。
- 首次服务端读取被采纳前（`loaded=false`）不保存，表单控件禁用；读取失败时卡内显示错误与“重新读取”，不排程自动保存。
- `revision=0`（尚未发生用户编辑）时不提交，避免把读取回退或默认值写回服务端。自动保存只读 owner 的 `dirty`/`syncState`/`revision`，不复制草稿。
- 同一时刻只允许一次保存；保存期间仍可编辑。响应返回时只有 revision 未变才把当前草稿视为已保存；否则返回 `superseded`，静默保留新草稿，后续状态变化会再次排程提交最新值。
- 保存成功清除 dirty、更新 `persisted` 与 `lastSavedAt`，并推进 revision 使保存前的读取失效；成功不发提示。保存失败保留草稿与 `failed`/`error`，卡内显示 `Alert`，同时发带“重试保存”action 的 error toast；下一次编辑或显式重试继续提交。
- 资源源保存受 MAA 执行租约约束：运行中表单只读并暂停自动保存，任务结束后脏草稿自动补交。
- 服务端只返回成功信封，不回写 profile；页面按已发送快照确认，不伪造服务端归一化结果。

#### 2.5 读取失败

初始读取失败（尚无 Query 数据）在对应面板显示页内 `role="alert"` 与全局通知（`连接配置读取失败: <原因>`、`实例选项读取失败: <原因>`、`资源源配置读取失败: <原因>`），页内反馈提供“重新读取”按钮调用同一 Query 的 `refetch`；已有服务端数据后的后台 refresh 失败不打断编辑，也不重复发送全局通知。读取成功后清除对应的初始失败提示并恢复编辑与保存。

`loaded` 保持 `false` 期间编辑与自动保存都不可用；`ConfigDraftOwner.adoptServer()` 仍按 revision/dirty 规则丢弃过期的后台快照，但首次快照按当前 revision 采纳（加载期间没有可推进 revision 的编辑），因此慢请求与显式重试都能恢复到可保存状态。

#### 2.6 实例选项与资源源配置

- **实例选项**（`model/instanceOptions.ts`、`hooks/useSettingsInstanceOptions.ts`）读写同一 MAA profile 的 `[instance_options]`，保存只提交 `{ instance_options: snapshot }`；字段为触控模式（`Adb`/`MiniTouch`/`MaaTouch`/`MacPlayTools`/`MaaFwAdb`）、`deployment_with_pause`、`adb_lite_enabled`、`kill_adb_on_exit`。profile 缺该 section 时按 MaaCore 默认值展示，未知字段原样保留。
- **资源源**（`model/resourceSource.ts`、`hooks/useSettingsResourceSource.ts`）管理来源、自动更新与失败告警开关。Git 表单提供后端选择，保存时沿用已有分支配置。MirrorChyan 表单用 `cdkKind` 显示已保存的凭据形态，并用 `clearCdk` 请求显式清除。字段契约见 [Agent API](../../api/agent.md)。
- 保存成功后 hook 重新读取同一 Query，以服务端归一化的配置和凭据形态覆盖草稿，并清空凭据输入框。
- 保存请求中空白凭据表示保留服务端已保存值；输入新值会替换为明文字符串；`clearCdk` 显式写回 `cdk = false`。页面从不接收或渲染已保存的明文凭据。
- MAA 运行中（`useStatusStore` + `isRunStatusBusy`）资源源表单整体只读并暂停自动保存；服务端 `saveResourceSourceConfig` 在 `withMaaExecutionLease` 内执行，运行中保存返回 409 `MAA_EXECUTION_BUSY`。任务结束恢复编辑后，若草稿仍 dirty 会自动补交。
- CDK 输入聚焦期间只改草稿、不排程自动保存；失焦立即提交，避免把半截凭据写入 `cli.toml`。

### 3. 区块状态与兼容事件

| 项目 | 值 / 行为 |
| --- | --- |
| 存储键 | `laPlumaConfigSection`（兼容键，不改名；继续写入，页面不再据此决定渲染内容） |
| window 事件 | `la-pluma-config-section`，`detail` 为 `connection`/`resource`/`instance` |
| 初始高亮 | 由滚动宿主中的区块位置计算；首屏通常为 `connection` |
| 点击目录 | 滚动到目标区块并更新高亮；配置区块同时写兼容键 |
| 外部事件 | 校验 `detail`，滚动到对应配置区块并写兼容键；非法 detail 忽略 |
| 清理 | `useSettingsSectionNavigation` 在 Effect cleanup 中注销滚动监听、`ResizeObserver` 与 window 事件；Activity 隐藏/恢复后重新测量 |

`model/configSection.ts` 是兼容键与事件名的唯一所有者；`hooks/useSettingsSectionNavigation.ts` 只负责滚动定位与 React 高亮状态。页面不再读 `localStorage` 决定可见内容，也不持有 `setConfigType`。

六个区块同时渲染，三个配置面板都保持挂载；`settings/maa-config`、`settings/maa-instance-options`、`settings/resource-source` 在页面挂载时一起读取。滚动或目录跳转只改变高亮与滚动位置，不重建 Query，也不清空草稿。面板组合与订阅边界见[设置领域面板](#页面与面板)。

### 4. 面板接线

- `ConfigManager` 只组合页面壳与 `SettingsWorkspace`；区块、右侧目录与滚动导航由工作区渲染。
- `useSettingsConnectionConfig()` / `useSettingsInstanceOptions()` / `useSettingsResourceSource()` 返回各自的 `draft`、`dirty`、`syncState`、`error`、`loaded`、`loadError`、`update`、`getState`、`save`、`reload`；三个面板通过 `useAutoSave` 接线，卡片外壳共用 `ConfigEditorCard`。三个面板始终可见并读取各自 Query。
- 页面不持有：`configData` state、`loadConfig()`、`connectionRevisionRef`、`connectionSaveInFlightRef`、区块 `localStorage` 读写与 window 监听。
- 连接、实例与资源源表单字段都通过 `update(patch)` 写入各自 owner；编辑会清除 owner 的 `error`，页内保存错误由此消失。
- 自动保存成功与 `superseded` 均静默；读取失败在卡内显示 `Alert` 并可“重新读取”，保存失败卡内显示 `Alert` 并可“重试保存”，同时发带 retry action 的 error toast。资源源在 MAA 运行中只读，重试按钮同时禁用。
- 自动更新的读取/本地回退、touched/revision、保存后 `setupAutoUpdate` 与反馈由 `AutoUpdateConfigOwner` 和 `useSettingsAutoUpdate()` 持有；归一化与时间校验仍在 `model/configNormalization.ts`，见[设置组件更新与自动更新](#组件更新与自动更新)。
- 设备发现、连接测试、版本、配置目录与打开目录归[设置设备连接与系统资源](#设备连接与系统资源)；组件更新与自动更新归[设置组件更新与自动更新](#组件更新与自动更新)。

### 5. 兼容与维护约束

- connection 与 instance 的端点、请求体与响应体未改变，服务端 TOML 写入方式不变；资源源配置使用新增的 `GET/POST /agent/config/resource-source`（不写 MAA profile）。配置 key、profile 名与区块兼容存储键/事件名保持不变。
- Query 快照只存在于内存，浏览器刷新随缓存丢失；key 与参数清单见[Query 缓存与键规范](../../architecture/query-cache.md)。没有新增 localStorage 数据。
- 载荷校验比迁移前严格：已知字段类型不合法时整份读取失败并显示错误，而旧页面会把异常值放入受控输入。未知 connection 字段仍原样保留。
- 已知字段缺失时显示页面默认值，而旧页面会显示空输入；这是归一化模型的要求，正常服务端载荷（`getConfig` 自带默认值）不受影响。
- 默认渲染结构使用 shadcn `Card` / `Field` / `Item` / `Alert` / `Badge`；失败/`superseded` 提示只在非默认状态出现，行为契约不因结构调整改变。视觉基线冻结至后续统一重生成，本页不在本轮更新截图。

## 设备连接与系统资源

设备发现/连接测试是带副作用的显式命令，由模块级 `DeviceConnectionOwner` 持有；版本与配置目录是只读资源，由 `settings/version`、`settings/config-directory` Query 持有。三个配置草稿与保存见[设置配置编辑与保存](#配置编辑与保存)，Query 通用策略见[Query 缓存与键规范](../../architecture/query-cache.md)，请求取消与失败分类见[资源请求错误与取消契约](../../architecture/resource-requests.md)。

### 1. 定位与边界

| 能力 | 唯一所有者 | 形态 | 不负责 |
| --- | --- | --- | --- |
| 设备发现 | `features/settings/model/deviceConnection.ts` 的 `DeviceConnectionOwner` | 显式命令 `GET /agent/actions/discover-devices?adbPath=…`；不进入 Query | 保存连接配置 |
| 连接测试 | 同一 owner 的 test 链 | 显式命令 `POST /agent/actions/test-connection`；不进入 Query | 写草稿、写 profile |
| 版本读取 | `features/settings/model/systemResources.ts` 的 `versionQueryOptions()` | `settings/version` Query | 更新命令 |
| 配置目录读取 | 同文件的 `configDirectoryQueryOptions()` | `settings/config-directory` Query | 打开目录 |
| 打开配置目录 | `features/settings/hooks/useSettingsConfigDirectory.ts` 的 `open()` | 显式命令 `POST /agent/actions/open-config-directory` | Query、自动重取 |
| 页面反馈与自动保存提示 | `components/DeviceConnectionPanel.tsx`、`components/DeviceConnectionDialog.tsx`、`ConfigDirectoryPanel.tsx`、`ResourceSourcePanel.tsx`、`InstanceOptionsPanel.tsx` | 只渲染 owner/Query 状态并发出全局通知；资源源额外订阅运行状态 | 命令状态机、请求取消 |

设备发现会探测本机 ADB 与常见模拟器端口，连接测试会尝试 `adb connect`；两者在 Agent 契约中属于低风险写入，不应做成可自动重取的只读 Query。打开配置目录同样有副作用，只保留显式入口。

### 2. 设备发现与连接测试

#### 2.1 独立状态机

`DeviceConnectionOwner` 公开两条互不影响的命令链：

| 状态 | 含义 |
| --- | --- |
| `discovery.phase` | `idle` / `running` / `succeeded` / `failed` / `cancelled`；只控制“查找设备”按钮禁用态（不改文案、不加图标）与查找弹窗的 loading |
| `discovery.devices` | `devices` 与 `candidates` 按响应顺序拼接；查找进行中保留上一次列表 |
| `discovery.message` | 可直接展示的提示；服务端 `message` 或本地失败说明 |
| `discovery.error` | 请求失败或内层 `success=false` 的原因；成功与取消为 `null` |
| `discovery.searched` | 是否完成过一次查找；取消不算完成，弹窗据此显示空结果提示 |
| `test.phase` | 同上的测试生命周期；只控制“测试连接”按钮禁用态（不改文案、不加图标）与设备行按钮 |
| `test.address` / `test.success` / `test.message` | 最近一次测试目标与连接结果；未建立连接但请求完成时 `error=null` |
| `test.draftRevision` | 发起测试时的草稿 revision |
| `test.superseded` | 测试期间草稿已推进；结果仍通过 toast 展示，但不代表当前表单目标 |

规则：

- 两条链各自只有一次在途请求。重复发起同一类操作会 `abort()` 旧请求；旧响应不写状态，返回 `cancelled`。
- 一个操作的进行或失败不改写另一个操作的 loading。查找开始会清空连接测试的最近结果状态：已结束的测试回到 `idle`，在途测试保持 `running` 且不被取消；连接测试完成仍会在查找进行中写入自己的结果（迁移前行为）。
- 取消不展示为失败。`AbortError` 不写入 `message`/`error`；`phase` 变为 `cancelled`。
- 取消查找不把 `searched` 置为 true；从未完成过查找时，取消后恢复页面不会出现伪造的“未找到设备”（此前已完成过查找时空结果提示保持迁移前行为）。
- 设备行只接受非空 `address`；未知 `state`/`source` 分别回退 `unknown`/`adb`，坏条目跳过，不再像迁移前那样在非数组载荷上抛错。
- 内层 `success=false`（例如 ADB 不可用）是领域失败：`phase=failed`、`error`/`message` 取服务端文案，载荷中归一后的设备仍会展示（服务端通常返回空数组）；HTTP/API 信封失败清空设备；传输失败使用 `查找设备失败: <原因>`。连接测试的请求失败使用 `连接测试失败: <原因>`。
- 连接未建立（`success=false` 但请求完成）仍是已完成的测试结果：`phase=succeeded`、`test.success=false`，页面以 error toast 反馈。
- 设备面板的“查找设备”与“测试连接”按钮在请求期间只设置 `disabled` 与 `aria-busy`，保持文案与图标不变；查找进行时的可见反馈由查找弹窗内的状态行承担。
- 查找反馈只在 `DeviceConnectionDialog` 内呈现：查找中、失败、取消与空结果都在弹窗内展示，不使用 toast；弹窗关闭会取消在途查找。
- 连接测试结果只通过固定 id `settings-connection-test` 的全局 toast 呈现：成功用 success，未建立连接与请求失败用 error，取消不提示。面板用 ref 记住已提示的结果对象，Activity 恢复不重复发同一条 toast。

#### 2.2 查找弹窗、选择结果与草稿版本

查找入口是面板的“查找设备”按钮：点击同时打开 `DeviceConnectionDialog` 并立即发起查找；关闭弹窗（X、Esc、遮罩或页脚“关闭”）会取消在途查找。再次打开会重新查找，查找期间保留上一次列表。

选择设备时：

1. 读取**点击时**的最新草稿；设备自带 `adbPath`（Windows 模拟器内置 ADB）时使用它，否则沿用最新草稿的 `adb_path`。
2. 通过 `ConnectionConfigOwner.update()` 只合并 `adb_path`/`address` 两个字段，保留服务端未知字段、其它草稿字段与点击前的最新编辑。草稿内容未变化时不推进 revision。
3. 记录更新后的草稿 revision 并启动连接测试；测试响应从不写草稿。

因此测试期间继续编辑地址、平台配置或自动重连不会被旧测试结果覆盖；`test.superseded` 会标记该结果不再对应当前目标。地址输入变更只清除旧反馈，不取消在途测试（迁移前行为）。

#### 2.3 Activity 与取消

`useSettingsDeviceConnection()` 只做订阅与动作转发；取消动作由 `SettingsWorkspace` 的 `useDeviceConnectionActivityCleanup()` 在 Effect cleanup 中调用：

- Activity 隐藏或页面卸载会 abort 两条链的本地等待；不会调用服务端停止接口，也不撤销已发生的探测/`adb connect`。
- 关闭查找弹窗只取消 discovery 链的本地等待，不影响在途连接测试；连接测试继续由模块级 owner 结算并通过 toast 反馈。
- 滚动或目录跳转不触发取消：设备面板常驻，在途请求继续，结果写入模块级 owner。
- 已完成的结果保存在模块级 owner 中，恢复后继续展示；不自动重发，用户可再次查找或测试。
- hook 恢复时重新订阅；真正卸载后 owner 仍是同一实例，未完成请求已被取消，不会在后台回填页面。

### 3. 版本与配置目录

#### 3.1 Query 身份与归一化

版本与配置目录的 Query key、默认策略以[Query 缓存与键规范](../../architecture/query-cache.md)为准。

- `versionQueryOptions()` 把 Query 的 `AbortSignal` 传给 `getVersion(signal)`，只接受 `cli`/`core`/`raw` 为字符串；坏的 `resource` 块被归一为 `unknown` 状态与空字段，缺失 `resource` 时页面不显示资源行。不可用载荷成为 `contract` 失败。
- `configDirectoryQueryOptions()` 把 signal 传给 `getConfigDir(signal)`，同时接受服务端当前的 `{ path }` 与旧的纯字符串形状；空白路径视为 `contract` 失败。`getConfigDir` 的返回类型因此从 `ApiResponse<string>` 修正为 `ApiResponse<string | { path: string }>`，与运行时的旧字符串/对象两种形状一致。
- 两者沿用 Query 默认重试与取消策略；传输失败会先经过重试，之后才显示初始目录错误，与 connection 读取一致。

#### 3.2 页面语义

- 版本读取失败保持静默（迁移前行为）；页面继续渲染其余内容。更新成功后的版本同步由设置域更新命令调用 `useSettingsVersion().reload()`，其内部 `invalidateQueries` 同一 `settings/version`：页面可见时立即重取，隐藏时恢复显示后重取，见[设置组件更新与自动更新](#组件更新与自动更新)。
- 配置目录首次读取中显示“正在读取目录...”；从未成功读取且失败时显示 `配置目录读取失败: <原因>` 与“重试”按钮，重试走 `refetchQueries` 同一 key。
- 后台刷新失败保留最近一次成功路径；只有从未成功读取过才显示错误，避免 Activity 恢复后的后台失败清空可用路径。
- 打开目录入口是配置目录卡片按钮，调用 `useSettingsConfigDirectory().open()`；成功提示“已打开配置目录”，失败提示 `打开失败: <原因>`，不触发 Query 重取。
- 滚动或目录跳转不取消在途设备命令，也不清空设备列表、最近测试结果、版本与目录路径；设备面板常驻，状态保存在模块级 owner 与 Query 缓存中。查找弹窗关闭会显式取消在途查找；Activity 隐藏或页面真正卸载则由 `SettingsWorkspace` 的 `useDeviceConnectionActivityCleanup` 取消两条链，区块可见性与滚动位置不触发取消。
- 配置目录只有卡片一个观察者；滚动或目录跳转不产生目录请求，失败后的重试入口仍只在目录卡片。

### 4. 面板接线与遗留清理

`ConfigManager` 只组合页面壳与 `SettingsWorkspace`；设备发现、连接测试、版本、配置目录与打开目录由 hooks 持有，当前分别由设备、更新与目录面板订阅。`ConfigManager` 与各面板都不直接导入 `discoverDevices`、`testConnection`、`getVersion`、`getConfigDir`、`openConfigDir`，也不保存设备列表、查找/测试 loading、最近测试结果、版本、目录路径/状态/错误的页面 state。对这些资源，面板只保留渲染与全局通知；组件更新与自动更新由 模块级所有者持有，见[设置组件更新与自动更新](#组件更新与自动更新)。

| 页面原职责 | 新归属 |
| --- | --- |
| `handleDiscoverDevices` / `handleTestConnection` / `handleUseDiscoveredDevice` | `DeviceConnectionPanel` → `useSettingsDeviceConnection()` 动作 |
| 设备列表、查找提示、`hasSearchedDevices`、`discoveringDevices` | `DeviceConnectionOwner.discovery`；`DeviceConnectionDialog` 渲染 |
| 测试 loading 与最近测试结果 | `DeviceConnectionOwner.test`；结果通过 `settings-connection-test` toast 展示 |
| `loadVersion` 与 `versionInfo` state | `SettingsUpdatesPanel` → `useSettingsVersion()` + `settings/version` |
| `loadConfigDir`、目录三态与重试 | `ConfigDirectoryPanel` → `useSettingsConfigDirectory()` + `settings/config-directory` |
| `handleOpenConfigDir` 的 API/错误分支 | `useSettingsConfigDirectory().open()`；目录卡片唯一入口 |

自动更新与 core/cli/资源更新归 `model/autoUpdateConfig.ts`、`model/updateCommands.ts` 及其 hooks，见[设置组件更新与自动更新](#组件更新与自动更新)；更新成功后的版本读取走同一 Query。

### 5. 兼容与维护约束

- 端点、请求体与响应体未改变；未修改服务端。设备发现仍是 GET、连接测试与打开目录仍是 POST。
- 新增 Query key 只存在于内存，浏览器刷新随缓存丢失；没有新增 localStorage 数据。
- 查找弹窗使用 `DialogFrame` / `DialogBody` / `DialogFrameFooter`；设备列表行使用 shadcn `Item`（渲染为 button），状态标签使用 `Badge`；空结果显示 `EmptyState compact`。查找失败、取消与空结果在弹窗内展示，连接测试结果走 `settings-connection-test` toast；端点、请求体与响应体未改变。
- 设备发现反馈不再内联在连接卡片中；关闭查找弹窗会取消在途查找。连接测试反馈不再使用卡内 `SettingsFeedback`，改为全局 toast。
- 视觉基线冻结至后续统一重生成；本页不在本轮更新截图。
- 行为差异：
  - 设备发现与连接测试请求现在在 Activity 隐藏/卸载时 abort；迁移前会继续完成并写页面 state。滚动与目录跳转不取消命令，设备面板常驻。
  - 非数组/坏设备条目被跳过而不是抛错；未知状态/来源回退为“状态未知”/ADB。
  - 配置目录后台刷新失败保留最近成功路径；迁移前显式重读失败会清空路径。
  - 版本 `resource` 块按已知字段归一；坏字段显示 `unknown`，不再把任意对象直接传入渲染。
  - 传输失败按 Query 默认重试，错误提示在重试结束后显示。

## 组件更新与自动更新

版本资源的 Query 身份见[设置设备连接与系统资源](#设备连接与系统资源)，配置编辑见[设置配置编辑与保存](#配置编辑与保存)，失效端口见[共享资源归属与失效端口](../../architecture/resource-ownership.md)。

### 1. 定位与边界

| 能力 | 唯一所有者 | 形态 | 不负责 |
| --- | --- | --- | --- |
| core 更新 / 渠道切换 / CLI 更新 / 资源热更新 | `features/settings/model/updateCommands.ts` 的 `SettingsUpdateOwner` | 显式 POST 提交服务端 Run；共用一条在途槽位，按 `runId` 等待终态；不进入 Query | 版本读取、跨域失效发布 |
| 更新 Run 的观察与停止 | `features/settings/model/updateRunPort.ts` | 采纳 `runId`、等待终态、解除身份、按目标停止；复用 `task-execution` 控制器 | 服务端 Run 身份与状态机 |
| 更新后的版本同步 | `features/settings/hooks/useSettingsUpdates.ts` 调用 `useSettingsVersion().reload()` | 后者 `invalidateQueries` 同一 `settings/version` | 伪造版本快照 |
| 更新后的跨域失效 | 同一 hook | 成功确认后推进物品图标 epoch，并按[失效端口](../../architecture/resource-ownership.md)发布（`cause: resource-update`） | 清空 Query 缓存、轮询 |
| 自动更新策略草稿与完整提交 | `features/settings/model/autoUpdateConfig.ts` 的 `AutoUpdateConfigOwner` | 模块级草稿；自动保存 = 写 user config + 应用调度 | 定时任务本身的执行 |
| 自动更新归一化与时间校验 | `features/settings/model/configNormalization.ts` | 纯函数 | 草稿生命周期 |
| 页面反馈与自动保存提示 | `components/AutoUpdateConfigPanel.tsx`、`components/ComponentUpdatePanel.tsx` | 只渲染 owner 状态；失败带重试，成功静默 | 再维护 update/auto-update 草稿 |

四条更新命令与自动更新保存都是**写入**：没有 Query mutation，也没有 AbortSignal。自动更新失败后不会循环重试，只在下一次编辑或显式“重试保存”时再提交。用户取消页面或 Activity 隐藏只停止观察，不会撤销已提交的写入。

更新命令提交为服务端 Run：`waitForCompletion:false` 在取得执行权后返回 `runId`，命令在 Run 进入终态前保持 `running`；面板可用“停止更新”按该 `runId` 发送停止请求，但停止返回只代表意图已记录，命令仍等待终态。服务端返回没有 `runId` 的旧同步响应时，命令按原语义立即完成，不伪造执行身份。

### 2. 组件更新命令

#### 2.1 互斥与生命周期

`SettingsUpdateOwner` 只有一个 `running` 槽位：

| 状态 | 含义 |
| --- | --- |
| `running: 'core'` | 普通 core 更新（不传版本，服务端 `maa update` 并同步资源） |
| `running: 'core-channel'` | 更新到选中且不同于已装渠道的目标（`install <channel> --force` 并同步资源） |
| `running: 'cli'` | CLI 更新 |
| `running: 'resources'` | 更新资源 |
| `running: null` | 空闲 |

规则：

- 任意一条命令运行期间再次发起（含同一命令）返回 `status: 'ignored'`，不发第二个请求；页面据此禁用全部更新按钮，只让实际运行的按钮显示 loading，并显示“停止更新”。
- 开始运行时清空 owner 反馈（CLI 更新除外）；成功返回 `succeeded`，失败返回 `failed`，被停止返回 `canceled`；Run 中断或记录失效按未知处理，不写成成功。
- 命令失败不自动重发。core/资源热更新在部分失败时把 `resourceRetry` 置为 true，error toast 显示“重试资源同步” action；该 action 调用资源热更新，仍是用户显式动作。
- 等待 Run 终态只由服务端状态结算，没有前端本地等待上限：控制器身份失效（服务端按 `runId` 查不到，`identity` 为 `unknown`）时按未知结算，写入“无法确认更新结果”的失败反馈、清空 `running` 槽位并解除身份；Run 仍活动时继续观察并保留 `running` 槽位与“停止更新”入口，维护命令可跑到服务端上限（默认 15 分钟、最长 1 小时）。页面刷新后 `observeTrackedRun` 从控制器的持久化身份恢复本域仍在运行的更新，重新占用槽位并保留停止入口，终态仍以服务端 Run 为准。
- 寿命不跟随页面：Activity 隐藏或页面重挂载不取消在途命令；完成后仍写 owner 状态并更新全局提示。

#### 2.2 失败与重试条件

| 结果 | 卡片内展示 | 全局提示 | 资源重试入口 |
| --- | --- | --- | --- |
| core / 渠道切换成功 | 不展示 | `result.message` 或 `MaaCore 和资源已更新` | 否 |
| core / 渠道切换成功但渠道配置未持久化（`channelPersisted === false`） | 不展示 | 文案明确“已更新，但渠道配置未能持久化” | 否 |
| core / 渠道切换失败，`errorInfo.details`（兼容旧 `error.details`）的 `failedStep === 'resources'` 或 `coreUpdated === true` | 不展示 | 服务端文案；toast 带重试 action | 是 |
| core / 渠道切换失败，其它路径 | 不展示 | 服务端文案 | 否 |
| CLI 成功 | 不展示 | `MAA CLI 更新成功` | 否 |
| CLI 失败 | 不展示 | `更新失败: <原因>` | 否 |
| 资源热更新失败（含内层失败、网络失败） | 不展示 | 服务端/本地文案；toast 带重试 action | 是 |
| 资源热更新并发冲突（服务端 409 `AGENT_MAA_RESOURCE_UPDATE_IN_PROGRESS`） | 不展示 | 服务端“已有资源更新正在进行（runId、状态）…”提示；toast 带重试 action | 是；首个更新结束后重试 |
| 更新被停止 | 不展示 | `更新已取消` | 否；版本仍可能变化，成功后重取 |
| Run 中断/记录失效 | 不展示 | `无法确认更新结果...` | 资源热更新为是 |
| 网络异常 | 不展示 | `网络错误: <原因>` | 资源热更新为是 |

更新 MaaCore 时，组件比较已保存的 core 渠道与已装版本推断的渠道（`resolveCoreChannel`，可区分 stable/beta/alpha）：不同则把选中渠道传给 update-core，服务端走 `install <channel> --force` 并回写渠道；相同则不传版本，服务端走 `maa update`。成功文案使用目标渠道标签。

资源重试入口的判定条件 `failedStep === 'resources' || coreUpdated === true` 不再只兼容旧服务端与旧 Run 记录：core/渠道切换命令已成功、但资源状态无法确认时，服务端写入 `{ version, failedStep: 'resources', coreUpdated: true }`；core 命令成功后版本刷新失败写入 `{ version, failedStep: 'runtime', coreUpdated: true }`。两者都满足该判定，error toast 因此显示“重试资源同步” action。只有 core 命令本身失败才写 `{ version, failedStep: 'core', coreUpdated: false }`，不提供该入口；独立的资源热更新失败同样提供该 action，升级前写入的旧 Run 沿用同一判定。

成功载荷的 `steps` 由实测状态派生（`steps.core.success`、`steps.resources.success` 均为布尔值，不再固定为 `true`），`channelPersisted` 标记请求的渠道是否已写入 `cli.toml`。`channelPersisted === false` 时更新本身仍算成功，但文案必须说明“已更新，但渠道配置未能持久化”，不得声称已切换到目标渠道，后续不带版本的更新可能仍沿用原渠道。

### 3. 成功后的版本与资源失效

更新命令确认成功后，React 适配层执行三项副作用：

1. **物品图标缓存版本**：资源变化成功后调用 `invalidateItemIconCache()`，推进并持久化 `laPlumaItemIconVersion`；`getItemIconUrl()` 使用 `?v=<epoch>`，训练/统计页通过 `useItemIconCacheVersion()` 重新渲染，避免浏览器继续命中同一路径的旧图。CLI 更新不推进。
2. **版本失效**：调用 `useSettingsVersion().reload()`，其内部 `queryClient.invalidateQueries({ queryKey: settingsKeys.query('version') })`。页面可见时立即重取；Activity 隐藏时 Query 没有观察者，失效标记保留，恢复显示后按 `refetchOnMount` 重新读取，不会被默认新鲜期挡住。
3. **资源失效**：core 更新、渠道切换与资源热更新按[共享资源归属与失效端口](../../architecture/resource-ownership.md)发布，`cause: 'resource-update'`。CLI 更新只改变 CLI 版本，不发布资源失效，也不推进图标 epoch。

完成提示（成功、失败或取消）在 Run 进入终态后立即发出，资源失效与版本重取随后执行；按钮在命令结束（Run 终态）时恢复可点，早于版本重取结束。停止请求本身不产生完成提示，只切换停止按钮与全局提示。因此用户立即发起第二条命令时，其开始提示不会被第一条的成功提示覆盖。

图标 epoch 由本客户端发起的手动更新推进；服务端定时自动更新或其他客户端触发的资源变化不会主动通知本标签页，需等待浏览器缓存过期或本客户端下一次手动更新。干员头像由 `getOperatorAvatarUrl` 带同一 `?v=<epoch>` 构造，`app/layout/Layout.tsx`、`features/statistics/components/OperatorPanel.tsx` 等直接传入 `itemIconVersion`，因此也随 epoch 重渲染（与[共享资源归属与失效端口](../../architecture/resource-ownership.md)一致）。

跨域作用域与接收方映射以[共享资源归属与失效端口](../../architecture/resource-ownership.md)为准。图标 epoch 是独立的本地缓存标记，由 `useItemIconCacheVersion()` 推动使用图标的组件重渲染；识别快照与掉落不由资源更新重写。

失败与取消不发布失效，也不重取版本以外的资源。失效只标记/重取明确受影响的 key，不调用 `queryClient.clear()`，不整体清空无关缓存。

### 4. 自动更新策略

#### 4.1 读取与本地回退

`AutoUpdateConfigOwner.load()`：

1. 读取服务端 `auto-update` 用户配置并归一化。成功且载荷可归一化时采用，`dirty=false`，清空此前的读取/保存反馈，并把该副本写入 `autoUpdateConfig` 本地键（编辑过的草稿不采用、不覆盖）。
2. 服务端失败时读取本设备上次保存的 `autoUpdateConfig`：可归一化时作为草稿（`dirty=true`），并给出 warning。服务端错误存在时文案为 `自动更新设置读取失败: <原因>，已显示此设备上次保存的设置，修改后将自动同步`；否则为 `已载入此设备上次保存的自动更新设置，修改后将自动同步`。回退草稿 `revision=0`，不会在挂载时自动提交。
3. 本地 JSON 损坏时给出 `自动更新设置读取失败: <解析原因>`，不伪造草稿。
4. 服务端成功但载荷不可归一化时按“无服务端错误”走本地回退；没有本地草稿且无服务端错误时保持默认值、不提示。

读取守卫：`load()` 记录开始时的 revision 与 touched；读取期间出现编辑（revision 推进、touched=true）或确认保存（revision 推进）时，迟到响应不写草稿。页面每次真正挂载读取一次；Activity 隐藏/恢复不重读（hook 的初始化标记随页面 state 保留），真正重挂载会重读：未保存草稿不会被覆盖，确认保存后的读取可以重新采用服务端副本（例如其它客户端已更新）。

#### 4.2 草稿与自动保存

任意 `update(patch)` 都：

- 合并当前草稿；内容与当前草稿完全一致时直接忽略，不推进 revision、不写本地草稿、不安排保存；
- 内容变化时 `dirty=true`、清空 owner 反馈、推进 revision，并立即写 `autoUpdateConfig` 本地键（本设备 fallback，不代表服务端已确认）。

自动保存由 `useAutoSave` 调度：

- 时间输入停止 600ms 后提交；开关/复选变更后立即冲刷；输入失焦、切到其它页面（Activity 隐藏）、组件卸载与 `pagehide` 立即冲刷。
- 首次 load 完成前不排程；load 产生的本地回退 dirty（`revision=0`）不算用户编辑，不会在挂载时覆盖服务端。
- `enabled && time` 不是 `00:00–23:59` 的 `HH:MM` 时前置拦截，不调用任何端点，只发固定 id 的 error toast；恢复合法后自动继续保存。
- 保存失败后不自动循环重试；用户下一次编辑或点击页内/toast 的“重试保存”再提交。

owner 的完整提交语义不变，同一时刻只有一次：

1. `saveUserConfig('auto-update', config)`。失败返回 `failed`，不调用调度接口，保留草稿与 dirty。
2. `setupAutoUpdate(config)`。`result.success` 且（禁用时或响应 data 的 `success !== false`）才算完整成功。
3. 完整成功且 revision 未变：写本地 fallback、清除 touched、推进 revision（使保存前发出的读取失效）、`dirty=false`；成功不发 toast。
4. 完整成功但保存期间出现新编辑：返回 `superseded`，保留新草稿与 dirty，静默等待下一次排程提交。
5. 配置已保存而调度失败：返回 `failed`，提示 `自动更新设置应用失败: <原因>`，配置不回滚，只发带“重试保存”的 error toast。

保存期间允许继续编辑；Activity 隐藏或页面重挂载不会中断已提交的保存。owner 是模块级对象，保存完成后即使页面隐藏也会写入状态。

### 5. 面板接线

`ConfigManager` 只组合页面壳与 `SettingsWorkspace`；`SettingsUpdatesPanel` 只提供卡片壳，自动更新策略与组件更新分别由 `AutoUpdateConfigPanel`、`ComponentUpdatePanel` 订阅。两个面板都不导入 `loadUserConfig`、`saveUserConfig`、`updateMaaCore`、`updateMaaCli`、`hotUpdateResources`、`setupAutoUpdate`，也不保存更新/自动更新的页面 state：

| 页面原职责 | 新归属 |
| --- | --- |
| `updating` / `hotUpdating` / `updateInFlightRef` | `SettingsUpdateOwner.running` |
| 更新 Run 身份、终态等待与目标停止 | `model/updateRunPort.ts` + `SettingsUpdateOwner` |
| 停止按钮与停止中文案 | `ComponentUpdatePanel` 订阅 `canceling` 并调用 `cancelUpdate()` |
| `updateFeedback` 与资源重试条件 | `SettingsUpdateOwner.feedback` |
| core/渠道/CLI/资源命令与开始/结束提示 | `useSettingsUpdates()` |
| 更新成功后的版本重取 | `useSettingsUpdates()` 调用 `useSettingsVersion().reload()`（`invalidateQueries`） |
| 自动更新 `autoUpdate`/`dirty`/`saving`/`feedback`、touched/revision、本地回退、保存 + 调度 | `AutoUpdateConfigOwner` + `useSettingsAutoUpdate()` |
| 自动更新提示 | 失败：带重试 action 的 toast；成功：静默；非法时间：仅 toast |

信息区按 MAA CLI、MaaCore、游戏资源三行排列；游戏资源使用独立一行展示更新时间与状态，不再挂在 MaaCore 下方。自动更新行与三行信息统一使用 `Field` 横排行（`min-h-11`，44px），控件保持 32px；动作区使用同样的 44px 行高与 `size="sm"` 按钮，三枚更新按钮统一为无图标的 `outline` 主题。按钮语义：core/资源/CLI 按钮显示各自 loading；全部更新按钮在任意命令运行期间禁用。所有动作统一放在卡片底部动作区，顺序为 MAA CLI、MaaCore、游戏资源；命令运行期间在同一区域追加“停止更新”（`canceling` 时显示停止中）。配置目录的文件夹图标位于路径文本左侧，“打开目录”按钮不显示图标。成功与失败都只走全局 toast，资源重试作为 toast action；卡片内不再渲染失败 `Alert`。

### 6. 兼容与维护约束

- 三类更新命令的路径未变，请求体新增 `waitForCompletion:false`，响应新增 `runId`/`run`/`pollUrl`/`stopUrl`，同时保留既有领域字段；更新渠道与资源源另用 `GET /agent/update-channels`、`POST /agent/actions/update-channel` 与 `GET/POST /agent/config/resource-source` 配置端点（不创建 Run）。update-core 仍在不传版本时使用 `maa update`；选中渠道与已装渠道不同时传该渠道（stable/beta/alpha）以强制安装并回写渠道。auto-update 仍先写 user config 再 POST `configure-auto-update`。
- localStorage 键 `autoUpdateConfig` 的写入时机与内容不变（成功加载、内容变化的编辑、保存成功；同值编辑跳过）；新增 `laPlumaItemIconVersion`，只保存物品图标缓存 epoch，不保存业务配置。
- 本专题未新增 Query key；版本继续复用 `settings/version`；物品图标与头像仍不进入 Query。
- 组件更新的图标缓存、版本同步与反馈时机见[成功后的版本与资源失效](#3-成功后的版本与资源失效)；自动更新草稿的读取、重挂载与保存裁决见[自动更新策略](#4-自动更新策略)。命令重试与生命周期以本专题第 2 节为准，Query 默认策略见[Query 缓存与键规范](../../architecture/query-cache.md)。

## 回归与关联

### 回归测试

以下路径相对于 `apps/web/src/`：领域回归在 `features/settings` 与 `pages/settings`，物品图标 epoch 回归在 `features/game-data/model/itemIconCache.test.ts`；入口命令见[验证命令](#验证命令)。

关键不变量：

- 草稿裁决：三个配置区块的初始读取与 refresh 不覆盖未保存编辑，保存期间编辑返回 `superseded`，后续自动保存补齐最新草稿；重置已移除。
- 实例选项与资源源：实例保存只提交 `instance_options`、连接保存只提交 `connection`；资源源保存不发送空白凭据、`clearCdk` 写回 `cdk = false`、响应不回显明文。
- 设备命令：取消跟随页面/Activity 而不是区块可见性，查找与测试 loading 互不影响，测试期间编辑标记 `test.superseded`，选择回填保留未知字段与最新编辑。
- 更新互斥与失效：单槽位重复发起返回 `ignored`，命令等待 Run 终态后才完成，停止只作用于本次 `runId`；core 更新在选中渠道与已装渠道不同时强制安装，core/热更新发布资源失效并推进图标 epoch，CLI 只重取版本；更新失败只走全局 toast，资源重试为 toast action；自动更新自动保存 = 写 user config + 应用调度，成功静默、失败可重试、非法时间不请求，跨 Activity 隐藏继续完成，迟到读取不覆盖编辑。
- 草稿隔离：connection/instance/resource 三个 owner 各自持有草稿与保存状态，三个配置 Query 同时读取；设备/更新/版本状态与全局通知不重渲染连接表单。
- 页内导航：六个区块标题、右侧目录、滚动高亮、锚点跳转与兼容事件由 `useSettingsSectionNavigation` 的行为测试覆盖；目录项使用 `aria-current="location"`。

视觉基线只覆盖默认 connection 页面；connection 表单新增「连接预设」后曾更新 6 张 config 基线，随后设置页治理（外观卡、Field/Item/Alert 替换、删除 settings.css）冻结基线，留待后续统一重生成。仓库内保留页内导航、草稿保留与保存反馈的行为回归。

### 验证命令

以下命令均在仓库根目录执行。

```sh
pnpm --filter la-pluma-next-client exec vitest run \
  src/features/settings \
  src/pages/settings \
  src/features/game-data/model/itemIconCache.test.ts
```

完整验证与视觉回归入口见[开发指南](../../development/README.md)。

### 关联契约

- [Query 缓存与键规范](../../architecture/query-cache.md)
- [前端架构与所有权](../README.md)
- [资源请求错误与取消契约](../../architecture/resource-requests.md)
- [共享资源归属与失效端口](../../architecture/resource-ownership.md)
