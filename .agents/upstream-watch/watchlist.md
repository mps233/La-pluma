# 上游监控清单

每周巡检的对象。`installed` 尽量写**实际安装/锁定**的版本，不是 `package.json` 的范围。

## 高价值（每周）

| target | repo | installed | channel | 我们怎么用 | 关注点 |
| --- | --- | --- | --- | --- | --- |
| MaaCore | MaaAssistantArknights/MaaAssistantArknights | 6.21.4 | stable release | 所有 MAA 任务、回调、资源查找 | 任务类型、回调协议、资源结构；跳过 WPF/GUI/OCR 条目 |
| maa-cli | MaaAssistantArknights/maa-cli | 0.7.8 | stable release（跳过 nightly） | scheduler/activity/copilot/mastery 解析命令输出 | 命令、flag、`maa run` JSON 结构、stderr 分类 |
| scrcpy server | Genymobile/scrcpy | 3.3.4（pin） | release + tags + jar 资产 | `go/internal/infra/scrcpy/protocol.go` 手写协议 | server 选项、握手、control message ID、clipboard framing |
| mygo | egoist/mygo | v0.8.3 | release | 桌面壳 `go/main.go` | 单实例锁、App Nap/KeepRunning、Tray、flyout |
| islandcn | opencoredev/islandcn | vendored 本地 | registry JSON + HEAD | `client/src/components/islandcn/`、`client/src/lib/island/` | 上游 registry item 变化、与本地 patch 冲突 |
| pion/webrtc | pion/webrtc | v4.2.26 | release（v4 维护线） | WebRTC 推流 | sender/codec/RTCP 修复；v5 单独 breaking lane |
| liquid-glass | zakisheriff/Liquid-Glass | 0.3.20 | npm registry + tags | `@zakisheriff/liquid-glass`，14 处 | API 新增/破坏、iOS Safari 视觉回归 |
| vite | vitejs/vite | 6.4.3 | release（v6 线） | 构建 | v6.x 修复；v8 单独 breaking lane |
| TypeScript | microsoft/TypeScript | 5.9.3 | release | 全量类型检查 | 与 typescript-eslint peer 一起判断可行性 |
| typescript-eslint | typescript-eslint/typescript-eslint | 8.63.0 | release | lint | peer 上限决定 TS 大版本能否升 |
| vitest | vitest-dev/vitest | 4.1.10 | release（v4 线） | 63 个测试文件 | breaking 行为、coverage-v8 同步 |
| tailwindcss | tailwindlabs/tailwindcss | 3.4.19 | release（3.4 线） | `className` 与 token | v4 是 CSS-first 重写，单独立项 |
| react | facebook/react | 19.2.4 | release | 129 个文件 | ViewTransition 等新 API；@types 同步 |

## 中价值（每月或按 release）

| target | repo | installed | 关注点 |
| --- | --- | --- | --- |
| motion | motiondivision/motion | framer-motion 12.34.0 | 无 GitHub Release，用 compare + `packages/framer-motion` 过滤 |
| Lisse | JaceThings/Lisse | 0.5.2 | 过滤 `@lisse/react@*`；API 断裂会静默退化 |
| zustand | pmndrs/zustand | 5.0.11 | persist/devtools 行为；当前误放在 devDependencies |
| budoux | google/budoux | 0.10.2 | 简体/繁体分词模型 |
| lucide | lucide-icons/lucide | 1.23.0 | 图标新增；发布很频繁 |
| MaaResource | MaaAssistantArknights/MaaResource | 热更新 | 无 release，看 commit 与 resource 结构 |
| ArknightsGameData | Kengxxiao/ArknightsGameData | 未 pin | 无 release，看表结构变化 |
| hugeicons | hugeicons/hugeicons | 1.1.10 | 无 GitHub Release，看 npm |

## 低价值（季度或仅安全）

gorilla/websocket、pelletier/go-toml、ebitengine/purego、golang.org/x/{image,sys,text}、
ADB platform-tools（非 GitHub repo）、长尾构建工具。

## 判定规则

1. **先看版本真相**：npm 用 registry dist-tags/time；Go 用 proxy.golang.org；GitHub Release 只作说明。
2. **双过滤 prerelease**：GitHub `prerelease` 标记不可信，再按 semver 后缀判断。
3. **monorepo 过滤**：按 tagPrefix / pathFilter 只看我们用的包。
4. **首跑静默**：第一次扫描只建立基线，不产生通知。
5. **只读**：巡检不升级、不改代码、不触发 MAA/ADB/scrcpy。
6. **verdict 三选一**：`adopt`（建议跟进）、`watch`（观察）、`ignore`（无关）。
7. **每条都要落到具体文件**：`affectedFiles` 必须来自实际 grep，不许猜。
8. **升级耦合**：Vite+plugin-react、TS+typescript-eslint、Vitest+coverage-v8、Tailwind 4 一次性判断。
