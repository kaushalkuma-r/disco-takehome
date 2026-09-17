#!/usr/bin/env bash
# Start/stop/restart the local API on port ${PORT:-8000}, tracking only our own process via a pidfile.
set -e
cd "$(dirname "$0")"
PID=/tmp/campaign-studio-api.pid; PORT=${PORT:-8000}
stop() { if [ -f $PID ] && kill -0 "$(cat $PID)" 2>/dev/null; then kill "$(cat $PID)"; sleep 1; fi; rm -f $PID; }
start() { nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $PORT --log-level warning > /tmp/campaign-studio-api.log 2>&1 & echo $! > $PID; sleep 2.5; curl -sf localhost:$PORT/healthz && echo " (pid $(cat $PID))"; }
case "${1:-restart}" in start) start;; stop) stop;; restart) stop; start;; esac
