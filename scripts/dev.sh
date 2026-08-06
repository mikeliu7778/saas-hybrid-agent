#!/usr/bin/env bash
# Start python-sidecar (optional) + control-plane (backend) + Trust Demo Web UI (frontend).
# Usage: ./scripts/dev.sh
# Stop:  Ctrl+C  or  ./scripts/stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SIDECAR_PORT="${SIDECAR_PORT:-8091}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
SIDECAR_HEALTH_URL="http://127.0.0.1:${SIDECAR_PORT}/health"
HEALTH_URL="http://127.0.0.1:${BACKEND_PORT}/v1/health"
WEB_URL="http://localhost:${FRONTEND_PORT}/web/"

SIDECAR_PID=""
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM
  echo ""
  echo "Stopping…"
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
    wait "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${SIDECAR_PID}" ]] && kill -0 "${SIDECAR_PID}" 2>/dev/null; then
    kill "${SIDECAR_PID}" 2>/dev/null || true
    wait "${SIDECAR_PID}" 2>/dev/null || true
  fi
  pkill -P $$ 2>/dev/null || true
  echo "Stopped."
}
trap cleanup EXIT INT TERM

wait_for_url() {
  local url="$1"
  local label="$2"
  local tries="${3:-60}"
  echo "Waiting for ${label} ${url} …"
  for ((i = 1; i <= tries; i++)); do
    if curl -sf "${url}" >/dev/null 2>&1; then
      echo "${label} is up."
      return 0
    fi
    sleep 1
  done
  echo "ERROR: ${label} did not become healthy within ${tries}s" >&2
  return 1
}

ensure_sidecar_venv() {
  local venv="${ROOT}/python-sidecar/.venv"
  if [[ ! -x "${venv}/bin/uvicorn" ]]; then
    echo "Creating python-sidecar venv…"
    python3 -m venv "${venv}"
    "${venv}/bin/pip" install -r "${ROOT}/python-sidecar/requirements.txt"
  fi
}

if [[ ! -x "${ROOT}/mvnw" ]]; then
  echo "ERROR: mvnw not found at ${ROOT}/mvnw" >&2
  exit 1
fi

if [[ ! -d "${ROOT}/client-agent/node_modules" ]]; then
  echo "Installing client-agent dependencies…"
  (cd "${ROOT}/client-agent" && npm install)
fi

if [[ "${SKIP_CURSOR_SIDECAR:-}" != "1" ]]; then
  if [[ ! -d "${ROOT}/python-sidecar" ]]; then
    echo "ERROR: python-sidecar not found" >&2
    exit 1
  fi
  ensure_sidecar_venv
  echo "Starting Cursor sidecar on 127.0.0.1:${SIDECAR_PORT} …"
  (
    cd "${ROOT}/python-sidecar"
    "${ROOT}/python-sidecar/.venv/bin/uvicorn" app:app --host 127.0.0.1 --port "${SIDECAR_PORT}"
  ) &
  SIDECAR_PID=$!
  wait_for_url "${SIDECAR_HEALTH_URL}" "Sidecar"
else
  echo "Skipping Cursor sidecar (SKIP_CURSOR_SIDECAR=1)."
fi

echo "Starting backend on :${BACKEND_PORT} …"
export CURSOR_SIDECAR_URL="http://127.0.0.1:${SIDECAR_PORT}"
(
  cd "${ROOT}"
  ./mvnw -pl server spring-boot:run
) &
BACKEND_PID=$!

wait_for_url "${HEALTH_URL}" "Backend"

echo "Building + starting frontend on :${FRONTEND_PORT} …"
(
  cd "${ROOT}/client-agent"
  npm run build
  npx --yes serve -p "${FRONTEND_PORT}" .
) &
FRONTEND_PID=$!

echo ""
echo "Ready."
if [[ -n "${SIDECAR_PID}" ]]; then
  echo "  Sidecar:  ${SIDECAR_HEALTH_URL}"
fi
echo "  Backend:  ${HEALTH_URL}"
echo "  Frontend: ${WEB_URL}"
if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "  Note: CURSOR_API_KEY is unset — provider=cursor will fail until set."
fi
if [[ -z "${SAAS_HYBRID_AGENT_API_KEY:-}" ]]; then
  echo "  Note: SAAS_HYBRID_AGENT_API_KEY is unset — provider=openai LLM/embeddings will fail until set."
fi
echo "Press Ctrl+C to stop all."
echo ""

wait
