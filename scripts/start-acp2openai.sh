#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.droidrun-local/runtime"
PID_FILE="$RUNTIME_DIR/acp2openai.pid"
LOG_FILE="$RUNTIME_DIR/acp2openai.log"
HEALTH_URL="${ACP2OPENAI_HEALTH_URL:-http://127.0.0.1:3456/health}"
CONFIG_FILE="$ROOT_DIR/acp2openai.config.json"

mkdir -p "$RUNTIME_DIR"

if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "acp2openai already running at $HEALTH_URL"
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "acp2openai process $OLD_PID is still starting; waiting for health check"
  else
    rm -f "$PID_FILE"
  fi
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing config file: $CONFIG_FILE" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH" >&2
  exit 1
fi

if [[ ! -f "$PID_FILE" ]]; then
  (
    cd "$ROOT_DIR"
    export ACP2OPENAI_CONFIG="$CONFIG_FILE"
    nohup npm run example:hono >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  )
  echo "starting acp2openai..."
fi

for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "acp2openai is healthy at $HEALTH_URL"
    exit 0
  fi
  sleep 1
done

echo "acp2openai failed to become healthy; tailing log:" >&2
tail -n 80 "$LOG_FILE" >&2 || true
exit 1
