#!/bin/bash
# 巡检→实施之间的「决策闸门」：把待裁决的 adopt 条目整理成一页，放进固定的
# herdr tab（Upstream Review），由常驻的 review agent 向用户提问。
# 只有在 decisions.md 里仍为 apply 的条目会被问；已回答的不会重复。
set -euo pipefail

ROOT="/Users/miaopasi/La-pluma"
WATCH_DIR="$ROOT/.agents/upstream-watch"
STATE="$WATCH_DIR/state.json"
LOG_DIR="$WATCH_DIR/logs"
TODAY="$(date +%Y-%m-%d)"
LOG="$LOG_DIR/review-$TODAY.log"
INBOX="$WATCH_DIR/reports/review-$TODAY.md"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/Users/miaopasi/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
mkdir -p "$LOG_DIR"

[[ "$(jq -r '.enabled' "$STATE")" == "true" ]] || { log "已停用，退出"; exit 0; }

# 1. 收集本日报告里所有 adopt / apply 条目
REPORT="$WATCH_DIR/reports/$TODAY.md"
GROUP_IDS=($(jq -r 'keys[]' "$WATCH_DIR/groups.json"))

ITEMS=()
TMP_LINES="$(mktemp)"
for g in "${GROUP_IDS[@]}"; do
  f="$WATCH_DIR/reports/$TODAY-$g.md"
  [[ -f "$f" ]] || continue
  grep -nE '^### .*(adopt|apply)' "$f" > "$TMP_LINES" || true
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    target="$(printf '%s' "${line#*### }" | awk '{print $1}')"
    # 已经有 apply / done / ignore 决定的目标不再重复问
    if grep -qE "\| ${target} \|.*\| (apply|done|ignore) \|" "$WATCH_DIR/decisions.md" 2>/dev/null; then
      continue
    fi
    ITEMS+=("$g|$line")
  done < "$TMP_LINES"
done
rm -f "$TMP_LINES"

if [[ ${#ITEMS[@]} -eq 0 ]]; then
  log "本轮没有待裁决的 adopt 条目"
  exit 0
fi

# 2. 生成给人看的一页
{
  echo "# 待你裁决的上游更新 $TODAY"
  echo
  echo "每条回复一个字母：Y=升级并合并、N=跳过、W=先观察。"
  echo "也可以直接编辑 decisions.md。"
  echo
  for item in "${ITEMS[@]}"; do
    g="${item%%|*}"
    line="${item#*|}"
    echo "## [$g] ${line#*### }"
  done
} > "$INBOX"

log "待裁决 ${#ITEMS[@]} 条，写入 $INBOX"

if [[ $DRY_RUN -eq 1 ]]; then
  printf '  $ 会向 review agent 提交裁决请求\n'
  exit 0
fi

# 3. 固定的 Upstream Review tab + 常驻 agent
WS_ID="$(herdr workspace list | jq -r --arg label "$(jq -r '.workspace' "$STATE")" \
  '.result.workspaces[] | select(.label==$label) | .workspace_id' | head -1)"
[[ -n "$WS_ID" ]] || { log "ERROR: 找不到 workspace"; exit 1; }

TAB_LABEL="Upstream Review"
TAB_ID="$(herdr tab list --workspace "$WS_ID" | jq -r --arg label "$TAB_LABEL" \
  '.result.tabs[] | select(.label==$label) | .tab_id' | head -1)"
if [[ -z "$TAB_ID" ]]; then
  TAB_JSON="$(herdr tab create --workspace "$WS_ID" --cwd "$ROOT" --label "$TAB_LABEL" --no-focus)"
  TAB_ID="$(printf '%s' "$TAB_JSON" | jq -r '.result.tab.tab_id')"
  log "建 tab $TAB_ID"
fi

PANE="$(herdr pane list --workspace "$WS_ID" | jq -r --arg tab "$TAB_ID" \
  '.result.panes[] | select(.tab_id==$tab) | .pane_id' | head -1)"
[[ -n "$PANE" ]] || { log "ERROR: review tab 没有 pane"; exit 1; }

AGENT="upstream-review"
if ! herdr agent get "$AGENT" >/dev/null 2>&1; then
  herdr agent start "$AGENT" --kind claude --pane "$PANE" --timeout 300000 -- \
    --permission-mode dontAsk \
    --settings "$WATCH_DIR/review-settings.json" \
    --max-turns 40 >>"$LOG" 2>&1 || { log "ERROR: 启动 review agent 失败"; exit 1; }
  sleep 3
fi

PROMPT="$(cat <<EOF
你是上游更新的裁决助手。今天是 $TODAY。

待裁决清单在 $INBOX。请：
1. 读取该文件，把每条整理的「仓库、旧版本→新版本、改了什么、影响哪些文件、建议」简明列出。
2. 用提问的方式让用户逐条决定：升级并合并（Y）、跳过（N）、先观察（W）。
3. 用户回答后，把结果追加到 $WATCH_DIR/decisions.md，格式：
   - $TODAY | <target> | <version> | apply|ignore|watch | <用户理由>
4. 不要自己替用户决定，也不要修改仓库代码。
5. 全部裁决完，输出一行：REVIEW DONE
EOF
)"

herdr agent prompt "$AGENT" "$PROMPT" >>"$LOG" 2>&1 || { log "ERROR: 提交裁决请求失败"; exit 1; }
log "已提交给 $AGENT"

herdr notification show "上游更新待你裁决 ${TODAY}" \
  --body "打开 herdr 的 Upstream Review tab" --sound request || true

log "=== done ==="
