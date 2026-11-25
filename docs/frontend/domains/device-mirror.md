# 设备画面与预览（device-mirror）

> [← 返回前端架构与所有权](../README.md)

`device-mirror` 不是独立页面，而是嵌入工作区的跨页共享面。它同时持有设备预览会话、截图采样、预览基础设施操作与总览的设备采样 Query；页面只组合布局并绑定视频元素。真实设备、WebRTC 信令与消息链路不在单元/浏览器测试的验证范围内，设备侧行为须以实机联调为准。

## 入口与布局

同一份共享画面有四种入口形态：

| 形态 | 使用页面 | 组件 |
| --- | --- | --- |
| `standard` 主列 + 设备列 | 日志、数据、养成、作业 | `DeviceMonitorLayout` + `DeviceMonitorPanel` |
| `workbench` 流程 / 配置 / 支撑列 | 日常 | 同上，monitor 位于 support 列顶部 |
| `mode` 模式导航 + 内容 + 设备列 | 肉鸽 | 同上 |
| 概览设备卡片 | 总览 | `DashboardPreviewEntry` |

- `DeviceMonitorLayout` 输出 `data-device-monitor-layout` 与 `data-monitor-area`；`data-region="monitor"` 只由 `DeviceMonitorPanel` 的卡片输出，每个页面恰好一个。
- 自动化与作业在配置读取中或读取失败时仍渲染 `DeviceMonitorLayout`（`standard`），把 `ConfigLoadCard` 放进主列；设备画面不因配置门禁消失。
- 设备画面标题是卡片内的 `h2`，monitor 列使用 `aside[aria-label="设备画面"]`。
- `standard` 在 `1360px` 及以上使用主列 + monitor + support 的三列布局，小于该宽度时保持纵向排列；`workbench`/`mode` 的页面网格仍由各自页面样式提供。`1280px` 与移动端的预览位置保持既有契约，不在本域内改写。

## 所有权与生命周期

`PreviewSessionProvider` 位于页面 `Activity` 边界之外，是预览会话的唯一所有者：

- `usePreviewSession` 只把共享 `MediaStream` 绑定到当前可见页面的 `<video>`；绑定关系随页面切换解除，连接、截图与基础设施操作不重建。
- `usePreviewSnapshot` 消费共享截图状态；`usePreviewInfrastructureView` 消费服务、Agent 与组件状态。
- `useScrcpyWebRTC` 持有信令、`RTCPeerConnection`、输入通道与触控发送；触控映射、指针捕获与全屏 Dialog 都由共享画面自身处理。
- `usePreviewStore` 以 `preview-storage` 持久化 `mode`、`quality`、`fps`、`maxSize`、`bitrateMbps`；多标签页只在刷新后收敛。

生命周期边界：

| 事件 | 行为 |
| --- | --- |
| `Activity` 隐藏（切页） | 只解除当前视频绑定；连接、截图与基础设施操作保持 |
| `Activity` 恢复 | 复用同一流，不重新启动服务、不重连 |
| 文档隐藏（live 已开始信令/WebRTC，含正在建立） | 进入 `180s` 缓冲；期间恢复继续使用同一连接，超时才释放并在恢复可见时重连 |
| 文档隐藏（`startWebrtc` 尚未返回） | 立即中止启动，不保留半开连接 |
| 文档隐藏（snapshot） | 立即暂停截图；恢复可见时立即重拍 |
| 真正卸载 Provider | 立即释放连接与截图资源；不改变 Run 身份或设备任务 |

## 状态模型

`model/previewStatus.ts` 把模式、可见性、可用性、live transport、快照与基础设施错误收敛为同一个状态对象：

| 优先级 | 条件 | `phase` | 默认文案 | `tone` |
| --- | --- | --- | --- | --- |
| 1 | `mode === 'off'` | `off` | 预览已关闭 | neutral |
| 2 | 文档隐藏且模式非 off | `paused` | 后台已暂停 | neutral |
| 3 | 自动化服务不可用 | `unavailable` | 自动化服务不可用 | warning |
| 4 | live + 启动/信令错误 | `live-error` | 实时预览失败 | danger |
| 5 | live + `connected` | `live-connected` | 实时画面 | success |
| 6 | live + `disconnected` | `live-disconnected` | 实时预览已断开 | warning |
| 7 | live 其余（idle/connecting/signaling/waiting_offer/connecting_webrtc） | `live-connecting` | 正在连接实时画面 | info |
| 8 | snapshot + 有旧帧 + 截图错误 | `snapshot-stale` | 画面快照更新失败 | danger |
| 9 | snapshot + 截图错误 | `snapshot-error` | 画面快照失败 | danger |
| 10 | snapshot + 有帧 | `snapshot-ready` | 画面快照 · 10s | info |
| 11 | snapshot 其余 | `snapshot-loading` | 正在获取快照 | info |

