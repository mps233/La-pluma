# 跨页一致性集成测试

浏览器集成入口使用构建产物和真实 Chromium，按 API 契约提供可变场景数据，验证应用组合、Activity 保活与领域所有者在同一浏览器中的协作。它不连接设备，也不运行 MAA；设备停止、Run 保留与 HTTP 契约由服务端回归单独验证。

## 复现

在仓库根目录执行：

```sh
pnpm --filter la-pluma-next-client test:integration
pnpm verify
pnpm --filter la-pluma-next-client stylelint:ratchet
pnpm visual
```

集成和视觉测试复用已安装 `@playwright/test` 对应版本的 `mcr.microsoft.com/playwright:v<version>-noble` 镜像。集成入口要求本机已有镜像，不自动拉取。默认先构建客户端；已经构建时可用 `INTEGRATION_SKIP_BUILD=1` 跳过。Docker 需要本机 daemon 权限。浏览器与静态服务运行在同一个容器内，使用 Docker 默认隔离网络，不发布宿主端口，也不继承宿主 `PORT`；集成端口在容器内为 4318，视觉端口为 4300。不同 worktree 可并行运行，各自使用独立的构建产物与结果目录；同一个 worktree 内仍应顺序运行，避免同时覆盖构建与测试产物。每次集成测试内部按顺序执行，避免共享场景竞态。

PR/main 的 `browser-checks` job 在 `client-build` 成功后下载当前工作流的前端产物，拉取匹配镜像，再跳过重建运行集成和视觉测试；它不等待其他源码检查，失败会阻止 `verify` 汇总通过。tag 发布不重复运行浏览器检查。CI 中禁止 `test.only`，避免意外只运行单个场景。

失败截图与 trace 保存在忽略入库的 `apps/web/integration-artifacts/`。`tests/integration/harness.ts` 记录每次 API 的方法、路径、正文以及提交、停止、配置保存、定时注册和应用次数。未登记 API 与浏览器 `pageerror` 都使测试失败。视觉测试也从文档加载前记录脚本异常，防止仅截图通过掩盖初始化错误。

## 场景及可观测结果

| 场景 | 数据与操作 | 必须成立 |
| --- | --- | --- |
| 停止中切页、刷新恢复 | 日常页提交 `run-cross-page-current`，停止进入 `stopping`；切总览、返回、刷新，最后推进为 `stopped` | 始终只有一次提交和一次目标停止；两个页面共享运行阶段；刷新只恢复观察，终态才恢复启动入口 |
| 概览发起、日常接管 | 总览点“开始”提交一次，再切到日常页 | 日常页按同一 `run_daily_flow` 显示运行与逐项状态，启动入口禁用且不产生第二次提交；按 `runId` 停止后恢复“开始”，总览回到准备就绪 |
| 离线、读取失败与重连 | 停止中用浏览器 offline，再恢复网络并暂时中断 current 快照；随后恢复读取 | 保留最后 Run 身份；离线与读取失败展示未知并禁用启动；重连先按原 ID 对账，不能推断完成或重提 |
| 旧身份停止与新 Run | 持久化旧 ID `run-cross-page-stale-terminal`；当前快照已有新活动 Run，但旧 ID 查询被 gate 挂起 | 旧身份未确认时停止请求只携带旧 ID；`alreadyTerminal` 响应解除旧控制权；迟到旧查询不能覆盖新活动 Run；新 Run 保持运行且无新提交 |
| 同步活动预检 | 挂起活动执行响应，切日常再返回总览；另开没有发起方 loading/message 的浏览器页面观察快照；最后返回 `executed:false` 与导航阻断原因 | 响应前全局可观察预检 Run 并禁止重复入口；其他页面不冒充拥有它；阻断原因原样反馈，不伪造成执行成功 |
| 配置半失败显式重试 | 增加第三个定时时间，配置 POST 成功而 schedule 返回失败；切页后点“重新同步” | 保留三项草稿与错误 toast，恢复页面不自动重发；显式重试完整提交同一草稿，成功才清 pending，无设备执行 |
| 识别到计划应用 | 先挂载总览/日常/养成再隐藏；数据页识别完成后权威队列从两项变一项，预览 `CE-6 ×3` 并应用 | 识别只提交一次；隐藏养成恢复后读新队列；应用只写一次，日常重读服务端配置显示智能关卡；总览完整刷新显示一个目标，日常不把旧配置反写覆盖计划 |
| 实时预览跨页共享 | 在启动请求未完成时连续切日常、肉鸽、作业和养成，再切数据、日志、总览、设置并返回 | 只启动、登录与建立一个 socket/peer；各预览页绑定同一可播放视频流；显式关闭释放一次，页面切换不释放 |
| 日志固定范围与本地清屏 | 选择 Run 后推进终态与新活动 Run；清屏后轮询、隐藏日志页并释放迟到请求，再恢复 | 固定 Run 范围下事件集合不随终态或新活动 Run 漂移；不调用共享清空接口；旧记录不重现，隐藏期间不轮询，迟到响应不覆盖恢复窗口 |

训练计划的应用还受服务端游戏日、客户端类型与关卡开放门禁约束：跨日或切换客户端区服后应用旧计划会返回 409 `AGENT_TRAINING_PLAN_STALE`，客户端应清空预览并重新生成。该路径目前由服务端 HTTP 回归与前端计划所有者测试覆盖，尚未纳入上表的浏览器集成场景；契约见 [Agent API 的养成计划段](../api/agent.md#养成材料筹备队列与任务流程)。

测试文件为 `apps/web/tests/integration/execution.pw.ts`、`resources.pw.ts`、`logs.pw.ts` 与 `preview.pw.ts`。服务端目标停止保护的关键回归在 `apps/server/src/routes/__tests__/agentRoutes.test.ts`；Run 状态、持久化、快照与契约分别由 `agentRunService.test.ts`、`agentRunPersistence.test.ts`、`runSnapshotService.test.ts`、`agentContract.test.ts` 与 `agentContractHttp.test.ts` 覆盖。

## 契约与覆盖边界

状态所有者统一见[前端架构](../frontend/README.md#状态的唯一所有者)，跨域失效映射见[资源归属与失效端口](../architecture/resource-ownership.md)。上表场景验证这些契约的协作，不另维护状态归属表；静态依赖和页面职责由[护栏](guardrails.md)检查。

## 测试环境与兼容

视觉比对和基线更新规则见[开发指南](README.md)。共享视觉 harness 等待文档根可用后再插入冻结动效样式；初始化脚本异常也必须使测试失败。自动化旧断点的回归固定 `Date.now` 到 Run fixture 同一日期，避免运行当天超出断点接受期后使有效恢复场景过期。

断线、身份恢复和停止的行为由[执行客户端](../architecture/execution-client.md)维护；浏览器 fixture 不能代替真实设备或服务端持久化契约测试。
