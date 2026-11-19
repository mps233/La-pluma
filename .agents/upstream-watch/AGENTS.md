# 上游巡检：agent 指令与踩坑记录

Claude Code / agent 进入本目录工作时，先读这两份：

- [README.md](README.md)：流水线结构、三个开关、手动命令。
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)：2026-11-19 接入过程中实际走过的 16 条错路，含根因和修复。

## 给后续 agent 的硬规则

1. Bash 里变量后紧跟中文标点，一律写 `${VAR}`，否则报 `unbound variable`。
2. 新增可写目录时，先改 `hooks/guard.cjs` 或 `hooks/apply-guard.cjs` 的 `writable()`，再改 prompt，最后改轮询/合并路径——三处必须一致。
3. herdr pane 是资源不是槽位：分配前确认 `agent == null`，否则 `agent_pane_busy`。
4. agent 生命周期分四段：启动 → 就绪 → 下发 prompt → 轮询产物。不要把下发和等待合并成一步。
5. 每个 worktree 用自己的 npm cache（`--cache <worktree>/.npm-cache`），复用的 worktree 装依赖前先删 `node_modules`；
   并且 `.npm-cache/` 必须在提交前排除，否则会随 `git add -A` 进入提交。
6. **npm 依赖按 lockfile 批次，不按 target 分分支**：多个 npm 升级都会重写 `client/package-lock.json`，
   单 target 单分支必然冲突。`apply.sh` 已把改同一 lockfile 的 target 合并成 `npm-batch` 批次。
   Go 依赖（`go.sum` 行级可合）保持一个 target 一个分支。
7. 合并 main 只在 `merge-worktree` 里做，永远不碰用户主工作区。
8. 推送 main 会触发 Docker `latest` 发布，属于对外动作；除非用户明确授权，保持 `autoMergeToMain: false`。
9. 客户端测试必须带 `NODE_OPTIONS=--no-experimental-webstorage`（Node 26 的 WebStorage 会遮蔽 jsdom 的 localStorage）。

## 合并冲突策略

`merge.sh` 遇到冲突**不再中止整轮**：跳过该分支、继续合并其余，最后一次性推送；
被跳过的分支 JSON 标为 `conflict`，下一轮由实施阶段重建。

## 目录约定

| 路径 | 谁写 | 内容 |
| --- | --- | --- |
| `reports/YYYY-MM-DD-<group>.md` | 巡检 agent | 分组报告 |
| `reports/YYYY-MM-DD.md` | `watch.sh` | 合并后的主报告 |
| `reports/YYYY-MM-DD-applied-<target>.md` | 实施 agent | 人读执行记录 |
| `reports/apply-<target>.json` | 实施 agent | 机器读状态，`status` 决定能否合并 |
| `reports/YYYY-MM-DD-applied.md` | `apply.sh` | 所有执行记录合并 |
| `state.json` | `watch.sh` / `apply.sh` / `merge.sh` | 运行状态与开关 |
| `decisions.md` | 人 + `merge.sh` | `apply` 触发实施，合并后改成 `done` |

## 守卫的可写范围

- 巡检 agent（`hooks/guard.cjs`）：只读仓库；只写 `reports/`、`state.json`、`decisions.md`。
- 实施 agent（`hooks/apply-guard.cjs`）：只写 `worktrees/` 与上述报告路径；`git push` 只允许 `origin` 的 `upstream-watch/*`；禁止 `merge`/`checkout`/`rebase`/`reset`。
- 合并由 `bin/merge.sh` 独立执行，不经过 agent。
