#!/bin/bash
# 上游巡检 · 实施阶段（并行）：对 decisions.md 里标记 apply 的每个 target
# 开一个独立 worktree + agent，改完跑验证、提交、推送到 upstream-watch/<target>。
set -euo pipefail

ROOT="/Users/miaopasi/La-pluma"
WATCH_DIR="$ROOT/.agents/upstream-watch"
STATE="$WATCH_DIR/state.json"
LOG_DIR="$WATCH_DIR/logs"
TODAY="$(date +%Y-%m-%d)"
STAMP="$(date +%Y-%m-%dT%H:%M:%S%z)"
LOG="$LOG_DIR/apply-$TODAY.log"
APPLIED="$WATCH_DIR/reports/$TODAY-applied.md"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/Users/miaopasi/.local/bin:/usr/local/go/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
run() { if [[ $DRY_RUN -eq 1 ]]; then printf '  $ %s\n' "$*"; else "$@"; fi; }

mkdir -p "$LOG_DIR" "$WATCH_DIR/worktrees" "$WATCH_DIR/reports"

[[ "$(jq -r '.enabled' "$STATE")" == "true" ]] || { log "已停用，退出"; exit 0; }

# 收集待实施 target：decisions.md 里 `| apply |` 的行，字段 2 是 target
mapfile -t TARGETS < <(grep '| apply |' "$WATCH_DIR/decisions.md" 2>/dev/null \
  | awk -F'|' '{gsub(/^ +| +$/,"",$2); if ($2!="") print $2}' | sort -u)
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  log "没有 apply 条目，跳过实施阶段"
  exit 0
fi
# 按 lockfile 分组：多个 npm target 会争抢 client/package-lock.json，
# 单 target 单分支必然冲突。凡是改同一个 lockfile 的 target 合成一个批次分支。
NPM_TARGETS=()
GO_TARGETS=()
OTHER_TARGETS=()
for T in "${TARGETS[@]}"; do
  case "$T" in
    mygo|pion/webrtc) GO_TARGETS+=("$T") ;;
    vite|vitest|typescript-eslint|tailwindcss|react|motion|lisse|zustand|budoux|lucide|hugeicons|liquid-glass|islandcn|npm*)
      NPM_TARGETS+=("$T") ;;
    *) OTHER_TARGETS+=("$T") ;;
  esac
done

