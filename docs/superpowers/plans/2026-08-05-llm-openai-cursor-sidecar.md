# OpenAI + Cursor Sidecar LLM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `POST /v1/llm/chat` route `provider=cursor` to a Python Cursor SDK sidecar with real streaming, while keeping the OpenAI-compatible path and client-agent tool loop unchanged.

**Architecture:** Java `LlmGatewayService` resolves `provider` (request or default). OpenAI uses existing Spring AI `ChatModel`. Cursor uses `CursorSidecarClient` → FastAPI `python-sidecar` (`Agent.create` + `send` + `stream`) → map text deltas to existing SSE `{type:delta|done}` with cursors. Tools are ignored on the cursor path.

**Tech Stack:** Java 17 / Spring Boot 3, JDK `HttpClient` (or Spring `WebClient` if already on classpath), Python 3.11+ FastAPI + uvicorn + `cursor-sdk`, TypeScript `client-agent`, vitest / JUnit / pytest.

## Global Constraints

- Unify on `POST /v1/llm/chat`; no `/v1/agents/**` in phase 1.
- Cursor runtime: **Local** only; model default `composer-2.5`.
- Cursor path: **text only** — ignore request `tools`; never emit sidecar-originated `tool_call` SSE.
- `CURSOR_API_KEY` lives **only** in the sidecar process.
- Sidecar listens on `127.0.0.1:8091` by default.
- Device Bearer auth stays on Java; sidecar is localhost-only.
- Error codes: `cursor_sidecar_unavailable` (503), `cursor_unauthorized` (502), `cursor_run_failed` (502) — keep device 401 distinct from Cursor auth failures.
- Prompt for Cursor: flatten messages to one string: each line `{role}: {content}` joined by `\n\n` (tool role included as text).
- Reference: `/Users/liubing/work/feedForge/wp_niche/ai.py` (`CursorProvider`).

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `python-sidecar/app.py` | FastAPI health + `/v1/complete` |
| `python-sidecar/cursor_runner.py` | Cursor SDK create/send/stream; injectable for tests |
| `python-sidecar/requirements.txt` | deps |
| `python-sidecar/tests/test_app.py` | health + complete with fake runner |
| `server/.../dto/LlmChatRequest.java` | add `provider` |
| `server/.../config/SaasHybridAgentProperties.java` | `llm.default-provider`, `cursor-sidecar-url` |
| `server/.../llm/CursorSidecarClient.java` | HTTP to sidecar |
| `server/.../llm/CursorSidecarException.java` | typed errors + codes |
| `server/.../llm/LlmGatewayService.java` | provider routing |
| `server/.../api/ApiExceptionHandler.java` | map CursorSidecarException |
| `server/src/test/.../CursorLlmGatewayTest.java` | MockWebServer sidecar |
| `client-agent/src/llm/HttpLlmTransport.ts` | send `provider` |
| `client-agent/web/*` | provider selector |
| `scripts/dev.sh` | start sidecar + Java + web |
| `README.md` / OpenAPI | document provider + env |

---

### Task 1: Python sidecar (TDD with fake runner)

**Files:**
- Create: `python-sidecar/app.py`
- Create: `python-sidecar/cursor_runner.py`
- Create: `python-sidecar/requirements.txt`
- Create: `python-sidecar/README.md`
- Create: `python-sidecar/tests/test_app.py`
- Create: `python-sidecar/pytest.ini` (or `pyproject.toml` minimal)

**Interfaces:**
- Produces:
  - `GET /health` → `{"status":"ok"}`
  - `POST /v1/complete` body `{model?, messages, cwd?, stream?}`
  - Non-stream: `{content, tool_calls: [], finish_reason}`
  - Stream: `text/event-stream` events `data: {"type":"delta","text":"..."}` then `done` / `error`
- `cursor_runner.run_stream(prompt, model, cwd) -> Iterator[str]` text chunks
- `cursor_runner.run_complete(prompt, model, cwd) -> str`

- [ ] **Step 1: Write failing pytest**

```python
# python-sidecar/tests/test_app.py
from fastapi.testclient import TestClient
from app import create_app

class FakeRunner:
    def run_complete(self, prompt, model, cwd):
        assert "user:" in prompt
        return "hello from fake"

    def run_stream(self, prompt, model, cwd):
        yield "hel"
        yield "lo"

def test_health():
    client = TestClient(create_app(FakeRunner()))
    assert client.get("/health").json()["status"] == "ok"

def test_complete_non_stream():
    client = TestClient(create_app(FakeRunner()))
    r = client.post("/v1/complete", json={
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "hello from fake"
    assert body["tool_calls"] == []

def test_complete_stream():
    client = TestClient(create_app(FakeRunner()))
    with client.stream("POST", "/v1/complete", json={
        "messages": [{"role": "user", "content": "hi"}],
        "stream": True,
    }) as r:
        assert r.status_code == 200
        text = "".join(r.iter_text())
    assert '"type":"delta"' in text or '"type": "delta"' in text
    assert "done" in text
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd python-sidecar && python -m venv .venv && . .venv/bin/activate
pip install fastapi uvicorn httpx pytest
pytest -q
```

