# GitHub Actions 配置说明

`ci.yml` 是 PR、main、版本 tag 和手动运行的统一入口；`container-build.yml` 复用两个架构的镜像构建和启动检查。

## 检查与发布

| 触发 | 执行内容 |
| --- | --- |
| PR、手动运行分支 | 源码、独立类型门禁、覆盖率、样式预算、浏览器集成；并行构建及启动 amd64、arm64 镜像，不推送 |
| main 推送 | 源码、独立类型门禁、覆盖率、样式预算、浏览器集成，不构建镜像 |
| `v*` tag | 源码校验与原生双架构构建并行；启动检查和 `verify` 通过后合并并发布镜像 |

`push`（main）通过 `paths-ignore` 排除 `docs/**`、`screenshots/**`、`**.md` 和 `LICENSE`；仅这些文件变更时不触发工作流。PR、tag 推送和手动运行不受路径过滤影响。

源码检查按职责并行：`checks` 校验工作流与发布 tag，`client-checks` 运行客户端护栏、Lint、单测和样式预算，`client-build` 运行客户端类型检查、生产构建与预缓存校验，`server-checks` 运行服务端护栏、语法、类型和覆盖率测试。本地 `pnpm verify` 保持原有入口；CI 使用上述独立步骤，避免重复运行服务端测试与类型检查。

`browser-checks` 只依赖 `client-build`，通过当前工作流的 `client-dist` artifact 复用 `apps/web/dist/` 下的前端产物，不等待客户端单测或服务端检查。产物缺失直接失败；集成入口跳过重建，保持单 worker 与全部用例。tag 发布不上传浏览器产物，也不重复运行 PR/main 的浏览器检查。

源码检查与镜像检查的宿主机 Node 版本在两个工作流中固定，并保持一致。该版本包含 [Node 测试运行器的反序列化修复](https://github.com/nodejs/node/pull/64706)，避免测试输出中的中文或 emoji 触发进程通信错误。更新版本时同时复核普通测试与覆盖率模式；应用运行时下限仍由根 `package.json` 的 `engines` 定义。

服务端类型门禁先断言 `pnpm --filter la-pluma-next-server exec tsc --version` 输出 `Version 6.0.3`，再运行一次 `typecheck`。`test:coverage` 执行完整服务端测试，保留逐文件进程隔离与串行，并同时检查测试结果和覆盖率阈值；CI 不再额外运行普通 `test`。

分支保护继续要求 **`verify`**。它要求四项源码检查成功；非 tag 还要求浏览器检查成功，PR/手动分支运行要求普通双架构构建成功，tag 要求发布双架构构建成功。任何必需任务失败、取消或意外跳过均阻止通过，包括前端构建失败导致浏览器任务跳过。PR 新提交取消旧运行；tag 发布不自动取消正在执行的同 tag 运行。

`checks` 校验发布 tag 与根 `package.json` 版本一致、提交已进入 `origin/main`。版本提升和打 tag 的步骤见[维护说明](../../docs/development/maintaining.md#发布流程)。

## 镜像标签

镜像地址为 `ghcr.io/<仓库所有者的小写名称>/<仓库名的小写名称>`。标签由 `docker/metadata-action` 的 semver 规则生成：正式版 `v0.0.6` 生成 `0.0.6`、`0.0`、`0` 和 `latest`；预发布如 `v0.1.0-rc.1` 只生成完整版本标签。

发布使用 `docker buildx imagetools create` 合并两个已验证的平台 digest。遵循 Docker 的普通可变标签语义，重跑会重新构建并更新对应标签；补发旧正式版本也会更新 `latest` 等别名。需要固定具体内容时使用 digest。

默认仅有 `contents: read`，只有 `release-build` 和 `publish` 申请 `packages: write`，使用内置 `GITHUB_TOKEN`，无需额外 secret。

## 容器与缓存

两个架构分别使用 `ubuntu-26.04`、`ubuntu-26.04-arm` 原生 runner，避免 QEMU。Dockerfile 的前端阶段固定为 `$BUILDPLATFORM`。

`scripts/ci/smoke-image.mjs IMAGE [--base-path /la-pluma-next/]` 在镜像内验证：

- 运行时内容：真实 `maa --version`、Node 版本下限、镜像不含 TypeScript 编译器与 `@types/*` 开发类型包，且 `node --check` 能直接解析 TS 入口；
- 根路径与子路径：前端产物位于配置的 base path、深链接回落应用壳、`/health` 与 `/readiness`、API 鉴权（401/200）、未知 API 路由的稳定错误码、`/webrtc-signaling` 隐藏端点与无票据 WebSocket 升级被拒绝；
- HTTPS：自签名证书下重复上述检查，并确认同一端口不再应答明文 HTTP；
- 旧数据卷：预置旧版用户配置与 Run 存储后启动、通过 HTTP 读取，优雅停止后文件仍在且配置未被改写。

每个场景都使用临时数据、`--network=none` 和设备访问禁用，并用 MaaCore 存在性 fixture 避免首次启动下载。`container-build.yml` 为子路径单独构建一个只加载、不推送的变体，仅用于上述冒烟；冒烟通过后才导出平台 digest，发布合并仍只使用已验证 digest。普通 fixture 不代表真实设备已验证。

构建读取 GHCR 的 `buildcache-amd64`、`buildcache-arm64`，只有发布任务写入。缓存缺失可冷构建，缓存导出失败不阻断镜像发布。Dockerfile 的 cache mount 只复用同一本地 builder，不自动进入外部层缓存。首次发布后，在 GitHub Package settings 中将镜像设为 Public，供用户和 fork PR 匿名读取。

## 本地复现

先使用与 `ci.yml` 相同的 Node 版本。覆盖率脚本在失败时也等待诊断输出完整写出，再以非零状态退出。

```bash
actionlint
pnpm --filter la-pluma-next-client guardrails
pnpm --filter la-pluma-next-client lint
pnpm --filter la-pluma-next-client test
pnpm --filter la-pluma-next-client build
pnpm --filter la-pluma-next-client stylelint:ratchet
pnpm --filter la-pluma-next-server guardrails
pnpm --filter la-pluma-next-server check
pnpm --filter la-pluma-next-server exec tsc --version
pnpm --filter la-pluma-next-server typecheck
pnpm --filter la-pluma-next-server test:coverage

# 先拉取与已安装 Playwright 匹配的镜像
INTEGRATION_SKIP_BUILD=1 pnpm --filter la-pluma-next-client test:integration

# 只在本机构建和检查，不推送
docker buildx build --load --platform linux/amd64 -t la-pluma-next:ci .
node scripts/ci/smoke-image.mjs la-pluma-next:ci

# 子路径构建单独冒烟（HTTPS 场景需要本机 openssl 生成一次性自签名证书）
docker buildx build --load --platform linux/amd64 \
  --build-arg VITE_BASE_PATH=/la-pluma-next/ -t la-pluma-next:ci-subpath .
node scripts/ci/smoke-image.mjs la-pluma-next:ci-subpath --base-path /la-pluma-next/
```
