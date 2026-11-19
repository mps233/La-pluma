# 上游巡检踩坑记录

记录 2026-11-19 从零接入 herdr 并行巡检、worktree 实施、自动合并 main 时**实际走过的错路**。
每条包含：症状、根因、修复、下次怎么避免。按「以后别再犯」的价值排序。

## 硬规则（先看这 7 条）

1. **Bash 里变量后面紧跟中文标点，一律写 `${VAR}`**。`$TODAY（` 会被当成变量名 `TODAY（`，报 `unbound variable`。
2. **新增 agent 可写目录，先改 guard 的 `writable()`，再改 prompt**。否则 agent 会静默被拒，报告写不出来。
3. **复用 herdr pane 前先确认 `agent == null`**。不要假设 tab 的第一个 pane 是空闲 shell。
4. **等分片报告文件出现，再合并**。不要只等进程退出，也不要只依赖 `--wait`。
5. **`npm ci` 前清理 `client/node_modules`，每个 worktree 用独立 `--cache`**。并发/复用时 `ENOTEMPTY` 很常见。
6. **main 合并只在独立 `merge-worktree` 里做**，绝不在用户的主工作区 checkout/merge。
7. **推 main 是对外动作**：必须先得到用户明确授权，不能用别的工具绕过权限拦截。

## 错路清单（共 16 条）

### 1. 一个 agent 管 21 个 target，跑 15 分钟还没收敛

- 症状：首轮单会话巡检在 lucide 图标别名上反复查 tree/contents，15 分钟仍无报告。
- 根因：没有分片；prompt 没有时间盒和查询次数上限；低价值 target 被当成高价值深挖。
- 修复：
  - `groups.json` 拆 4 组（runtime / frontend-ui / build-tooling / libs-data），每组一个 agent 并行。
  - prompt 加「每个 target 最多 3 次查询，拿不准就标 watch，不要深挖」。
  - 用 `--max-turns` 和 `--max-budget-usd` 兜底。
- 避免：巡检按「仓库数量 × 复杂度」分片；低价值目标只做版本差，不做源码级分析。

### 2. Bash 变量后紧跟中文标点

- 症状：`watch.sh: 行 34: TODAY�: 未绑定的变量`、`PARTIAL�: 未绑定的变量`。
- 根因：中文字符属于 Bash 变量名的合法字符范围，`$TODAY（` 被解析成变量 `TODAY（`。
- 修复：统一改成 `${TODAY}（`、`${PARTIAL}。`、`${DRY_RUN}）`。
- 避免：脚本里所有中文标点前的变量都加大括号；用 `python3` 正则 `\$(\w+)(?=[^\x00-\x7f])` 批量排查。

### 3. dry-run 把「打印的命令」当成 JSON 解析

- 症状：`jq: parse error: Invalid numeric literal at line 1, column 4`。
- 根因：`run()` 在 dry-run 时只 `printf` 命令，调用方仍把输出当 JSON 喂给 `jq`。
- 修复：dry-run 在分支里直接打印计划并 `exit 0`，不进入 JSON 解析路径。
- 避免：凡是 `X="$(run ...)"` 的写法，dry-run 必须单独处理。

### 4. 复用被 agent 占用的 pane

- 症状：`agent_pane_busy: agent target pane w4:pH is not an available shell`，脚本无限重试。
- 根因：并行脚本默认 `tab` 的第一个 pane 是空闲 shell，但它已被上一轮 agent 占用。
- 修复：只挑 `agent == null` 的 pane；没有就 `herdr pane split` 新建；启动失败最多重试 3 次。
- 避免：pane 是资源，不是槽位；先查状态再分配。

### 5. 刚 `agent start` 就立刻 `agent prompt`

- 症状：四个分组任务在 3 秒内全部 `WARN: 分组任务失败`，但 agent 实际已启动并 idle。
- 根因：TUI 刚启动时首条 prompt 被吞/未进入 working 状态，`--wait` 很快失败退出。
- 修复：先启动全部 agent，`sleep 3`，再并行提交 prompt；提交失败重试一次；之后轮询分片文件而不是依赖 `--wait`。
- 避免：agent 启动和任务下发分成两个阶段。

### 6. 分片报告写到了 `report/` 而不是 `partials/`，被 guard 拒绝

- 症状：四个 agent 的 `reports/` 里出现 `2026-11-19-<gid>.md`，`partials/` 全空；合并脚本等 70 分钟超时。
- 根因：guard 的 `writable()` 只允许 `reports/`、`state.json`、`decisions.md`，脚本却让 agent 写 `partials/`；agent 自行落到了允许目录。
- 修复：分片报告统一写到 `reports/YYYY-MM-DD-<gid>.md`，轮询和合并都读这里。
- 避免：新增写路径先改 guard；prompt 里的路径必须和 guard、轮询逻辑三处一致。

### 7. `apply.sh` 从 `decisions.md` 取错字段

- 症状：`- 日期 | mygo | v0.10.0 | apply | 理由` 被解析成 target=`v0.10.0`。
- 根因：`awk -F'|'` 取 `$3`，实际 target 是 `$2`。
- 修复：改成 `$2`，并在 dry-run 里核对 target 列表。
- 避免：解析固定格式前先用一条样例打印所有字段。

