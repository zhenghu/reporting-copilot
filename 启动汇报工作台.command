#!/bin/bash
set -euo pipefail
PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCH="$(/usr/bin/uname -m)"
case "$ARCH" in arm64|x86_64) ;; *) echo '暂不支持此处理器。'; exit 1;; esac
RUNTIME_DIR="$HOME/Library/Application Support/ReportStudio/runtime-3.12.14-$ARCH"
if [ ! -x "$RUNTIME_DIR/python/bin/python3" ]; then
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
  if [ ! -d "$RUNTIME_DIR" ]; then /bin/mv "$TEMP_RUNTIME" "$RUNTIME_DIR"; else /bin/rm -rf "$TEMP_RUNTIME"; fi
fi
if ! "$RUNTIME_DIR/python/bin/python3" "$PACKAGE_DIR/app/standalone_launch.py" "$@"; then
  echo '未完成启动。按上方提示处理后，重新双击即可。'
  read -r -p '按回车关闭…' _unused
  exit 1
fi
