#!/bin/bash
# Thin launcher — opens Terminal.app to run the real startup script.
# macOS runs .app executables without a TTY, so we need Terminal for user-visible output.

CONTENTS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
START_SCRIPT="$CONTENTS_DIR/Resources/start.sh"

if [ ! -f "$START_SCRIPT" ]; then
  osascript -e 'display dialog "Mirrai start script not found. Please reinstall." buttons {"OK"} default button 1 with title "Mirrai" with icon stop'
  exit 1
fi

osascript <<EOF
tell application "Terminal"
  activate
  do script "clear && exec bash '${START_SCRIPT}'"
end tell
EOF
