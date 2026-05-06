#!/bin/bash
set -e

PLIST_LABEL="com.smartmessages.sync"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="$(which node)"
CONFIG_PATH="$AGENT_DIR/config.json"

echo ""
echo "Smart Messages — Sync Agent Installer"
echo "======================================"
echo ""

# Check Node.js
if [ -z "$NODE_PATH" ]; then
  echo "Error: Node.js not found. Install it from https://nodejs.org"
  exit 1
fi
echo "Using Node.js: $NODE_PATH ($(node --version))"

# Prompt for config
if [ -f "$CONFIG_PATH" ]; then
  echo ""
  echo "Existing config found at $CONFIG_PATH"
  read -r -p "Reconfigure? [y/N] " RECONF
  if [[ ! "$RECONF" =~ ^[Yy]$ ]]; then
    echo "Keeping existing config."
    SKIP_CONFIG=true
  fi
fi

if [ -z "$SKIP_CONFIG" ]; then
  echo ""
  read -r -p "Server URL (e.g. https://your-app.onrender.com): " SERVER_URL
  read -r -p "Sync token (from Settings in the web app):       " SYNC_TOKEN

  if [ -z "$SERVER_URL" ] || [ -z "$SYNC_TOKEN" ]; then
    echo "Error: server URL and token are required."
    exit 1
  fi

  echo ""
  echo "How often should messages sync?"
  echo "  1) Every 5 minutes"
  echo "  2) Every 15 minutes"
  echo "  3) Every 30 minutes"
  echo "  4) Every hour"
  read -r -p "Choose [1-4, default 1]: " INTERVAL_CHOICE

  case "$INTERVAL_CHOICE" in
    2) INTERVAL_SECONDS=900;  INTERVAL_LABEL="15 minutes" ;;
    3) INTERVAL_SECONDS=1800; INTERVAL_LABEL="30 minutes" ;;
    4) INTERVAL_SECONDS=3600; INTERVAL_LABEL="1 hour"     ;;
    *) INTERVAL_SECONDS=300;  INTERVAL_LABEL="5 minutes"  ;;
  esac

  cat > "$CONFIG_PATH" <<EOF
{
  "serverUrl": "$SERVER_URL",
  "token": "$SYNC_TOKEN",
  "lastSync": 0
}
EOF
  echo "Config written to $CONFIG_PATH"
fi

# Read interval from existing config if skipping config step
if [ -n "$SKIP_CONFIG" ]; then
  # Check if plist already exists to extract current interval
  if [ -f "$PLIST_PATH" ]; then
    INTERVAL_SECONDS=$(grep -A1 "StartInterval" "$PLIST_PATH" | grep integer | tr -cd '0-9')
  fi
  INTERVAL_SECONDS="${INTERVAL_SECONDS:-300}"
  INTERVAL_LABEL="${INTERVAL_SECONDS} seconds"
fi

# Generate launchd plist
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_PATH</string>
    <string>$AGENT_DIR/index.js</string>
  </array>
  <key>StartInterval</key>
  <integer>$INTERVAL_SECONDS</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/smartmessages-sync.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/smartmessages-sync-error.log</string>
</dict>
</plist>
EOF

# Load / reload the agent
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "Sync agent installed — running every $INTERVAL_LABEL."
echo ""
echo "Logs:"
echo "  tail -f /tmp/smartmessages-sync.log"
echo "  tail -f /tmp/smartmessages-sync-error.log"
echo ""
echo "IMPORTANT: Node.js needs Full Disk Access to read your messages."
echo "  System Settings → Privacy & Security → Full Disk Access → add Node.js"
echo "  Node.js is usually at: $NODE_PATH"
echo ""
echo "To change the interval: re-run this script."
echo "To uninstall:           bash $AGENT_DIR/uninstall.sh"
echo ""
