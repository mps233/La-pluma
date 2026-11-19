#!/bin/bash
# 合并阶段：把本轮 apply 产生的 upstream-watch/<target> 分支合并到 main。
# 在专用 merge worktree 里合并与验证，完全不碰主工作区；全部通过才推 main。
#
# 设计原则：
#   - 只合并本轮新产出、JSON 记录 status=ok、且尚未合并的分支。
#   - 一次合并一个分支；冲突或验证失败立即中止，不推送。
#   - 全部分支合并完只推一次 main，减少触发 Docker 发布的次数。
set -euo pipefail

ROOT="/Users/miaopasi/La-pluma"
WATCH_DIR="$ROOT/.agents/upstream-watch"
STATE="$WATCH_DIR/state.json"
LOG_DIR="$WATCH_DIR/logs"
MERGE_WT="$WATCH_DIR/merge-worktree"
LOCK="$WATCH_DIR/.merge.lock"
TODAY="$(date +%Y-%m-%d)"
STAMP="$(date +%Y-%m-%dT%H:%M:%S%z)"
LOG="$LOG_DIR/merge-$TODAY.log"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/Users/miaopasi/.local/bin:/usr/local/go/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DRY_RUN=0
NO_PUSH=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
[[ "${1:-}" == "--no-push" ]] && NO_PUSH=1
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }

mkdir -p "$LOG_DIR"

if [[ "$(jq -r '.autoMergeToMain // false' "$STATE")" != "true" && $DRY_RUN -eq 0 && $NO_PUSH -eq 0 ]]; then
  log "autoMergeToMain=false，跳过合并（dry-run 仍可查看候选）"
  exit 0
fi

if [[ $DRY_RUN -eq 0 ]]; then
  if ! mkdir "$LOCK" 2>/dev/null; then
    log "已有合并任务在运行，退出"
    exit 0
  fi
  trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
fi

# 收集候选：status=ok 且未 merged。
# 多个分支改同一文件（如 client/package-lock.json）会互相冲突，
# 因此按 impact 分组：同一文件组内只取一个分支，全部失败时记录并跳过。
CANDIDATE_FILES="$(mktemp)"
for f in "$WATCH_DIR"/reports/apply-*.json; do
  [[ -f "$f" ]] || continue
  [[ "$(jq -r '.status // ""' "$f" 2>/dev/null)" == "ok" ]] || continue
  b="$(jq -r '.branch // ""' "$f" 2>/dev/null)"
  [[ -n "$b" ]] && echo "$b" >> "$CANDIDATE_FILES"
done
mapfile -t CANDIDATES < <(sort -u "$CANDIDATE_FILES")
rm -f "$CANDIDATE_FILES"

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
  log "没有待合并的 status=ok 分支"
  exit 0
fi

log "=== 合并阶段 ${TODAY}：候选 ${#CANDIDATES[@]} 个分支（dry-run=${DRY_RUN}） ==="

if [[ $DRY_RUN -eq 1 ]]; then
  for b in "${CANDIDATES[@]}"; do printf '  $ merge %s -> main\n' "$b"; done
  exit 0
fi

cd "$ROOT"

# 先同步远端分支引用（GitHub 偶发 503，重试 3 次）
fetch_origin() {
  local i
  for i in 1 2 3; do
    if git -C "$ROOT" fetch origin --prune >>"$LOG" 2>&1; then
      return 0
    fi
    log "git fetch 失败（第 ${i} 次），10 秒后重试"
    sleep 10
  done
  return 1
}
fetch_origin || { log "ERROR: git fetch 连续失败，本轮放弃"; exit 1; }

if ! git worktree list --porcelain | grep -qx "worktree $MERGE_WT"; then
  git worktree add --detach "$MERGE_WT" origin/main >>"$LOG" 2>&1 \
    || { log "ERROR: 创建 merge worktree 失败"; exit 1; }
else
  git -C "$MERGE_WT" fetch origin main >>"$LOG" 2>&1 || { log "ERROR: merge worktree fetch 失败"; exit 1; }
  git -C "$MERGE_WT" reset --hard origin/main >>"$LOG" 2>&1
fi

# 逐个合并；冲突立即中止
MERGED=()
CONFLICTED=()
for b in "${CANDIDATES[@]}"; do
  if ! git rev-parse --verify --quiet "refs/remotes/origin/$b" >/dev/null; then
    log "跳过 $b：远端分支不存在"
    continue
  fi
  if git -C "$MERGE_WT" merge --no-ff --no-edit "origin/$b" >>"$LOG" 2>&1; then
    MERGED+=("$b")
    log "合并 $b ✅"
  else
    # 冲突：放弃这个分支，继续合并其余分支（下一轮由实施阶段重建合并分支）
    git -C "$MERGE_WT" merge --abort >>"$LOG" 2>&1 || true
    CONFLICTED+=("$b")
    log "WARN: 合并 $b 冲突，跳过（不阻断其它分支）"
    jq --arg ts "$STAMP" '.status="conflict" | .conflictAt=$ts' "$WATCH_DIR/reports/apply-$(basename "$b" | sed 's#upstream-watch/##').json" > /tmp/c.json 2>/dev/null       && mv /tmp/c.json "$WATCH_DIR/reports/apply-$(basename "$b" | sed 's#upstream-watch/##').json" || true
  fi
