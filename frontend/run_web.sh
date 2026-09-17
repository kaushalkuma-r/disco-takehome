#!/usr/bin/env bash
# Start/stop the Next.js dev server on ${PORT:-3100}, tracking only our own process via a pidfile.
set -e
cd "$(dirname "$0")"
PID=/tmp/campaign-studio-web.pid; PORT=${PORT:-3100}
stop() { if [ -f $PID ] && kill -0 "$(cat $PID)" 2>/dev/null; then kill "$(cat $PID)"; sleep 1; fi; rm -f $PID; }
start() { nohup npx next dev -p $PORT > /tmp/campaign-studio-web.log 2>&1 & echo $! > $PID; for i in $(seq 1 30); do curl -sf -o /dev/null localhost:$PORT/login/ && { echo "web up on :$PORT (pid $(cat $PID))"; return; }; sleep 1; done; echo "web failed"; tail -5 /tmp/campaign-studio-web.log; exit 1; }
case "${1:-restart}" in start) start;; stop) stop;; restart) stop; start;; esac
