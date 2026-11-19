#!/bin/bash
# 上游巡检 · 并行版：按 groups.json 把 watchlist 拆给多个 agent 并行跑，最后合并报告。
# launchd 每天 09:07 调用；也可手动运行。
set -euo pipefail

ROOT="/Users/miaopasi/La-pluma"
WATCH_DIR="$ROOT/.agents/upstream-watch"
STATE="$WATCH_DIR/state.json"
GROUPS_FILE="$WATCH_DIR/groups.json"
LOG_DIR="$WATCH_DIR/logs"
TODAY="$(date +%Y-%m-%d)"
STAMP="$(date +%Y-%m-%dT%H:%M:%S%z)"
LOG="$LOG_DIR/run-$TODAY.log"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/Users/miaopasi/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }

mkdir -p "$LOG_DIR" "$WATCH_DIR/reports" "$WATCH_DIR/partials"

if [[ "$(jq -r '.enabled' "$STATE")" != "true" ]]; then
  log "state.json 里 enabled=false，退出"
  exit 0
fi

WORKSPACE_LABEL="$(jq -r '.workspace' "$STATE")"
TAB_LABEL="$(jq -r '.tabLabel' "$STATE")"
SETTINGS="$WATCH_DIR/claude-settings.json"

GROUP_IDS=($(jq -r 'keys[]' "$GROUPS_FILE"))
log "=== upstream watch ${TODAY}（${#GROUP_IDS[@]} 组并行，dry-run=${DRY_RUN}） ==="

if [[ $DRY_RUN -eq 1 ]]; then
  for GID in "${GROUP_IDS[@]}"; do
    printf '  · 组 %s → agent upstream-%s：%s\n' \
      "$GID" "$GID" "$(jq -r --arg g "$GID" '.[$g] | join(", ")' "$GROUPS_FILE")"
  done
  exit 0
fi

WS_ID="$(herdr workspace list | jq -r --arg label "$WORKSPACE_LABEL" \
  '.result.workspaces[] | select(.label==$label) | .workspace_id' | head -1)"
[[ -n "$WS_ID" ]] || { log "ERROR: 找不到 workspace $WORKSPACE_LABEL"; exit 1; }

TAB_ID="$(herdr tab list --workspace "$WS_ID" | jq -r --arg label "$TAB_LABEL" \
  '.result.tabs[] | select(.label==$label) | .tab_id' | head -1)"
if [[ -z "$TAB_ID" ]]; then
  TAB_JSON="$(herdr tab create --workspace "$WS_ID" --cwd "$ROOT" \
    --label "$TAB_LABEL" --no-focus)"
  TAB_ID="$(printf '%s' "$TAB_JSON" | jq -r '.result.tab.tab_id')"
fi
log "tab=$TAB_ID"

BASE_PANE="$(herdr pane list --workspace "$WS_ID" | jq -r --arg tab "$TAB_ID" \
  '.result.panes[] | select(.tab_id==$tab) | .pane_id' | head -1)"
[[ -n "$BASE_PANE" ]] || { log "ERROR: tab 里没有 pane"; exit 1; }

# 1. 确保每组 agent 存在（复用已有 agent；缺的找空闲 shell 或切分 pane）
AGENTS=()
for GID in "${GROUP_IDS[@]}"; do
  AGENT="upstream-$GID"
  if ! herdr agent get "$AGENT" >/dev/null 2>&1; then
    PANE="$(herdr pane list --workspace "$WS_ID" | jq -r --arg tab "$TAB_ID" \
      '.result.panes[] | select(.tab_id==$tab and (.agent==null)) | .pane_id' | head -1)"
    if [[ -z "$PANE" ]]; then
      SPLIT_JSON="$(herdr pane split "$BASE_PANE" --direction down --cwd "$ROOT" --no-focus)"
      PANE="$(printf '%s' "$SPLIT_JSON" | jq -r '.result.pane.pane_id')"
    fi
    log "启动 ${AGENT}（pane=${PANE}）"
    herdr agent start "$AGENT" --kind claude --pane "$PANE" --timeout 300000 -- \
      --permission-mode dontAsk \
      --settings "$SETTINGS" \
      --max-turns 45 --max-budget-usd 1.5 >>"$LOG" 2>&1 \
      || { log "ERROR: 启动 $AGENT 失败"; continue; }
  fi
  AGENTS+=("$AGENT")
