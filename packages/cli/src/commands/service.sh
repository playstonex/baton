#!/bin/bash
# Baton daemon launchd service installer for macOS
# Usage: ./install.sh [--install | --uninstall | --status]

set -euo pipefail

PLIST_NAME="com.playstone.baton.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
BATON_BIN="$(which baton 2>/dev/null || echo '')"
LOG_DIR="$HOME/.baton/logs"

install() {
  if [ -f "$PLIST_PATH" ]; then
    echo "[baton] Service already installed. Uninstall first or run 'baton service restart'."
    exit 0
  fi

  if [ -z "$BATON_BIN" ]; then
    echo "[baton] Error: 'baton' binary not found in PATH."
    echo "        Install with: npm install -g @baton/cli"
    exit 1
  fi

  mkdir -p "$LOG_DIR"

  # Resolve the full path of the binary
  BATON_BIN_RESOLVED="$(command -v baton)"

  cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BATON_BIN_RESOLVED}</string>
        <string>daemon</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/daemon.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
</dict>
</plist>
PLIST

  launchctl load "$PLIST_PATH" 2>/dev/null || true
  echo "[baton] Daemon service installed and started."
  echo "        Logs: ${LOG_DIR}/daemon.log"
  echo "        Manage: baton service [start|stop|restart|status]"
}

uninstall() {
  if [ ! -f "$PLIST_PATH" ]; then
    echo "[baton] Service not installed."
    exit 0
  fi

  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "[baton] Daemon service uninstalled."
}

status() {
  if [ ! -f "$PLIST_PATH" ]; then
    echo "[baton] Service not installed."
    exit 0
  fi

  local loaded
  loaded="$(launchctl list 2>/dev/null | grep "${PLIST_NAME}" || true)"
  if [ -n "$loaded" ]; then
    echo "[baton] Service is running."
  else
    echo "[baton] Service is installed but not running."
  fi
}

case "${1:-}" in
  --install|install)   install ;;
  --uninstall|uninstall) uninstall ;;
  --status|status)     status ;;
  *)                   echo "Usage: $0 [--install | --uninstall | --status]"; exit 1 ;;
esac