Expected: import/app missing.

- [ ] **Step 3: Implement app + fake-friendly runner**

`messages_to_prompt(messages)`:

```python
def messages_to_prompt(messages: list[dict]) -> str:
    parts = []
    for m in messages:
        role = m.get("role") or "user"
        content = m.get("content") or ""
        parts.append(f"{role}: {content}")
    return "\n\n".join(parts)
```

`create_app(runner=None)` uses `CursorSdkRunner()` when runner is None.

`CursorSdkRunner` (real):

```python
# Align with wp_niche but streaming:
from cursor_sdk import Agent, AgentOptions, LocalAgentOptions

# create agent, send(prompt), for event in run.stream():
#   if assistant text blocks → yield text
# wait(); if status error → raise CursorRunError
```

Missing `CURSOR_API_KEY` → raise error mapped to HTTP 502 body `{"type":"error","code":"cursor_unauthorized","message":"..."}` for stream first event, or JSON error for non-stream.

Listen binding documented as `uvicorn app:app --host 127.0.0.1 --port 8091`.

`requirements.txt`:

```
fastapi>=0.115
uvicorn[standard]>=0.30
cursor-sdk
httpx
pytest
```

- [ ] **Step 4: pytest PASS**

- [ ] **Step 5: Commit**

```bash
git add python-sidecar
git commit -m "feat(python-sidecar): FastAPI Cursor complete endpoint with stream"
```

---

### Task 2: Java config + `provider` on request

**Files:**
- Modify: `server/src/main/resources/application.yml`
- Modify: `server/src/main/java/com/github/saashybridagent/config/SaasHybridAgentProperties.java`
- Modify: `server/src/main/java/com/github/saashybridagent/controlplane/dto/LlmChatRequest.java`
- Test: extend or add unit test that request deserializes `provider`

**Interfaces:**
- Produces: `LlmChatRequest.provider()` optional `String`
- Properties: `getLlm().getDefaultProvider()`, `getLlm().getCursorSidecarUrl()`

- [ ] **Step 1: Failing test** — Jackson deserialize `{"messages":[{"role":"user","content":"x"}],"provider":"cursor"}` → provider equals `cursor`.

- [ ] **Step 2: Implement record field + yaml:**

```yaml
saas-hybrid-agent:
  llm:
    default-provider: ${SAAS_HYBRID_AGENT_LLM_PROVIDER:openai}
    cursor-sidecar-url: ${CURSOR_SIDECAR_URL:http://127.0.0.1:8091}
```

Nested `Llm` class on `SaasHybridAgentProperties` with setters for Boot binding.

