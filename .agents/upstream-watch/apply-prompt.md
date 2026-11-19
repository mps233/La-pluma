# 上游巡检 · 实施阶段指令（改代码 / 提交 / 推送分支）

你是 La Pluma 的依赖升级执行者。只处理 `decisions.md` 里标记 `apply` 的 target。
**不要合并 main，不要推送 main。** 分支推送后由外层 `merge.sh` 做合并。

## 硬性边界

- 只在隔离 worktree 里改代码：`/Users/miaopasi/La-pluma/.agents/upstream-watch/worktrees/<target>`。
- 绝不修改 `/Users/miaopasi/La-pluma` 主工作区。
- 分支名：`upstream-watch/<target>`。
- 只推 `origin` 的 `upstream-watch/*` 分支。禁止 force push、禁止 `git merge`、禁止 `git push origin main`。
- 禁止 `git fetch`、`git pull`、`git rebase`、`git reset`。
- 不运行 `maa`、`adb`、`scrcpy`，不触发真实设备/账号副作用。
- 不改 `.github/`、`data/`、`go/build/`、`.env*`。

## 工作步骤

1. 读 `decisions.md` 里本 target 的 apply 行，以及报告里对应的 `###` 条目。
2. 建 worktree（绝对路径）：
   ```bash
   git worktree add -b upstream-watch/<target> \
     /Users/miaopasi/La-pluma/.agents/upstream-watch/worktrees/<target> main
   ```
3. 在 worktree 里升级依赖并适配代码：
   - Go：`go -C go get <module>@<version>`，再 `go -C go mod tidy`。
   - npm：`npm install <pkg>@<version> --prefix client --cache <worktree>/.npm-cache`。
   - worktree 没有 `client/node_modules` 时先：
     `npm ci --prefix client --cache <worktree>/.npm-cache`。
4. 跑验证（全部在 worktree 里）：
   ```bash
   go -C go test ./...
   go -C go vet ./...
   npm run lint --prefix client
   npm run type-check --prefix client
   NODE_OPTIONS=--no-experimental-webstorage npm run test --prefix client
   npm run build --prefix client
   ```
   - Node 26 必须带 `NODE_OPTIONS=--no-experimental-webstorage`，否则 jsdom 的 `localStorage` 会被遮蔽。
   - 任何一步失败：修复后重跑；修不动就停下，写失败记录，**不要提交半成品**。
5. 提交（在 worktree 里）：
   ```bash
   git add -A
   git commit -m "chore(deps): bump <target> to <version>"
   ```
   提交消息末尾加一行：
   `Co-Authored-By: Claude Code <noreply@anthropic.com>`
6. 推送分支：
   ```bash
   git push -u origin upstream-watch/<target>
   ```
7. 写两份记录：
   - 人读：`/Users/miaopasi/La-pluma/.agents/upstream-watch/reports/<日期>-applied-<safe>.md`
   - 机器读：`/Users/miaopasi/La-pluma/.agents/upstream-watch/reports/apply-<safe>.json`
     ```json
     {
       "target": "<target>",
       "branch": "upstream-watch/<target>",
       "commit": "<full sha>",
       "status": "ok",
       "checks": ["go test", "go vet", "lint", "type-check", "test", "build"],
       "finishedAt": "<ISO8601>"
     }
     ```
     只有全绿且推送成功才写 `status: "ok"`；否则写 `"failed"` 并在 `error` 字段说明。
8. 最后输出一行：`APPLIED <target> <sha>` / `FAILED <target> <原因>`。

## 报告格式

```markdown
# 升级执行记录 <日期>

## <target> <old> → <new>
- 分支：
- 提交：
- 改动文件：
- 验证：go test ✅ / go vet ✅ / lint ✅ / type-check ✅ / test ✅ / build ✅
- 未解决：
- 需人工视觉验证：
- 回滚：
```

## 判定

- 测试全绿才提交。
- 有视觉风险（liquid-glass、Tailwind、islandcn）时，写"需人工视觉验证"，但仍然提交分支。
- 大版本迁移（Vite 8、Tailwind 4、TS 7、Vitest 5、motion 14、pion v5）不在本流程里自动处理。
