# 上游巡检（Upstream Watch）

每周自动检查 La Pluma 用到的 GitHub 仓库和外部工具是否有更新，读懂改了什么，判断要不要跟进。
**全程只读**：不升级依赖、不改代码、不执行任何 MAA/ADB/scrcpy 副作用。

## 结构

| 路径 | 作用 |
| --- | --- |
| `watchlist.md` | 人工维护的监控清单与判定规则 |
| `prompt.md` | 每轮交给巡检 agent 的只读指令 |
| `apply-prompt.md` | 实施 agent 的改代码、验证、提交、推送指令 |
| `decisions.md` | 人工裁决（adopt / watch / ignore / apply / done） |
| `state.json` | 机器状态：版本基线、上次运行、tab 与 agent 名、开关 |
| `groups.json` | 巡检分组，决定并行组数与每组 target |
| `reports/` | 主报告、分组报告、执行记录与 `apply-*.json` |
| `hooks/guard.cjs` | 巡检阶段 PreToolUse 守卫（纯只读） |
| `hooks/apply-guard.cjs` | 实施阶段守卫（只写 worktree、只推 upstream-watch/*） |
| `claude-settings.json` / `apply-settings.json` | 把对应守卫挂进 Claude Code |
| `bin/watch.sh` | 巡检入口：并行分发、合并报告 |
| `bin/apply.sh` | 实施入口：处理 decisions.md 里的 apply 条目 |
| `bin/merge.sh` | 合并入口：merge-worktree 内合并、验证、推 main |
| `bin/daily.sh` | 每日流水线：巡检 → 实施 → 合并 |
| `AGENTS.md` | 给后续 agent 的硬规则与目录约定 |
| `TROUBLESHOOTING.md` | 接入过程中实际走过的 16 条错路 |
| `logs/` | 运行日志 |

## 两阶段工作流

```
每天 09:07
  ├─ 巡检（只读，4 组并行）→ reports/YYYY-MM-DD.md
  ├─ 实施（decisions.md 有 | apply | 时）→ worktree → 测试 → commit → push 分支
  └─ 合并（autoMergeToMain=true 时）→ merge-worktree → 全量验证 → push main
```

1. 巡检 agent 在 `Upstream Watch` tab 里 4 组并行跑，产出报告。
2. 你在报告某条目下加 `| apply |`，或在 `decisions.md` 写一行：
   ```
   - 2026-11-20 | mygo | v0.10.0 | apply | 升级并接入 KeepRunning
   ```
3. `apply.sh` 为每个 apply target 在 `.agents/upstream-watch/worktrees/<target>`
   建隔离 worktree 与分支，升级、跑全量测试、提交、推送到 `origin/upstream-watch/<target>`。
4. `merge.sh` 在 `.agents/upstream-watch/merge-worktree` 里把本轮 `status: ok`
   的分支合并到 `origin/main`，跑完整验证（go build/test/vet + npm ci/lint/type-check/test/build），
   全绿后推一次 `main`。冲突、验证失败、或改动包含 `.github/`、`data/`、`go/build/`、`.env*` 时拒绝推送。

**主工作区始终不被改动。**

## 合并开关

| 配置 | 效果 |
| --- | --- |
| `autoApply: false` | 只巡检，不改代码 |
| `autoMergeToMain: false` | 改代码并推分支，但不合并 main |
| `autoMergeToMain: true` | 自动合并并推 main（会触发 Docker `latest` 镜像发布） |

手动模式：

```bash
bash .agents/upstream-watch/bin/merge.sh --dry-run   # 只看候选
bash .agents/upstream-watch/bin/merge.sh --no-push   # 合并 + 验证，不推送
bash .agents/upstream-watch/bin/merge.sh             # 正式合并并推送
```

## 首次使用

```bash
cd /Users/miaopasi/La-pluma
bash .agents/upstream-watch/bin/watch.sh --dry-run   # 打印将要执行的命令
bash .agents/upstream-watch/bin/watch.sh             # 真跑一次
```

## 安装 launchd（每天 09:07）

```bash
cp .agents/upstream-watch/bin/com.mps233.lapluma.upstream-watch.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mps233.lapluma.upstream-watch.plist
launchctl print gui/$(id -u)/com.mps233.lapluma.upstream-watch | grep -A3 arguments
launchctl bootout gui/$(id -u)/com.mps233.lapluma.upstream-watch       # 卸载
```

## 在 herdr 里看什么

巡检固定使用 `La-pluma` workspace 里的 `Upstream Watch` tab。
tab 和 agent 都常驻，每轮任务复用同一个 pane，完整对话可直接回看：

```bash
herdr tab list --workspace w4 | jq -r '.result.tabs[] | select(.label=="Upstream Watch")'
herdr agent list | jq -r '.result.agents[] | select(.name=="upstream-watch")'
herdr agent read upstream-watch --source recent-unwrapped --lines 200
```

## 只读保证

`bin/watch.sh` 启动 Claude 时使用：

- `--permission-mode dontAsk`：需要确认的操作直接拒绝，不阻塞等待输入。
- `--settings .agents/upstream-watch/claude-settings.json`：加载 PreToolUse 守卫。
- 守卫（`hooks/guard.cjs`）的规则：
  - 只允许读取仓库内的文件。
  - 只允许写 `reports/`、`state.json`、`decisions.md`。
  - Bash 只允许 `gh api`（GET）、`gh release/search/repo`（只读）、
    `git log/show/diff/status`、`rg/grep/ls/jq/date/pwd`、以及监视目录内的 `mkdir`。
  - 禁止重定向、命令替换、`npm install`、`git fetch`、`touch`、`rm` 等。
- 不加载 WebFetch/WebSearch，避免 release notes 中的提示注入。

## 成本

单轮约 $0.1–0.5（Sonnet 级）。脚本传 `--max-budget-usd 2` 作为硬上限。

## 维护

- 新增监控目标：编辑 `watchlist.md`，并在 `state.json` 里留空条目即可。
- 调整频率：改 plist 的 `StartCalendarInterval`。
- 停用：`launchctl bootout ...`；或把 `state.json` 的 `enabled` 改成 `false`。
