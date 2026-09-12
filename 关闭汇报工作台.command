#!/bin/bash
set -euo pipefail

finish() {
  local status="$1"
  if [ -t 0 ]; then read -r -p '按回车关闭此窗口…' _unused || true; fi
  exit "$status"
}

BASE="$HOME/Library/Application Support/ReportStudio"
PORT=18776
PIDS="$(/usr/sbin/lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN || true)"
if [ -z "$PIDS" ]; then
  echo '汇报工作台当前未运行，无需关闭。'
  finish 0
fi

is_workbench() {
  local command owner
  command="$(/bin/ps -p "$1" -o command= 2>/dev/null)" || return 1
  owner="$(/bin/ps -p "$1" -o uid= 2>/dev/null | /usr/bin/tr -d ' ')" || return 1
  [ "$owner" = "$(/usr/bin/id -u)" ] || return 1
  case "$command" in
    *" $BASE/application/server.py --port $PORT --data $BASE/data") return 0 ;;
    *) return 1 ;;
  esac
}

# Verify every listener before sending any signal; never kill by port alone.
for PID in $PIDS; do
  if ! is_workbench "$PID"; then
    echo "端口 $PORT 被其他程序占用，未关闭该程序。"
    finish 1
  fi
done

echo '正在关闭汇报工作台…'
for PID in $PIDS; do
  if is_workbench "$PID"; then
    if ! kill -TERM "$PID" 2>/dev/null && is_workbench "$PID"; then
      echo '无法停止工作台进程，请稍后重试。'
      finish 1
    fi
  fi
done

# SIGTERM lets the server stop writing jobs and preserve report data.
for ((attempt=0; attempt<75; attempt++)); do
  RUNNING=false
  for PID in $PIDS; do
    if is_workbench "$PID"; then RUNNING=true; fi
  done
  if [ "$RUNNING" = false ]; then
    if /usr/sbin/lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo '原工作台进程已退出，但端口已被其他进程监听，请检查是否重新启动。'
      finish 1
    fi
    echo '汇报工作台已关闭，本地报告和数据均已保留。'
    finish 0
  fi
  /bin/sleep 0.2
done

echo '已发送关闭请求，工作台仍在结束任务。请稍后再次检查。'
finish 1