done

if [[ ${#MERGED[@]} -eq 0 ]]; then
  log "没有成功合并的分支"
  if [[ ${#CONFLICTED[@]} -gt 0 ]]; then
    herdr notification show "上游合并不完整 ${TODAY}" \
      --body "全部冲突：${CONFLICTED[*]}" --sound request || true
  fi
  exit 0
fi
if [[ ${#CONFLICTED[@]} -gt 0 ]]; then
  log "有 ${#CONFLICTED[@]} 个分支冲突被跳过：${CONFLICTED[*]}"
fi

# 危险路径检查
FILES="$(git -C "$MERGE_WT" diff --name-only origin/main...HEAD)"
if printf '%s\n' "$FILES" | grep -qE '^\.github/|^data/|^go/build/|^\.env'; then
  log "ERROR: 改动包含受保护路径，拒绝合并"
  printf '%s\n' "$FILES" | grep -E '^\.github/|^data/|^go/build/|^\.env' | tee -a "$LOG"
  herdr notification show "上游合并被拒绝 ${TODAY}" --body "改动包含 .github/ 或受保护路径" --sound request || true
  exit 1
fi

# 在 merge worktree 里跑完整验证
log "开始验证合并结果"
FAILED=0
run_check() {
  local name="$1"; shift
  if ( cd "$MERGE_WT" && "$@" ) >>"$LOG" 2>&1; then
    log "  ✅ $name"
  else
    log "  ❌ $name"
    FAILED=1
  fi
}

run_check "go build"   go -C go build ./...
run_check "go test"    go -C go test ./...
run_check "go vet"     go -C go vet ./...

# npm ci 在复用 worktree 时可能因残留 node_modules 报 ENOTEMPTY，先清理
log "  清理 merge worktree 的 node_modules"
rm -rf "$MERGE_WT/client/node_modules"
run_check "npm ci"     npm ci --prefix client --cache "$MERGE_WT/.npm-cache"
run_check "lint"       npm run lint --prefix client
run_check "type-check" npm run type-check --prefix client
run_check "test"       env NODE_OPTIONS=--no-experimental-webstorage npm run test --prefix client
run_check "build"      npm run build --prefix client

if [[ $FAILED -ne 0 ]]; then
  log "ERROR: 合并后验证失败，不推送 main"
  herdr notification show "上游合并未推送 ${TODAY}" --body "验证失败，main 未变动" --sound request || true
  exit 1
fi

if [[ $NO_PUSH -eq 1 ]]; then
  log "no-push：合并与验证完成，未推送 main（彩排模式）；结果在 $MERGE_WT"
  herdr notification show "上游合并彩排完成 ${TODAY}" --body "验证通过，未推送 main" --sound none || true
  exit 0
fi

# 推送 main
if ! git -C "$MERGE_WT" push origin HEAD:main >>"$LOG" 2>&1; then
  log "ERROR: 推送 main 失败（可能远端已前进），本轮不重试"
  herdr notification show "上游合并推送失败 ${TODAY}" --body "main 未变动，请下轮重试" --sound request || true
  exit 1
fi

NEW_SHA="$(git -C "$MERGE_WT" rev-parse --short HEAD)"
log "已推送 main @ $NEW_SHA"

# 标记 JSON 与 decisions，防止下一轮重复合并
for b in "${MERGED[@]}"; do
  safe="${b#upstream-watch/}"
  f="$WATCH_DIR/reports/apply-$safe.json"
  [[ -f "$f" ]] && jq --arg ts "$STAMP" '.status="merged" | .mergedAt=$ts' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

python3 - "$WATCH_DIR/decisions.md" "${MERGED[@]}" <<'PY'
import sys
path, branches = sys.argv[1], sys.argv[2:]
targets = {b.split('/', 1)[1] for b in branches}
lines = open(path, encoding='utf-8').read().splitlines()
out = []
for line in lines:
    if '| apply |' in line and any(f'| {t} |' in line for t in targets):
        out.append(line.replace('| apply |', '| done |'))
    else:
        out.append(line)
open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
PY

jq --arg ts "$STAMP" --arg b "${MERGED[*]}" --arg sha "$NEW_SHA" \
  '.lastMergeRun = {at: $ts, status: "pushed", branches: $b, mainSha: $sha}' \
  "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"

herdr notification show "上游已合并到 main ${TODAY}" \
  --body "${#MERGED[@]} 个分支已合并并推送：${MERGED[*]}" --sound request || true

log "=== done ==="
