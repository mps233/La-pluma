#!/bin/bash
# 每日流水线：巡检 → 裁决闸门 → 实施（仅 apply）→ 合并 main。
# launchd 每天 09:07 调用。
#
# 裁决闸门把待办推到固定的 Upstream Review tab，由常驻 agent 询问用户；
# 用户答复写进 decisions.md 后，下一轮由 apply.sh 消费。
set -euo pipefail

ROOT="/Users/miaopasi/La-pluma"
WATCH_DIR="$ROOT/.agents/upstream-watch"
LOG_DIR="$WATCH_DIR/logs"
TODAY="$(date +%Y-%m-%d)"
LOG="$LOG_DIR/daily-$TODAY.log"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/Users/miaopasi/.local/bin:/usr/local/go/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$LOG_DIR"
echo "[$(date +%H:%M:%S)] daily start" | tee -a "$LOG"

step() {
  local name="$1"; shift
  if ! bash "$@" >>"$LOG" 2>&1; then
    echo "[$(date +%H:%M:%S)] ${name} 失败，继续下一步" | tee -a "$LOG"
  fi
}

step 巡检 "$WATCH_DIR/bin/watch.sh"
step 裁决 "$WATCH_DIR/bin/review.sh"
step 实施 "$WATCH_DIR/bin/apply.sh"
step 合并 "$WATCH_DIR/bin/merge.sh"

echo "[$(date +%H:%M:%S)] daily done" | tee -a "$LOG"
