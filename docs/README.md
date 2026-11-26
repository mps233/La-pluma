# 文档索引

> [← 返回项目 README](../README.md)

根 README 负责安装与快速开始；这里按使用任务组织长期文档。新增或修改约定时，先查[文档归属与单一事实来源](development/maintaining.md#文档归属与单一事实来源)，更新其归属文档，其他位置通过链接引用。

```text
docs/
├── guides/          # 使用、配置与部署
├── architecture/    # 系统概览与跨域契约
├── api/             # Agent 接口使用
├── server/          # 服务端架构与运行时
├── frontend/        # 前端架构、兼容与组件 API
│   └── domains/     # 页面领域与跨页共享域各维护一份文档
└── development/     # 开发、检查、集成与维护
```

## 使用与部署

| 文档 | 内容 |
| --- | --- |
| [功能概览](guides/features.md) | 总览、自动化、作业、肉鸽、数据养成与通知 |
| [配置与跨平台支持](guides/configuration.md) | 运行平台、ADB、Telegram 通知与 Bot |
| [部署指南](guides/deployment.md) | Docker、环境变量、HTTPS/PWA、子路径与 Compose |
| [Agent API](api/agent.md) | 能力发现、执行流程、幂等与鉴权 |

## 架构与通用契约

| 文档 | 内容 |
| --- | --- |
| [架构与技术栈](architecture/README.md) | 前后端边界、技术栈与项目目录 |
| [执行身份与生命周期](architecture/execution-lifecycle.md) | 服务端 Run、状态机、停止、占用与持久化 |
| [前端执行客户端](architecture/execution-client.md) | 控制器公开面、身份观察、停止与领域接线 |
| [配置持久化协调器](architecture/config-persistence.md) | 配置 key/wire、草稿、pending 与完整提交 |
| [资源请求错误与取消](architecture/resource-requests.md) | 请求信封、载荷校验、失败分类与取消 |
| [Query 缓存与键规范](architecture/query-cache.md) | 唯一客户端、key 清单、默认策略与覆盖值 |
| [共享资源归属与失效端口](architecture/resource-ownership.md) | 共享资源、跨域失效作用域及发布/接收映射 |

## 服务端与运行时

| 文档 | 内容 |
| --- | --- |
| [服务端架构与请求契约](server/README.md) | 分层方向、请求管道、响应契约与测试入口 |
| [运行时初始化、就绪与关闭](server/runtime-lifecycle.md) | 组装启动、就绪判定、执行准入与关闭流程 |
| [持久化与运行数据](server/persistence.md) | 数据位置与默认值、写入原子性、损坏 fail-closed 与恢复语义 |
| [日常流程与定时触发](server/scheduling.md) | 任务流计划、执行编排、cron 触发与通知/养成回写 |
| [MAA、ADB 与通知渠道](server/integrations.md) | MAA 子进程与日志、连接解析、回调解析与 Telegram 通知/Bot |
| [设备预览与信令运行时](server/preview-webrtc.md) | 同源信令网关代理、viewer 租约与上游端口边界 |

## 前端与领域

先读[前端架构与所有权](frontend/README.md)，了解分层、状态所有者、URL 与 Activity。旧入口消费者及移除规则见[兼容约束](frontend/compatibility.md)，组件 API 见[通用组件库](frontend/components.md)，主题注册与新增主题契约见[主题系统](frontend/themes.md)。界面规范统一维护在根 [DESIGN.md](../DESIGN.md)。

领域内的面板、模型、命令和回归入口合并在同一文档：

| 领域 | 内容 |
| --- | --- |
| [总览](frontend/domains/dashboard.md) | 区域订阅、完整快照与设备采样 |
| [自动化](frontend/domains/automation.md) | 流程/定时/摘要面板、纯模型、排序与任务编辑 |
| [作业](frontend/domains/combat.md) | 页面面板、搜索、预览、选段与命令模型 |
| [肉鸽](frontend/domains/roguelike.md) | 页面组合、配置表单与命令模型 |
| [统计与识别](frontend/domains/statistics.md) | 统计面板、筛选、识别命令与解析 |
| [养成](frontend/domains/training.md) | 队列、候选/计数、设置提交与计划有效期 |
| [日志](frontend/domains/logs.md) | 页面交互、实时流、历史会话与清理 |
| [设置](frontend/domains/settings.md) | 配置编辑、设备命令、系统资源与组件更新 |
| [设备画面与预览](frontend/domains/device-mirror.md) | 共享设备画面的入口、状态模型、生命周期、预览设置模态窗与扁平表面 |

## 开发与维护

| 文档 | 内容 |
| --- | --- |
| [开发指南](development/README.md) | 样式/测试治理、文件类型与常用检查 |
| [依赖与职责护栏](development/guardrails.md) | 分层、公开面、页面职责、布局/样式/测试护栏与限制 |
| [跨页一致性集成测试](development/integration.md) | Chromium 场景、复现方法、观察结果与覆盖边界 |
| [维护说明](development/maintaining.md) | 分支、发布、运行时依赖与文档归属 |

性能采样的方法与指标限制随工具维护在 [apps/web/tests/performance/README.md](../apps/web/tests/performance/README.md)。任务过程和一次性证据不加入现行文档索引。
