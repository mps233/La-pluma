# 浏览器交互与 React 性能采样

从仓库根目录运行，普通生产构建默认输出到忽略入库的性能结果目录：

```sh
node apps/web/scripts/performance-docker.ts
# dist 刚由相同源码构建且没有并行覆盖时：
PERFORMANCE_SKIP_BUILD=1 node apps/web/scripts/performance-docker.ts
```

入口使用已安装的 Playwright 对应官方 `-noble` 镜像，以 `--pull=never` 运行；缺依赖或镜像即失败，不安装、不升级。需要 Docker socket 访问权限。浏览器与静态服务位于同一个容器的默认隔离网络中，使用容器内端口 4317，不发布宿主端口，也不继承宿主 `PORT`；临时结果放在容器 `/tmp/la-pluma-performance-results`。必须在 verify 与集成检查结束后独占串行采样；采样期间不构建、不覆盖 dist、不运行其他高负载任务，其他 worktree 的任务也会争用宿主资源。

## 固定环境与完成语义

四类代表场景各 5 次，另加成功键盘排序对照 5 次，共 25 个新 browser context；一个 worker、无重试。固定 Chromium、1440×900、DPR 1、深色主题、zh-CN、上海时区、2026-10-24 04:00 的 Date、减弱动态效果、固定图片与 API。计时器与 `performance.now()` 为真实时间。交互 fixture 人工延时 25ms，既有共享 fixture 即时应答。

性能环境显式选择 `nativeClock: true`：只替换无参数 Date/Date.now，保留带参数 Date、静态 parse/UTC 与原生 performance.now、setTimeout、requestAnimationFrame，并逐样本断言原生函数身份。默认浏览器测试环境使用 Playwright `setFixedTime`，其 clock facade 按真实时间推进、精度为整毫秒。性能对照须使用相同 Date-only 协议，不能将不同计时协议的样本直接视为严格成对比较。

| 场景 | 固定输入 | 完成断言 |
| --- | --- | --- |
| automation-drag | 3 项流程，首项「启动游戏」拖过第三项中心，12 步 pointer move 后释放 | 真实 down/up；必须完成指定顺序、POST 配置中的 taskIds 正确、本地顺序一致、schedule 提交完成、pending 清除 |
| copilot-search | 冷 context，普通作业输入 `1-7` 后 Enter，5 条响应，无 recommended | 第 5 条可见、搜索按钮可用、只发 1 个 search GET |
| log-append | 180 行，下一次自然 1250ms 轮询取得 200 行快照 | 200 行与追加第 20 条可见，只发 1 个日志 GET |
| training-reorder | 2 项队列，下移艾雅法拉 | PUT IDs 为塞雷娅、艾雅法拉，再 GET 权威队列；最终顺序正确、按钮可用 |
| automation-keyboard | 同一 3 项流程，首项手柄 ArrowDown 一次 | 两侧均成功到第二位，配置/本地顺序、schedule 完成与 pending 清除都成立 |

setup 与 measurement 的 pageerror、console.error 均必须为零。页面和字体就绪后稳定 400ms，测量前完成滚动与起点定位；测量含输入、请求、完成断言及末尾两个 animation frame。所有测量窗口内请求必须已结束、HTTP 200 且无失败。初始化请求另记。

请求窗口从调用 `measure()` 前开始，包含建立 CDP 会话和读取初始指标的开销；browser/React 窗口在随后安装浏览器 observer 时才开始，到末尾两个 frame 后停止。两者起点不同，不能按相对时刻直接合并成同一时间轴。

CDP 累计指标窗口也比 browser/React 窗口宽，包含浏览器 observer 的安装与停止/读取开销；不能将其视为与 React 回调完全相同的区间。

指针拖拽默认严格要求 `completed`。对已确认在 lostpointercapture 后取消的场景，可显式传 `PERFORMANCE_EXPECT_DRAG=cancelled-after-lost-pointer-capture` 检查取消结果，并要求没有写请求。**取消与成功排序不可直接用于比较成功排序耗时**；比较成功排序时，两侧必须满足相同完成断言，可使用键盘排序场景。

## 双侧 React profiling 构建