- [ ] **Step 3: `./mvnw -pl server -am test` green (existing + new)**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(server): add llm provider field and cursor sidecar config"
```

---

### Task 3: `CursorSidecarClient` + gateway routing (TDD)

**Files:**
- Create: `server/.../llm/CursorSidecarException.java`
- Create: `server/.../llm/CursorSidecarClient.java`
- Modify: `server/.../llm/LlmGatewayService.java`
- Modify: `server/.../api/ApiExceptionHandler.java`
- Create: `server/src/test/java/.../CursorLlmGatewayTest.java`

**Interfaces:**
- Consumes: `cursor-sidecar-url`, `LlmChatRequest`
- Produces:
  - `CursorSidecarClient.complete(request) -> Map`
  - `CursorSidecarClient.stream(request, emitter, seq)` or return Flux-like callback
  - `resolveProvider(request) -> "openai"|"cursor"`

- [ ] **Step 1: Write `CursorLlmGatewayTest` with MockWebServer**

Use OkHttp MockWebServer (add test dependency if needed) **or** WireMock. Prefer JDK approach: spin a tiny `HttpServer` in the test that returns JSON / SSE.

```java
@Test
void cursorProviderNonStreamUsesSidecarNotChatModel() throws Exception {
  // sidecar returns {"content":"from-cursor","tool_calls":[],"finish_reason":"stop"}
  // POST /v1/llm/chat with provider=cursor, stream=false
  // expect content from-cursor
  // verify ChatModel never called (still @MockBean — never stubbed interaction)
}
```

```java
@Test
void cursorSidecarDownReturns503() throws Exception {
  // point cursor-sidecar-url to closed port
  // expect status 503 and $.code = cursor_sidecar_unavailable
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`CursorSidecarException(String code, HttpStatus status, String message)`.

`CursorSidecarClient` using `java.net.http.HttpClient`:
- POST `{base}/v1/complete` with JSON `{model, messages, stream}` (no tools).
- Non-stream: parse JSON map; ensure `tool_calls` empty list if missing.
- Stream: read SSE lines `data: {...}`, for each delta/done call into same `sendEvent` path as `LlmGatewayService` (extract package-visible helper or pass `BiConsumer`).

`LlmGatewayService.complete/stream`:
```java
String provider = effectiveProvider(request);
if ("cursor".equalsIgnoreCase(provider)) {
  return cursorSidecarClient.complete(request, userId); // still call ensureAllowed first
}
// existing chatModel path
```

`effectiveProvider`: request.provider() if non-blank else properties default.

Handler:
```java
@ExceptionHandler(CursorSidecarException.class)
ResponseEntity<ErrorResponse> cursor(CursorSidecarException ex) {
  return ResponseEntity.status(ex.getStatus()).body(ErrorResponse.of(ex.getCode(), ex.getMessage()));
}
```

- [ ] **Step 4: Full server tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): route provider=cursor to Python sidecar"
```

---

### Task 4: client-agent + Web provider

**Files:**
- Modify: `client-agent/src/llm/HttpLlmTransport.ts`
- Modify: `client-agent/src/runtime/createBrowserRuntime.ts` (optional `provider` option)
- Modify: `client-agent/web/index.html`, `app.js`
- Modify: `client-agent/test/http-llm-transport.test.ts`

**Interfaces:**
- `HttpLlmTransportOptions.provider?: string` included in POST body when set.

- [ ] **Step 1: Failing test** — mock fetch asserts body contains `"provider":"cursor"`.

- [ ] **Step 2: Implement transport + web `<select id="provider">` openai/cursor**; pass into runtime/transport on register/send.

- [ ] **Step 3: `npm test` PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(client-agent): send llm provider and expose selector in web demo"
```

---

### Task 5: `dev.sh` + docs + OpenAPI

**Files:**
- Modify: `scripts/dev.sh`
- Modify: `README.md`
- Modify: `client-agent/schemas/openapi-phase-a.yaml`
- Modify: `docs/superpowers/specs/2026-08-04-llm-openai-cursor-sidecar-design.md` status → 实现中/已实现

- [ ] **Step 1: Update `dev.sh`**

Order:
1. Optionally start sidecar unless `SKIP_CURSOR_SIDECAR=1`
2. Wait `http://127.0.0.1:8091/health`
3. Start Java, wait `/v1/health`
4. Start web

```bash
SIDECAR_PORT="${SIDECAR_PORT:-8091}"
# python-sidecar/.venv/bin/uvicorn app:app --host 127.0.0.1 --port $SIDECAR_PORT
```

Print notes for `CURSOR_API_KEY` and `SAAS_HYBRID_AGENT_API_KEY`.

- [ ] **Step 2: README table** — document `provider`, env vars, Cursor vs OpenAI keys.

- [ ] **Step 3: OpenAPI** — `provider` on chat request; description of cursor path limitations (no tool_calls).

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: wire cursor sidecar into dev script and OpenAPI"
```

---

### Task 6: Acceptance evidence

- [ ] **Step 1: Run**

```bash
cd python-sidecar && .venv/bin/pytest -q
./mvnw -pl server -am test
cd client-agent && npm test && npm run build
```

- [ ] **Step 2: Manual** (if key available): `CURSOR_API_KEY=... ./scripts/dev.sh`, Web select `cursor`, send message — streaming text, no OpenAI 401.

- [ ] **Step 3: Checklist vs design §9 in report commit only if gaps fixed**

```bash
git commit -m "test: verify openai/cursor llm provider acceptance"  # only if code changes
```

---

## Spec Coverage

| Spec § | Task |
|--------|------|
| Sidecar health + complete stream/non-stream | 1 |
| provider field + config | 2 |
| Java routing + errors | 3 |
| client/web provider | 4 |
| dev.sh + docs | 5 |
| Acceptance | 6 |
| No tool_call from cursor | 1+3 |
| Local composer-2.5 | 1 |

## Self-Review Notes

- Locked `cursor_unauthorized` → **502** (not 401) so device auth stays clear.
- Message flatten format locked in Global Constraints.
- No WireMock required if in-process `HttpServer` used in tests.
- Existing uncommitted `scripts/dev.sh` / README edits should be folded into Task 5 rather than left dirty.
