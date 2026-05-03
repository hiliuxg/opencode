#!/bin/sh
set -eu

cfg="${CC_CONNECT_CONFIG:-/root/.config/cc-connect/config.toml}"
port="${OPENCODE_PORT:-4096}"
base="${OPENCODE_BASE_PATH:-}"
level="${OPENCODE_LOG_LEVEL:-INFO}"
cors="${OPENCODE_CORS:-*}"
timeout="${OPENCODE_BOOT_TIMEOUT:-60}"
tick="${OPENCODE_MONITOR_INTERVAL:-5}"
url="http://127.0.0.1:${port}${base}/global/health"
api=""
conn=""

stop() {
  if [ -n "$conn" ]; then
    kill "$conn" 2>/dev/null || true
  fi

  if [ -n "$api" ]; then
    kill "$api" 2>/dev/null || true
  fi
}

trap 'stop; exit 0' INT TERM
trap stop EXIT

if [ "${1:-both}" != "both" ]; then
  exec "$@"
fi

opencode --print-logs --log-level "$level" serve \
  --hostname 0.0.0.0 \
  --port "$port" \
  --cors "$cors" &
api="$!"

i=0
ready=0
while [ "$i" -lt "$timeout" ]; do
  if curl -fsS "$url" >/dev/null 2>&1; then
    ready=1
    break
  fi

  if ! kill -0 "$api" 2>/dev/null; then
    echo "opencode exited before becoming healthy" >&2
    wait "$api" || true
    exit 1
  fi

  i=$((i + 1))
  sleep 1
done

if [ "$ready" != "1" ]; then
  echo "opencode did not become healthy: $url" >&2
  exit 1
fi

cc-connect --config "$cfg" &
conn="$!"

while kill -0 "$conn" 2>/dev/null; do
  if ! kill -0 "$api" 2>/dev/null; then
    echo "opencode exited while cc-connect was running" >&2
    kill "$conn" 2>/dev/null || true
    wait "$api" || true
    wait "$conn" || true
    exit 1
  fi

  sleep "$tick"
done

code=0
wait "$conn" || code="$?"
exit "$code"
