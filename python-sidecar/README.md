# Python Cursor Sidecar

FastAPI sidecar that proxies text-only completion requests to the Cursor SDK. Used by the Java hybrid agent when `provider=cursor`.

## Endpoints

- `GET /health` → `{"status":"ok"}`
- `POST /v1/complete` — body `{model?, messages, cwd?, stream?}`
  - Non-stream: `{content, tool_calls: [], finish_reason}`
  - Stream: `text/event-stream` with `data: {"type":"delta","text":"..."}` events, then `done` or `error`

## Environment

- `CURSOR_API_KEY` — required for real runs (create at https://cursor.com/dashboard/integrations)
- `CURSOR_MODEL` — optional, default `composer-2.5`

## Run locally

```bash
cd python-sidecar
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8091
```

## Tests

```bash
cd python-sidecar
pip install -r requirements.txt
pytest -q
```

Tests inject a `FakeRunner` via `create_app(runner=...)` so `cursor-sdk` is not required at test time.