done

# 等一下，避免刚启动的 TUI 吞掉第一条 prompt
sleep 3

# 2. 并行提交 prompt（不等待；失败重试一次）
SUBMIT_PIDS=()
for GID in "${GROUP_IDS[@]}"; do
  AGENT="upstream-$GID"
  TARGETS="$(jq -r --arg g "$GID" '.[$g] | join("、")' "$GROUPS_FILE")"
  PARTIAL="$WATCH_DIR/reports/$TODAY-$GID.md"
  PROMPT="$(sed "s/{DATE}/$TODAY/g" "$WATCH_DIR/prompt.md")"
  PROMPT="$PROMPT

## 本轮你负责的分组
只检查这些 target，不要碰其它目标：$TARGETS

## 输出
把本组结果写到 ${PARTIAL}。
只写自己负责的 target，格式与主报告一致（需要动作用 ### 标题并在末尾加 | apply |）。
不要更新 state.json。每个 target 最多 3 次查询，拿不准就标 watch，不要深挖。"

  (
    if ! herdr agent prompt "$AGENT" "$PROMPT" >>"$LOG" 2>&1; then
      sleep 3
      herdr agent prompt "$AGENT" "$PROMPT" >>"$LOG" 2>&1
    fi
  ) &
  SUBMIT_PIDS+=($!)
done
for pid in "${SUBMIT_PIDS[@]}"; do wait "$pid" || log "WARN: 有一条 prompt 提交失败"; done
log "prompt 全部提交"

# 3. 轮询各组分片报告；最多等 70 分钟
DEADLINE=$((SECONDS + 4200))
while :; do
  MISSING=0
  for GID in "${GROUP_IDS[@]}"; do
    [[ -f "$WATCH_DIR/reports/$TODAY-$GID.md" ]] || MISSING=$((MISSING + 1))
  done
  (( MISSING == 0 )) && break
  if (( SECONDS > DEADLINE )); then
    log "等待超时，仍有 $MISSING 组未产出"
    break
  fi
  sleep 15
done
log "分组结束"

# 4. 合并报告
REPORT="$WATCH_DIR/reports/$TODAY.md"
{
  echo "# 上游更新报告 $TODAY"
  echo
  echo "**本轮**：${#GROUP_IDS[@]} 组并行，共 $(jq '[.[]|length]|add' "$GROUPS_FILE") 个 target。"
  echo
  for GID in "${GROUP_IDS[@]}"; do
    f="$WATCH_DIR/reports/$TODAY-$GID.md"
    echo
    echo "## 组 $GID"
    echo
    if [[ -f "$f" ]]; then cat "$f"; else echo "_本组未产出结果。_"; fi
  done
} > "$REPORT"

jq --arg ts "$STAMP" --arg tab "$TAB_ID" --arg report "$TODAY.md" \
  '.lastRun = {startedAt: $ts, status: "ok", tab: $tab, report: $report}' \
  "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"

NEED=$(grep -c '| apply |' "$REPORT" || true)
herdr notification show "上游更新报告 $TODAY" \
  --body "需要动作 ${NEED:-0} 条；${#GROUP_IDS[@]} 组并行完成" --sound request || true

if [[ "$(jq -r '.autoApply // false' "$STATE")" == "true" ]] && grep -q '| apply |' "$REPORT"; then
  log "检测到 apply 条目，进入实施阶段"
  bash "$WATCH_DIR/bin/apply.sh" >>"$LOG" 2>&1 || log "实施阶段失败"
fi

log "=== done ==="