普通 production 不包含 Profiler。用同一工具从两个明确 git commit 导出源码到新的 `/tmp` 目录，复用当前已安装依赖，构建到独立 `/tmp` dist：

```sh
node apps/web/scripts/performance-build.ts <before-commit> /tmp/profile-before-source /tmp/profile-before-dist
node apps/web/scripts/performance-build.ts <after-commit> /tmp/profile-after-source /tmp/profile-after-dist

PERFORMANCE_SKIP_BUILD=1 \
PERFORMANCE_DIST=/tmp/profile-before-dist \
PERFORMANCE_BUILD_METADATA=/tmp/profile-before-dist.build.json \
PERFORMANCE_OUTPUT=apps/web/test-results/performance/profile-before.json \
PERFORMANCE_EXPECT_DRAG=cancelled-after-lost-pointer-capture \
node apps/web/scripts/performance-docker.ts

PERFORMANCE_SKIP_BUILD=1 \
PERFORMANCE_DIST=/tmp/profile-after-dist \
PERFORMANCE_BUILD_METADATA=/tmp/profile-after-dist.build.json \
PERFORMANCE_OUTPUT=apps/web/test-results/performance/profile-after.json \
node apps/web/scripts/performance-docker.ts
```

导出目录必须尚不存在，避免复用被改过的源码。构建工具对两侧精确 alias `react-dom/client` 到 `react-dom/profiling`，把相同 `Profiler(id=App)` 放在 `StrictMode` 与 `App` 之间，只在测量窗口收集。覆盖层不写入任何生产源码或正常构建。该方法遵循 [React profiling build 文档](https://react.dev/reference/dev-tools/react-performance-tracks)；字段含义见 [Profiler 文档](https://react.dev/reference/react/Profiler)。两侧 profiling 数据单独比较，不与普通生产构建的样本混算。

## 指标、追溯与输出

- `react.committedUpdates`：App 边界在窗口内提交更新的回调数，包含 `update` / `nested-update`。它不是所有组件函数调用次数，也不包含未提交的尝试。
- `react.actualDurationSumMs`：窗口内各次已提交子树更新的 `actualDuration` 之和；逐次 `id/phase/actualDuration/baseDuration/startTime/commitTime` 原值均保留。它不是 commit 阶段或浏览器 paint 耗时。profiling 本身有额外成本。
- `browser.durationMs`：输入到完成的真实耗时，含自动化与断言开销；日志包含剩余轮询等待，不能叫纯渲染耗时。
- `browser.*Mutations` 与节点增删：body 子树的 DOM observer 记录，移动也会表现为增删；不是 React render/commit。
- `browser.longTasks`：窗口内浏览器报告的 longtask 时长；空数组不能推断所有设备均流畅。
- `cdp.*DurationMs`：Chromium 累计指标的窗口差；Task 包含 Script 等工作，不能相加。layout/style 次数也不是 React 次数。
- `requests`：真实发出的 API 路径、method、status、相对时刻、完成耗时、body SHA 与业务摘要；fixture 延时不能代表真实后端或公网性能。`setupRequests` 另记初始化端点计数。

输出仅允许位于被 Git 忽略的 `apps/web/test-results/performance/`。全部 25 个有效样本、每类恰好 5 个才原子替换目标 JSON；失败或筛选的 smoke 不产生完整证据。源码 commit、导出 archive SHA、构建方式、覆盖层 SHA、dist/fixture/harness SHA、生产输入和证据脚本是否有未提交改动、依赖版本、镜像 ID、浏览器与宿主信息均登记。dist SHA 使用相对于 dist 根的排序路径、NUL 分隔符和内容；比较不同构建时必须使用一致的摘要规则。

每次采样的数据集应另行标记源码提交、构建参数及采样条件，不把不同完成语义或计时协议的结果直接混为性能对照。5 次采样没有硬编码速度阈值，不证明统计显著，也不覆盖大队列、慢设备、真实服务端或公网。

入口由现有 TypeScript 和 lint 门禁覆盖：

```sh
pnpm --filter la-pluma-next-client type-check
pnpm --filter la-pluma-next-client exec oxlint --deny-warnings tests/performance scripts/performance-build.ts scripts/performance-docker.ts tests/visual/static-server.ts
```
