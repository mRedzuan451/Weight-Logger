#!/usr/bin/env bash
set -euo pipefail

PORT=${PORT:-8080}
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGIN_URL="http://localhost:${PORT}/login.html"

# Start a simple HTTP server in the background
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "${PORT}" --directory "${ROOT_DIR}" &
  SERVER_PID=$!
elif command -v python >/dev/null 2>&1; then
  python -m http.server "${PORT}" --directory "${ROOT_DIR}" &
  SERVER_PID=$!
else
  echo "Python is required to run the local server." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

sleep 1

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${LOGIN_URL}" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "${LOGIN_URL}" >/dev/null 2>&1 &
elif command -v start >/dev/null 2>&1; then
  start "" "${LOGIN_URL}" >/dev/null 2>&1 &
else
  echo "Open your browser and navigate to ${LOGIN_URL}" >&2
fi

wait "${SERVER_PID}"
