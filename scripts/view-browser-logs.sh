#!/bin/bash
# View browser logs captured from the client
# Usage: ./scripts/view-browser-logs.sh [-f] [-n LINES] [-c]
#
# Options:
#   -f         Follow (tail -f) the log file
#   -n LINES   Show last N lines (default: 50)
#   -c         Clear the log file

LOG_FILE="tmp/browser-logs.txt"

# Default options
FOLLOW=false
LINES=50
CLEAR=false

# Parse options
while getopts "fn:c" opt; do
  case $opt in
    f) FOLLOW=true ;;
    n) LINES=$OPTARG ;;
    c) CLEAR=true ;;
    \?) echo "Invalid option: -$OPTARG" >&2; exit 1 ;;
  esac
done

# Clear log if requested
if [ "$CLEAR" = true ]; then
  echo "Clearing browser logs..."
  > "$LOG_FILE"
  echo "Logs cleared."
  exit 0
fi

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
  echo "No browser logs found at $LOG_FILE"
  echo "Logs will be created when the app is running and browser console is used."
  exit 0
fi

# Follow or show last N lines
if [ "$FOLLOW" = true ]; then
  echo "Following browser logs (Ctrl+C to stop)..."
  tail -f "$LOG_FILE"
else
  echo "Showing last $LINES lines of browser logs:"
  echo "---"
  tail -n "$LINES" "$LOG_FILE"
fi
