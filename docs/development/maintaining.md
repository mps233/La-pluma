# 维护说明

> [← 返回文档索引](../README.md)

La Pluma Next 是 [mps233/La-pluma](https://github.com/mps233/La-pluma) 的社区维护分支，自 2026-10 起独立维护，不再跟随上游分支。

## 分支与合并

- `main` 是集成分支，已开启分支保护，要求 `verify` 状态检查通过，并禁止 force push 和删除。该汇总门禁定义在 `.github/workflows/ci.yml`，同时约束源码、浏览器和适用的镜像检查；纯文档变更合入 main 时不再重复触发 CI。
- 日常改动使用主题分支，通过 Pull Request 合并。

## 发布流程

1. 在主题分支提升根目录 `package.json` 版本，通过 Pull Request 合入 `main`。子包不参与发布，保持 `0.0.0`。先只修改版本，不创建 tag，避免 squash 合并后 tag 指向未进入 main 的旧提交：

   ```bash
   pnpm version patch --no-git-tag-version
   ```

   也可以显式指定版本（例如 `pnpm version 0.1.0-rc.1 --no-git-tag-version`）。

2. 合并后更新本地 main，再为该提交创建并推送 annotated tag：

   ```bash
   git switch main
   git pull --ff-only origin main
   release_version=$(node -p "require('./package.json').version")
   git tag -a "v${release_version}" -m "Release v${release_version}"
   git push origin "v${release_version}"
   ```

3. CI 校验根版本及 main 归属，并行运行源码校验和原生双架构构建、启动检查。`verify` 汇总通过后发布多架构镜像，不重复运行 PR/main 的浏览器检查。正式版更新完整版本、主次版本别名及 `latest`；预发布只产生完整版本标签。标签可覆盖，补发旧正式版本也会更新别名。
4. 在 GitHub Releases 中补充变更说明。

检查、权限、缓存和发布标签的规则见[工作流说明](../../.github/workflows/README.md)。main 推送不发布镜像，手动运行分支也只验证。

## 容器镜像

- 镜像地址：`ghcr.io/dongwlin/la-pluma-next`
- 首次发布后，在 GitHub Package settings 中把镜像可见性设为 `Public`；私有镜像拉取前需要 `docker login ghcr.io`。

## 兼容性标识

项目名称已改为 La Pluma Next，但以下内部标识保持不变，避免破坏已有部署和配置：

- 环境变量前缀 `LA_PLUMA_*`
- CSS 类名 `la-pluma-*`、localStorage key `la-pluma-*`
- HTTP 头 `x-la-pluma-*`
- Agent API 标识 `la-pluma-agent-api`

## 外部运行时依赖

WebRTC 安装会从 `hqw700/ScrcpyOverWebRTC` 的 GitHub Release 下载 `cloudphone-v0.4.1.zip`，并校验固定 SHA-256。为保证长期可安装，建议把该压缩包镜像到本仓库的 Release，并在上游资产失效时更新 `apps/server/src/services/webrtcRuntime.ts` 中的 `RELEASE_URL`。

## 项目文档与过程档案

主仓库只维护现行架构、公开契约、兼容约束、开发/运维方法及可复现测试入口。阶段计划、任务交接、实施日志、逐项验收和一次性测试结果属于过程档案，在仓库外的私有工作区维护，不提交到主仓库。需要长期保留的结论应独立转写为当前约束，并由实现或回归测试支持。

性能采样结果默认写入 Git 忽略的 `apps/web/test-results/performance/`；长期文档只描述采样方法与指标限制，不能把某次基准数据当作未来版本的持续保证。

### 公开文档准入

默认更新下表中的已有归属，不要求每项改动都新增或修改文档。新增文档须同时满足：

1. 对没有读过私有计划或会话的维护者仍有独立、长期的使用价值。
2. 描述实现或测试支持的当前规则、公开接口、兼容要求或可复现方法。
3. 已有主题无法合理容纳，并明确后续维护归属和导航入口。
4. 删除任务次序、负责人、私有标识、某次通过数和机器采样后，正文仍然成立。

过程原稿保留在私有工作区；其中的长期结论按主题提炼，不整篇换名入库。复核已有文档时按实际内容判断，保留有效架构、接口和兼容说明。

### 提交前复核

- 核对暂存文件、完整差异、新增文档及拟用分支、提交说明和 PR 文案。公开文档变更说明其现行用途；没有公开规则变化时无需补写过程报告。
- 检查范围覆盖源码与注释、测试与 fixture、文档、文件名及上述文案。私有任务编号、工作区路径、交接状态和会话标识不得进入这些位置；识别具体私有标识的规则和检查结果仅保存在私有工作区。
- 注释与公开说明使用实际职责、当前所有者、公开问题或提交及可复现入口。固定版本的历史材料按交付提交复核；治理当前文件不要求重写 Git 历史。

### 文档归属与单一事实来源

修改约定时更新下列归属文档；概览只保留必要摘要与链接，不复制参数表、状态机或完整映射。同一领域的面板、模型和命令集中维护，章节之间直接引用。

| 信息 | 维护位置 |
| --- | --- |
| 安装与快速开始 | 根 [README](../../README.md) |
| 界面视觉、交互与设计 token | 根 [DESIGN.md](../../DESIGN.md)；[组件库](../frontend/components.md)只维护组件 API 和用法 |
| 系统技术栈与目录结构 | [整体架构](../architecture/README.md) |
| 前端分层、状态所有者、URL 与 Activity | [前端架构](../frontend/README.md) |
| 主题注册、三层模型、`data-theme` 与新增主题契约 | [主题系统](../frontend/themes.md) |
| Agent 对接流程与鉴权 | [Agent API](../api/agent.md) |
| 服务端 Run 协议 / 前端控制器 | [执行生命周期](../architecture/execution-lifecycle.md) / [执行客户端](../architecture/execution-client.md) |
| 服务端分层与请求契约 | [服务端架构与请求契约](../server/README.md) |
| 服务端组装启动、就绪与关闭 | [运行时初始化、就绪与关闭](../server/runtime-lifecycle.md) |
| 运行数据位置、写入与恢复 | [持久化与运行数据](../server/persistence.md) |
| 日常流程计划与定时触发 | [日常流程与定时触发](../server/scheduling.md) |
| MAA/ADB 集成与通知渠道 | [MAA、ADB 与通知渠道](../server/integrations.md) |
| 设备预览链路与信令网关 | [设备预览与信令运行时](../server/preview-webrtc.md) |
| 三域配置 key、wire、pending 与完整提交 | [配置持久化](../architecture/config-persistence.md) |
| 请求错误与取消 / Query key 与缓存策略 | [资源请求](../architecture/resource-requests.md) / [Query 缓存](../architecture/query-cache.md) |
| 共享资源所有权、跨域失效作用域与收发映射 | [资源归属与失效端口](../architecture/resource-ownership.md) |
| 旧入口消费者、支持窗口与移除条件 | [兼容入口](../frontend/compatibility.md) |
| 领域特有的面板、命令、竞态与回归 | 各领域文档；通用规则链接到上述契约 |
| 日常检查、集成场景与性能方法 | [开发指南](README.md)、[跨页集成](integration.md)、[性能采样说明](../../apps/web/tests/performance/README.md) |

文件移动或合并时，同步修复索引、相对路径、章节锚点和源码/脚本中的文档引用。已完成任务的历史证据应固定到交付提交，避免用当前路径冒充仍在维护的文档；不为旧路径建立第二份正文或长期占位文件。
