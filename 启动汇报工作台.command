#!/bin/bash
set -euo pipefail
launch_failed() {
  STATUS=$?
  echo '未完成启动。请根据上方提示处理后，重新双击。'
  if [ -t 0 ]; then read -r -p '按回车关闭…' _unused || true; fi
  exit "$STATUS"
}
trap launch_failed ERR
PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCH="$(/usr/bin/uname -m)"
case "$ARCH" in arm64|x86_64) ;; *) echo '暂不支持此处理器。'; exit 1;; esac

# A quarantined bundled interpreter can be killed or removed by macOS. Prefer
# an already usable local Python, including when Finder supplies a minimal PATH.
python_works() {
  [ -x "$1" ] || return 1
  "$1" -B -E -c 'import sys; sys.exit(1) if sys.version_info < (3, 9) else None; sys.path.insert(0, sys.argv[1]); import standalone_launch, server' "$PACKAGE_DIR/app" >/dev/null 2>&1 &
  local probe_pid=$! attempt
  for ((attempt=0; attempt<50; attempt++)); do
    if ! kill -0 "$probe_pid" 2>/dev/null; then
      wait "$probe_pid" 2>/dev/null
      return $?
    fi
    /bin/sleep 0.2
  done
  kill -KILL "$probe_pid" 2>/dev/null || true
  wait "$probe_pid" 2>/dev/null || true
  return 1
}
PYTHON=""
for CANDIDATE in "$(command -v python3 || true)" /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if python_works "$CANDIDATE"; then PYTHON="$CANDIDATE"; break; fi
done

RUNTIME_DIR="$HOME/Library/Application Support/ReportStudio/runtime-3.12.14-$ARCH"
if [ -z "$PYTHON" ] && [ ! -x "$RUNTIME_DIR/python/bin/python3" ]; then
  echo '首次启动：正在准备内置运行环境，无需安装 Python 或 Homebrew…'
  case "$ARCH" in
    arm64) EXPECTED=81a359f1cfadd4da11766534c5913791cea55f26e1bb902cacd2a531bb1e4b2b ;;
    x86_64) EXPECTED=65b195c9cedc1fef6767f044f9822069adbd1bd9204d424ece4628776fdc04bb ;;
  esac
  ACTUAL="$(/usr/bin/shasum -a 256 "$PACKAGE_DIR/runtime/$ARCH.tar.gz" | /usr/bin/awk '{print $1}')"
  if [ "$ACTUAL" != "$EXPECTED" ]; then echo '运行环境校验失败，请重新获取安装包。'; exit 1; fi
  /bin/mkdir -p "$(dirname "$RUNTIME_DIR")"
  TEMP_RUNTIME="$(/usr/bin/mktemp -d "$(dirname "$RUNTIME_DIR")/.runtime.XXXXXX")"
  /usr/bin/tar -xzf "$PACKAGE_DIR/runtime/$ARCH.tar.gz" -C "$TEMP_RUNTIME"
  # Preserve a damaged installation instead of discarding the freshly extracted
  # replacement merely because the old directory still exists.
  if [ -e "$RUNTIME_DIR" ]; then
    /bin/mv "$RUNTIME_DIR" "$RUNTIME_DIR.backup-$(/bin/date +%Y%m%d%H%M%S)-$$"
  fi
  /bin/mv "$TEMP_RUNTIME" "$RUNTIME_DIR"
fi
if [ -z "$PYTHON" ]; then
  if python_works "$RUNTIME_DIR/python/bin/python3"; then
    PYTHON="$RUNTIME_DIR/python/bin/python3"
  else
    echo '内置 Python 无法运行，且未找到可用的本机 Python 3.9 或更新版本。'
    echo '请查看「先读我.md」中的 macOS 首次打开说明，然后重新双击。'
    false
  fi
fi
"$PYTHON" -B -E "$PACKAGE_DIR/app/standalone_launch.py" "$@"
