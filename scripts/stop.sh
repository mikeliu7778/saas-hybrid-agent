#!/usr/bin/env bash
# Stop local SaaS Hybrid Agent services started by ./scripts/dev.sh
# (or left running after a crashed terminal).
# Usage: ./scripts/stop.sh
set -euo pipefail

SIDECAR_PORT="${SIDECAR_PORT:-8091}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

kill_port() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    echo "${label} (:${port}): not running"
    return 0
  fi
  echo "${label} (:${port}): stopping PIDs ${pids//$'\n'/ }"
  # shellcheck disable=SC2086
  kill ${pids} 2>/dev/null || true
  sleep 0.5
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "${label} (:${port}): force kill ${pids//$'\n'/ }"
    # shellcheck disable=SC2086
    kill -9 ${pids} 2>/dev/null || true
  fi
}

# Also stop orphaned children that may not hold the listen socket briefly.
kill_patterns() {
  local pattern="$1"
  local label="$2"
  if pgrep -f "${pattern}" >/dev/null 2>&1; then
    echo "${label}: matching '${pattern}'"
    pkill -f "${pattern}" 2>/dev/null || true
  fi
}

echo "Stopping SaaS Hybrid Agent local services…"
kill_port "${FRONTEND_PORT}" "Frontend"
kill_port "${BACKEND_PORT}" "Backend"
kill_port "${SIDECAR_PORT}" "Sidecar"

kill_patterns "uvicorn app:app .*${SIDECAR_PORT}" "Sidecar (uvicorn)"
kill_patterns "spring-boot:run" "Backend (mvn spring-boot:run)"
kill_patterns "serve -p ${FRONTEND_PORT}" "Frontend (serve)"

echo "Done."
