#!/usr/bin/env bash
# Build the VoltIQ web app and serve the whole platform (website + API) from one server.
#   ./start.sh                      -> http://127.0.0.1:8000
#   HOST=0.0.0.0 PORT=8080 ./start.sh   (reachable from other devices on your network)
#   SKIP_BUILD=1 ./start.sh         (reuse the existing frontend build)
set -euo pipefail
cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "› Creating Python environment…"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --upgrade pip >/dev/null
  backend/.venv/bin/pip install -r backend/requirements.txt
fi

if [ ! -d frontend/node_modules ]; then
  echo "› Installing frontend dependencies…"
  (cd frontend && npm ci)
fi

if [ "${SKIP_BUILD:-0}" != "1" ] || [ ! -f frontend/dist/index.html ]; then
  echo "› Building web app…"
  (cd frontend && npm run build >/dev/null)
fi

echo "› VoltIQ is running at http://${HOST}:${PORT}  (API docs: /docs, stop with Ctrl+C)"
cd backend
exec .venv/bin/uvicorn main:app --host "$HOST" --port "$PORT"