错误同一时刻只显示一个，优先级为 live → snapshot → infrastructure；基础设施错误在 live/快照错误存在时不重复展示。`off` 状态不渲染头部状态文案 live region，只保留模式控件的“关闭”选中态和空态标题；基础设施错误仍由空态的 `role="alert"` 播报。

恢复动作：

| 状态 | 动作 |
| --- | --- |
| `snapshot-error` / `snapshot-stale` | `snapshot.retry()` 立即重拍，保持快照模式 |
| `live-error` | `session.connect()` 刷新启动 attempt，保持 live 模式 |
| `live-disconnected` | `session.connect()` 就地重连 |
| `infrastructure` 错误（共享面板） | 打开预览设置模态窗；基础设施错误在模态窗内附带“刷新状态” |
| `infrastructure` 错误（总览） | 重新读取预览服务状态 |

- 有画面时错误显示在卡片顶部 `Alert`（含重试），无画面时错误留在空态（含同一动作），两者互斥。
- 快照失败保留上一帧，但在画面上标记“上次成功画面 · 可能已过期”，状态文案不再声称当前快照；总览使用同一语义。
- 除 `off` 外，同一卡片只有一个预览状态 live region；错误使用 `role="alert"`，不可用状态下已选中的模式选项也会禁用，用户仍可切回“关闭”。

## 预览设置模态窗

工具栏“预览设置”以 `DialogFrame` 打开模态窗，连接、画质与连接详情都在模态窗内；设备卡片不常显控制轨。

- **连接与服务**：服务/Agent/组件操作、断开/取消启动、重连预览、安装/重装组件。“重连预览”与“断开”同区，只有 live 模式下可用。
- **画质设置**：流畅（360p）/ 高清（720p）/ 超清（1080p）加“自定义”四档预设，以及帧率、最长边、码率控件。预设卡片按短边标注，内部仍以最长边（640/1280/1920）存储并作为 `max_size` 请求；最长边控件保留 640/960/1280/1600/1920。自定义独立保存一组帧率/最长边/码率：选其他预设不覆盖，点“自定义”恢复；在预设上修改任一值会以该预设值打底切到自定义。首次修改画质时弹出一次去重 toast（`preview-quality`）：live 模式带“重连”动作，其他模式提示下次连接实时预览时生效；重连成功后 toast 自动关闭。模态窗不再使用页脚，关闭走标题栏按钮或 Escape。
- **连接详情**：信令、视频与触控使用中文值（信令：未连接/连接中/信令中/等待画面/建立 WebRTC/已连接/已断开/连接失败；视频：实时或 `--`；触控：就绪、等待触控信息或 `--`），ICE、分辨率、FPS、码率与网络 RTT 保留原值和单位。

诊断指标仅在该模态窗打开时采样：`useScrcpyWebRTC` 的 `statsEnabled` 关闭后停止 `getStats`、清空旧值并重置采样基准；关闭模态窗即停止。网络 RTT 是 ICE 往返时间，不含设备输入处理与画面反馈。

模态窗按钮、工具栏与错误重试按 `44×44` 处理；模式分段恢复紧凑档位（32px 高、12px 字号，粗指针 36px），单项仍保留 44px 宽度。共享 `DialogFrame` 的默认尺寸不变，预览模态窗只通过局部类名放大关闭按钮。关闭后焦点归还触发按钮。

## 表面与样式

- 默认表面扁平：删除 `device-preview-glass-button` 与 `--glass-*` 消费；分段控件使用 shared `SegmentedControl`，容器为 `control-surface`，选中态为品牌动作色。
- 沉浸层按钮使用扁平深色 on-media chrome（`bg-black/50` + 白色边框），不使用 `backdrop-filter`。
- 状态色只使用 `--success` / `--warning` / `--destructive` / `--primary` / `--tertiary-foreground`；状态点由 `phase` 派生的 `tone` 选择完整类名。
- 空态使用 shared `EmptyState`，窄容器纵向、宽容器（`@container (min-width: 34rem)`）横向；标题 14px/600，说明 12px。

## 验证边界

- 单元测试覆盖状态优先级、错误/旧帧/重试、不可用模式、模态窗开关与焦点、诊断按需采样、布局 landmark 与 monitor 唯一性。
- 浏览器集成覆盖跨页复用同一流、沉浸层手势与 Escape、画质 toast，以及 1440/390 下共享画面与模态窗的触达目标、模式分段紧凑高度与横向溢出；观感变化以行为/DOM 断言与人工检查记录。
- 真实设备、ScrcpyOverWebRTC 实机画面、移动端粗指针与软键盘行为未在仓库测试中验证。