# 批次定义：name|targets
BATCHES=()
for T in "${GO_TARGETS[@]:-}"; do [[ -n "$T" ]] && BATCHES+=("$T|$T"); done
if [[ ${#NPM_TARGETS[@]} -gt 0 ]]; then
  BATCHES+=("npm-batch|$(IFS=,; echo "${NPM_TARGETS[*]}")")
fi
for T in "${OTHER_TARGETS[@]:-}"; do [[ -n "$T" ]] && BATCHES+=("$T|$T"); done

log "=== upstream apply ${TODAY}：${#TARGETS[@]} 个 target / ${#BATCHES[@]} 个批次（dry-run=${DRY_RUN}） ==="
for B in "${BATCHES[@]}"; do log "  批次 ${B%%|*} ← ${B#*|}"; done

WORKSPACE_LABEL="$(jq -r '.workspace' "$STATE")"
APPLY_TAB="$(jq -r '.applyTabLabel' "$STATE")"
SETTINGS="$WATCH_DIR/apply-settings.json"
CONCURRENCY="$(jq -r '.maxParallel // 4' "$STATE")"

WS_ID="$(herdr workspace list | jq -r --arg label "$WORKSPACE_LABEL" \
  '.result.workspaces[] | select(.label==$label) | .workspace_id' | head -1)"
[[ -n "$WS_ID" ]] || { log "ERROR: 找不到 workspace"; exit 1; }

if [[ $DRY_RUN -eq 1 ]]; then
  for B in "${BATCHES[@]}"; do
    SAFE="$(printf '%s' "${B%%|*}" | tr '/:@.' '----')"
    printf '  · 批次 %s ← %s，分支 upstream-watch/%s\n' "${B%%|*}" "${B#*|}" "$SAFE"
  done
  exit 0
fi

TAB_ID="$(herdr tab list --workspace "$WS_ID" | jq -r --arg label "$APPLY_TAB" \
  '.result.tabs[] | select(.label==$label) | .tab_id' | head -1)"
if [[ -z "$TAB_ID" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY: 会创建 tab $APPLY_TAB"
    TAB_ID="DRY"
  else
    TAB_JSON="$(herdr tab create --workspace "$WS_ID" --cwd "$ROOT" --label "$APPLY_TAB" --no-focus)"
    TAB_ID="$(printf '%s' "$TAB_JSON" | jq -r '.result.tab.tab_id')"
  fi
fi
log "tab=$TAB_ID"

# 准备 pane（每个批次一个）
PANES=()
if true; then
  BASE_PANE="$(herdr pane list --workspace "$WS_ID" | jq -r --arg tab "$TAB_ID" \
    '.result.panes[] | select(.tab_id==$tab) | .pane_id' | head -1)"
  [[ -n "$BASE_PANE" ]] || { log "ERROR: apply tab 里没有 pane"; exit 1; }
  PANES+=("$BASE_PANE")
  NEED=$(( ${#BATCHES[@]} - 1 ))
  for ((i = 1; i <= NEED; i++)); do
    SPLIT="$(herdr pane split "$BASE_PANE" --direction down --cwd "$ROOT" --no-focus)"
    PANES+=("$(printf '%s' "$SPLIT" | jq -r '.result.pane.pane_id')")
  done
  log "panes=${PANES[*]}"
fi

PIDS=()
for idx in "${!BATCHES[@]}"; do
  BATCH="${BATCHES[$idx]}"
  BATCH_NAME="${BATCH%%|*}"
  BATCH_TARGETS="${BATCH#*|}"
  SAFE="$(printf '%s' "$BATCH_NAME" | tr '/:@.' '----')"
  AGENT="apply-$SAFE"
  WT="$WATCH_DIR/worktrees/$SAFE"
  BRANCH="upstream-watch/$SAFE"

  PANE="${PANES[$idx]}"

  (
    set -e
    if ! herdr agent get "$AGENT" >/dev/null 2>&1; then
      STARTED=0
      for attempt in 1 2 3; do
        # 优先用本组分配的 pane；占用则找同 tab 的空闲 shell
        TARGET_PANE="$PANE"
        if ! herdr pane list --workspace "$WS_ID" | jq -e --arg p "$TARGET_PANE" \
             '.result.panes[] | select(.pane_id==$p and .agent==null)' >/dev/null 2>&1; then
          TARGET_PANE="$(herdr pane list --workspace "$WS_ID" | jq -r --arg tab "$TAB_ID" \
            '.result.panes[] | select(.tab_id==$tab and (.agent==null)) | .pane_id' | head -1)"
        fi
        if [[ -n "$TARGET_PANE" ]]; then
          if herdr agent start "$AGENT" --kind claude --pane "$TARGET_PANE" --timeout 300000 -- \
            --permission-mode dontAsk \
            --settings "$SETTINGS" \
            --max-turns 150 --max-budget-usd 6 >>"$LOG" 2>&1; then
            STARTED=1
            break
          fi
        fi
        # 没有空闲 pane 就切一个新的
        SPLIT_JSON="$(herdr pane split "$BASE_PANE" --direction down --cwd "$ROOT" --no-focus 2>/dev/null || true)"
        NEW_PANE="$(printf '%s' "$SPLIT_JSON" | jq -r '.result.pane.pane_id // empty' 2>/dev/null || true)"
        if [[ -n "$NEW_PANE" ]]; then
          if herdr agent start "$AGENT" --kind claude --pane "$NEW_PANE" --timeout 300000 -- \
            --permission-mode dontAsk \
            --settings "$SETTINGS" \
            --max-turns 150 --max-budget-usd 6 >>"$LOG" 2>&1; then
            STARTED=1
            break
          fi
        fi
        sleep 5
      done
      if [[ $STARTED -eq 0 ]]; then
        log "ERROR: 无法启动 $AGENT，跳过该 target"
        exit 1
      fi
    fi

    PROMPT="$(sed "s/{DATE}/$TODAY/g" "$WATCH_DIR/apply-prompt.md")"
    PROMPT="$PROMPT

## 本轮你负责的批次
- 批次：$BATCH_NAME
- 包含 target：$BATCH_TARGETS
- worktree：$WT
- 分支：$BRANCH
- 各 target 的说明见 $WATCH_DIR/decisions.md 的 apply 行。

**重要**：多个 target 改同一个 lockfile 时必须一次性合并安装，
不要逐个 npm install 再分别提交——只产生一个 commit、一个分支。

## 输出
把执行记录写到 $WATCH_DIR/reports/$TODAY-applied-$SAFE.md。
不要改动其它 target 的 worktree 或分支。"

    if herdr agent prompt "$AGENT" "$PROMPT" --wait --timeout 7200000 >>"$LOG" 2>&1; then
      log "批次 $BATCH_NAME 完成"
    else
      log "批次 $BATCH_NAME 结束但状态非 done"
    fi
  ) &
  PIDS+=($!)

  while [[ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$CONCURRENCY" ]]; do
    wait -n || true
  done
done

[[ $DRY_RUN -eq 1 ]] && exit 0

for pid in "${PIDS[@]}"; do wait "$pid" || log "WARN: 实施任务失败 pid=$pid"; done

# 合并执行记录
{
  echo "# 升级执行记录 $TODAY"
  echo
  echo "**本轮**：${#TARGETS[@]} 个 target 并行实施。"
  for B in "${BATCHES[@]}"; do
    SAFE="$(printf '%s' "${B%%|*}" | tr '/:@.' '----')"
    f="$WATCH_DIR/reports/$TODAY-applied-$SAFE.md"
    echo
    if [[ -f "$f" ]]; then cat "$f"; else echo "## ${B%%|*}"; echo; echo "_未产出记录。_"; fi
  done
} > "$APPLIED"

jq --arg ts "$STAMP" --arg tab "$TAB_ID" --arg report "$TODAY-applied.md" \
  '.lastApplyRun = {startedAt: $ts, status: "ok", tab: $tab, report: $report}' \
  "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"

BRANCHES="$(git -C "$ROOT" branch --list 'upstream-watch/*' --format='%(refname:short)' | tr '\n' ' ')"
herdr notification show "上游升级已完成 $TODAY" \
  --body "分支：${BRANCHES:-无}" --sound request || true

log "=== done ==="
