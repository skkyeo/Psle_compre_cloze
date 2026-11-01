#!/usr/bin/env bash
# Sets up the Cloze Word Coach home server on a Raspberry Pi (Linux) or a Mac,
# and makes it start automatically. Run from anywhere:  bash server/setup.sh
# Add --no-service to only install, without auto-start.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
PY="${PYTHON:-python3}"

if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  echo "Python 3.10 or newer is needed (found: $("$PY" --version 2>&1 || echo none))."
  echo "On a Mac: install it from python.org or with 'brew install python', then rerun."
  exit 1
fi

echo "Installing into $APP_DIR/.venv ..."
"$PY" -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r server/requirements.txt

if [ ! -f server/config.env ]; then
  cp server/config.env.example server/config.env
  chmod 600 server/config.env
  echo "Created server/config.env. Put your API key in it, then restart the server."
fi
mkdir -p server/data

if [ "${1:-}" = "--no-service" ]; then
  echo "Done. Start it with: .venv/bin/python server/server.py"
  exit 0
fi

case "$(uname)" in
  Linux)
    UNIT=/etc/systemd/system/cloze-coach.service
    sudo tee "$UNIT" >/dev/null <<UNIT_EOF
[Unit]
Description=Cloze Word Coach
After=network-online.target
Wants=network-online.target

[Service]
User=$(whoami)
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/python $APP_DIR/server/server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT_EOF
    sudo systemctl daemon-reload
    sudo systemctl enable --now cloze-coach
    sudo systemctl restart cloze-coach
    echo "Installed as a system service. Restart: sudo systemctl restart cloze-coach   Logs: journalctl -u cloze-coach -f"
    ;;
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/com.clozecoach.server.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clozecoach.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP_DIR/.venv/bin/python</string>
    <string>$APP_DIR/server/server.py</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP_DIR/server/data/server.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/server/data/server.log</string>
</dict>
</plist>
PLIST_EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load -w "$PLIST"
    echo "Installed as a login item. Restart: launchctl kickstart -k gui/\$(id -u)/com.clozecoach.server   Log: server/data/server.log"
    ;;
  *)
    echo "Auto-start is only set up on Linux and macOS. Start it with: .venv/bin/python server/server.py"
    ;;
esac

PORT=$(grep -E '^PORT=' server/config.env | cut -d= -f2 || true)
echo "Open http://$(hostname -s).local:${PORT:-8000} on any device on the home network."
