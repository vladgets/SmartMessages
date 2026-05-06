#!/bin/bash
# Runs a single sync and exits. No background service is installed.
cd "$(dirname "$0")"

if [ ! -f "config.json" ]; then
  echo "Error: config.json not found. Make sure you're running this from the SmartMessages-SyncAgent folder."
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "Error: Node.js not found. Install it from https://nodejs.org"
  exit 1
fi

node index.js "$@"
