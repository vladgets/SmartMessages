#!/bin/bash
PLIST_LABEL="com.smartmessages.sync"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null && echo "Agent stopped." || echo "Agent was not running."
rm -f "$PLIST_PATH" && echo "Plist removed."
echo "Sync agent uninstalled."