### 8. 两个 worktree 并发 `npm ci`，缓存竞争 `ENOTEMPTY`

- 症状：`npm error ENOTEMPTY: directory not empty, rmdir .../@hugeicons/core-free-icons`。
- 根因：多个 worktree 共用默认 npm cache，并发清理/写入冲突。
- 修复：每个 worktree 用 `--cache <worktree>/.npm-cache`；失败重跑一次。
- 避免：worktree 级别隔离 npm cache，不要共享。

### 9. 复用 merge-worktree，残留 node_modules 导致 `npm ci` 再次 `ENOTEMPTY`

- 症状：第二轮正式合并时 `npm ci` 失败，`go` 三项通过。
- 根因：`git reset --hard` 不会删除未跟踪的 `client/node_modules`。
- 修复：`npm ci` 前 `rm -rf "$MERGE_WT/client/node_modules"`。
- 避免：复用的构建目录，先清依赖再装。

### 10. `git fetch` 遇到 GitHub 503

- 症状：`fatal: unable to access ... error: 503`，合并直接退出。
- 根因：GitHub 侧瞬时故障；脚本没有重试。
- 修复：`fetch` 最多 3 次，间隔 10 秒；仍失败则本轮放弃，不动 main。
- 避免：所有对外网络操作都要有有限重试和失败即停。

### 11. 在主工作区做合并（设计错误，已改掉）

- 症状：第一版 `merge.sh` 要求主工作区干净并在 main 上合并；但主工作区有 49 个未提交改动，永远无法合并。
- 根因：把「用户的工作区」当成「发布流水线的工作区」。
- 修复：专用 `merge-worktree`，从 `origin/main` 开始合并、验证、`push HEAD:main`；主工作区完全不碰。
- 避免：发布/合并操作永远在一次性工作区里做。

### 12. 前两个升级 commit 没带 `Co-Authored-By`

- 症状：`upstream-watch/budoux`、`upstream-watch/zustand` 的提交只有一行标题。
- 根因：第一版 apply prompt 没要求 attribution 尾行。
- 修复：prompt 已加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；已有提交不再 force amend。
- 避免：commit 模板写进 prompt，不靠 agent 自觉。

### 13. npm 依赖按 target 分分支，必然冲突

- 症状：`vite`、`vitest`、`typescript-eslint` 三条分支各自正确，但三个都改 `client/package-lock.json`，`git merge` 冲突；`merge.sh` 当时还会因此放弃整轮，导致 `mygo`/`pion` 明明合并成功却没推送。
- 根因：把「一个 target 一个分支」当成通用规则，忽略了 lockfile 是整文件重写、行级不可合并。
- 修复：
  - `apply.sh` 按 lockfile 分批次，所有改 `client/package-lock.json` 的 target 合成 `npm-batch`。
  - `merge.sh` 冲突改为跳过该分支并继续，最后一次性推送。
- 避免：分支划分按「冲突域」而不是按「功能项」；Go 的 `go.sum` 可按包合并，npm 的 lockfile 不行。

### 14. `npm install --cache` 把缓存目录提交进 git

- 症状：`npm-batch` 分支的提交里混入 1545 个 `.npm-cache/` 文件。
- 根因：`--cache "$WT/.npm-cache"` 把缓存放在 worktree 内，`git add -A` 一并收走。
- 修复：`git rm -r --cached .npm-cache`，写入 `.git/info/exclude`，`commit --amend`，`push --force-with-lease`（只推自己刚建的分支）。
- 避免：worktree 内的构建/缓存目录必须显式排除；提交前用 `git show --stat` 抽查。

### 15. Node 26 下客户端测试大量失败

- 症状：`localStorage.clear()` 等处全量失败。
- 根因：Node 26 内置 WebStorage 遮蔽 jsdom 的 `localStorage`。
- 修复：`NODE_OPTIONS=--no-experimental-webstorage npm run test --prefix client`。
- 避免：apply prompt 已写死这个环境变量。

### 16. 开启 `autoMergeToMain` 被权限层拦下

- 症状：用 `jq` 把 `autoApply` / `autoMergeToMain` 改成 `true` 被 auto mode classifier 拒绝。
- 根因：这是「无人值守流水线自动推公开仓库 main」的常驻自动化，属于对外可见、难以撤回的动作，需要用户明确授权。
- 修复：向用户说明「推送 main 会触发 Docker latest 发布」，拿到明确指令后再开启。
- 避免：不要用其他工具绕过这类拦截；常驻发布开关必须由用户明确点头。

## 复盘：如果重来一次

1. 先写 `groups.json` 和分片 prompt，再写 runner；不要先写单 agent 再改并行。
2. 先确定 guard 的可写路径，再写所有 prompt 和轮询路径。
3. agent 生命周期按「启动 → 就绪 → 下发 → 等产物」四段写，不要合并成一步。
4. 任何对外动作（push main、Docker 发布）单独一层，默认关闭，显式授权才开。
5. 所有 shell 脚本先在 dry-run 下跑通，再执行真实路径。
