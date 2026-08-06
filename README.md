# SaaS Hybrid Agent

**On-device agent loop + thin cloud control plane** for personal assistants at scale.

**Multi-device by design:** the same account keeps conversations and Memory in sync across Web, phone, and tablet — pick up on one device where you left off on another.

**Low server footprint:** the agent loop, tools, and semantic retrieval run on the client. The cloud is only device auth, LLM proxying, Sync, quota, and trust metrics — no per-user agent Pod, no central vector index, no server-side tool loop. Server cost scales with Sync traffic and LLM gateway load, not with Memory index size or always-on runtimes.

## Why this shape

| Goal | How Hybrid delivers it |
|------|------------------------|
| **Multi-device continuity** | Sync push/pull keeps messages and Memory consistent across devices on the same account |
| **Low server footprint** | Control plane is auth + LLM gateway + Sync store + metrics — not AgentRuntime, not ANN, not tool execution |
| **Device-local context** | Tools and Memory use on-device state (files, clipboard, photos) without a fat backend |

For large-scale personal agents, three constraints rule out “one Pod per user” and a central ANN:

1. **Cost** — central embeddings/ANN grow linearly with users; Hybrid keeps retrieval on-device so the server stays thin.
2. **Context** — tools and Memory need device-local state.
3. **Continuity** — multi-device continuity needs Sync of messages/Memory, not a shared cloud semantic index.

**Product stance:** client owns the agent; cloud is a thin control plane. Sync stores **platform-readable** message and Memory replicas by default (optional E2E encryption is deferred). Trust signals improve on-device Memory and feed platform metrics — not a cross-user RAG corpus in Phase A.

## Architecture

```text
[Web / client]
  client-agent
    ConversationLoop · Tools · Memory · TrustSignalCollector
        │  LLM SSE / embeddings / sync / quota / trust events
        ▼
[saas-hybrid-agent server]   Control plane only
  /v1/devices  /v1/llm/*  /v1/sync/*  /v1/quota  /v1/trust/*

  provider=openai  → OpenAI-compatible Chat Completions
  provider=cursor  → local Python sidecar (Cursor SDK, streaming text)

[Self-hosted ops] ──HTTP /v1/sessions──► [java-agent-runtime]
  AgentRuntime + tools + SQLite (separate product)
```

| Layer | Responsibility |
|-------|----------------|
| `client-agent` | ConversationLoop, ToolHost, local Memory (semantic + episode), Sync client, trust apply + event queue |
| `server` | Thin control plane: device auth, rate limits / quota, LLM gateway, Sync store (multi-device), trust metrics — not agent runtime or ANN |
| `python-sidecar` | Holds `CURSOR_API_KEY`; streams Cursor Local Agent text into the same SSE shape |

## What's in Phase A (now)

- **Device register / revoke** and bearer-auth control-plane APIs
- **LLM gateway** — `POST /v1/llm/chat` (SSE or JSON), embeddings, static vision capabilities
- **Provider switch** — `openai` (tool-calling path) or `cursor` (sidecar text stream; request `tools` ignored)
- **Multimodal vision** — OpenAI-style content parts (`text` + `image_url` data URI); client + server gate non-vision models
- **Sync** — push/pull messages + Memory across devices (plaintext / platform-readable; multi-device continuity)
- **Trust flywheel** — on-device `applyTrust`; `POST /v1/trust/events` + `GET /v1/trust/metrics`
- **Web demo** — register device, chat, thumbs, Memory edit/delete, provider picker, image attach

## Roadmap

| Phase | Focus |
|-------|--------|
| **A** (current) | Web-first closed loop: TS runtime, LlmGateway, local Memory retrieval, Sync, sandbox file + HTTP tools, trust signals, vision |
| **B** | iOS / Android same-protocol runtime; on-device embeddings; procedural Memory; optional E2E Sync |
| **C** | Large workspace chunking; optional Dev Companion remote terminal; on-device small models for extract / rerank |

**Personal knowledge / multi-tool ingest track** (parallel; see [design §11](docs/superpowers/specs/2026-08-05-multi-tool-ingest-memory-design.md)):

| Stage | Focus |
|-------|--------|
| **I0** | Universal `ingest_event` + Cursor adapter → Episode/Workspace + Sync |
| **I1a** | Semantic / Procedural extraction from ingest (no new adapters) |
| **I1b** | Claude Code / Codex adapters — **deferred / not planned** |
| **I2** / **I2a** | Unified entry: recall Memory, openai tools vs cursor sidecar (no client tools), hybrid ingest |
| **I3** / **I3a** | Ingest ↔ trust on Episode/Procedural; delete/👎 lowers recall |
| **I3b** | Optional control-plane ingest event analytics — deferred |
| **I4** / **I4a** | MemoryPack import/export + read-only MCP (`memory_search` / `memory_get`) |
| **I4b** | Mobile runtime recall + optional E2E Sync — deferred |
| **I5** / **I5a** | Workspace content-hash chunking; on-device summary + lexical rerank |
| **I5b-A** | Chunk Sync: manifest-only Sync + on-demand `ChunkBackend` pull |
| **I5b-B** | Continue / Aider / OpenCode ingest adapters |
| **I5b-C** | Dev Companion session → `dev_companion` ingest (no cloud shell) |
| **I5b-D** | Pluggable on-device tiny model (`rules` / `tiny` / wasm loader) |

**Explicitly deferred / never:** multi-tenant billing console / admin UI; same-session hybrid tool execution (some tools on cloud workers); central cross-user vector search / public RAG; Cursor Cloud Agent / `/v1/agents/**`; mapping Cursor internal tools to control-plane `tool_calls`; cloud auto-rewrite of user Memory.

## Modules

| Path | Role |
|------|------|
| `server/` | Spring Boot control plane |
| `client-agent/` | TypeScript on-device runtime + Trust Demo Web UI + read-only Memory MCP |
| `python-sidecar/` | Optional Cursor Local Agent sidecar |
| `docs/superpowers/specs/` | PRD and design docs |

Read-only MCP (I4a) — load a MemoryPack then expose `memory_search` / `memory_get`:

```bash
cd client-agent
# after exporting a pack.json via exportMemoryPack
HYBRID_MEMORY_PACK=/path/to/pack.json npm run mcp
```

## Build

```bash
./mvnw -pl server -am test
```

```bash
cd client-agent && npm test
```

```bash
./mvnw -pl server -am package -DskipTests
```

```bash
cd python-sidecar && pytest   # optional; needs sidecar deps
```

## Run locally

One-shot: sidecar (optional) + Java control plane + Web demo:

```bash
./scripts/dev.sh
```

Stop all (ports / leftover processes):

```bash
./scripts/stop.sh
```

| Service | URL |
|---------|-----|
| Sidecar health | `http://127.0.0.1:8091/health` (`SKIP_CURSOR_SIDECAR=1` to skip) |
| Control plane | `http://localhost:8080/v1/health` |
| Web demo | `http://localhost:5173/web/` |

Control plane only:

```bash
./mvnw -pl server spring-boot:run
```

Demo in two terminals:

```bash
# terminal 1 — control plane
./mvnw -pl server spring-boot:run

# terminal 2 — static demo (serves client-agent so /web/ can import ../dist)
cd client-agent && npm run demo:web
```

Open `http://localhost:5173/web/`: register a device → send messages → 👍/👎 → delete Memory. With trust reporting enabled, inspect `GET /v1/trust/metrics`. The provider dropdown selects `openai` or `cursor`. Attach images when the model reports vision via `GET /v1/llm/capabilities`.

**Smoke check:** send “I prefer Simplified Chinese” → preference appears in Memory → 👎 or delete Memory → list updates.

## Environment variables

| Variable | Read by | Description |
|----------|---------|-------------|
| `SAAS_HYBRID_AGENT_API_KEY` | Java | OpenAI-compatible API key (`provider=openai`) |
| `SAAS_HYBRID_AGENT_BASE_URL` | Java | Chat Completions base URL (default: `https://api.openai.com`) |
| `SAAS_HYBRID_AGENT_MODEL` | Java | Model name (default: `gpt-4o-mini`) |
| `SAAS_HYBRID_AGENT_LLM_PROVIDER` | Java | Default provider: `openai` \| `cursor` (default: `openai`) |
| `CURSOR_SIDECAR_URL` | Java | Python sidecar base URL (default: `http://127.0.0.1:8091`) |
| `CURSOR_API_KEY` | **sidecar only** | Cursor key (`crsr_…`); **do not** put this in `SAAS_HYBRID_AGENT_API_KEY` |
| `CURSOR_MODEL` | sidecar | Cursor model (default: `composer-2.5`) |
| `CURSOR_AGENT_CWD` | sidecar | Local Agent working directory |
| `SKIP_CURSOR_SIDECAR` | `dev.sh` | Set to `1` to skip starting the sidecar |
| `SIDECAR_PORT` | `dev.sh` / sidecar | Sidecar port (default: `8091`) |

`POST /v1/llm/chat` may set `provider` per request. With `provider=cursor`, Java forwards to the local sidecar, **ignores** request `tools`, and responses **do not** include LLM `tool_calls` — the on-device Hybrid tool loop needs `provider=openai`.

**Vision:** user messages may use OpenAI-style content parts (`text` + `image_url` data URI). Non-vision models (e.g. `gpt-3.5-turbo`) disable image pick on the client and return `400` (`model_lacks_vision`) on the server. Default `gpt-4o-mini` supports vision; call `GET /v1/llm/capabilities` before attaching images.

## Control plane API (Phase A)

| Path | Auth | Notes |
|------|------|-------|
| `POST /v1/devices` | none | Register device → `{ deviceId, token, userId }` |
| `DELETE /v1/devices/{id}` | bearer | Revoke device token |
| `POST /v1/llm/chat` | bearer | SSE (default) or JSON (`stream: false`); `content` may be string or `[{ type, text?, image_url? }]` (images: user role only) |
| `GET /v1/llm/capabilities?model=&provider=` | bearer | `{ vision, model, provider? }` — static vision table; client gates image attach |
| `POST /v1/llm/embeddings` | bearer | `{ model, data: [{ embedding, index }] }` |
| `POST /v1/sync/push` | bearer | Mutation upload (Phase A **plaintext**, not E2E) |
| `GET /v1/sync/pull?since=cursor` | bearer | Monotonic cursor pull |
| `GET /v1/quota` | bearer | Usage vs limits |
| `POST /v1/trust/events` | bearer | Batch append; idempotent on `eventId` → `{ accepted, duplicates }` |
| `GET /v1/trust/metrics?from=&to=&grain=day` | bearer | Per-day counts by signal and `kind` |
| `GET /v1/health` | none | Health check |

```yaml
saas-hybrid-agent:
  control-plane:
    quota:
      llm-tokens-limit: 1000000
      embedding-calls-limit: 10000
    rate-limit:
      chat-requests-per-window: 1000
```

OpenAPI: [`client-agent/schemas/openapi-phase-a.yaml`](client-agent/schemas/openapi-phase-a.yaml)

## Docs

| Doc | Topic |
|-----|--------|
| [Client Agent Runtime PRD](docs/superpowers/specs/2026-07-27-client-agent-runtime-prd.md) | Product goals, phases, user stories |
| [SaaS Hybrid split design](docs/superpowers/specs/2026-08-03-saas-hybrid-agent-design.md) | Control plane vs private runtime boundary |
| [Trust signal / data flywheel](docs/superpowers/specs/2026-08-04-trust-signal-data-flywheel-design.md) | On-device Memory trust + control-plane metrics |
| [LLM OpenAI + Cursor sidecar](docs/superpowers/specs/2026-08-04-llm-openai-cursor-sidecar-design.md) | Provider routing and sidecar protocol |
| [Multimodal vision](docs/superpowers/specs/2026-08-05-multimodal-vision-design.md) | Image parts, capabilities gate, provider paths |
| [Personal KB competitive research](docs/superpowers/specs/2026-08-05-personal-kb-competitive-research.md) | Market scan; Go on ingest scheme A |
| [Multi-tool ingest → Memory](docs/superpowers/specs/2026-08-05-multi-tool-ingest-memory-design.md) | I0–I5 ingest track; Cursor → Episode/Workspace |

## Non-goals (deferred)

- Multi-tenant account system, billing console, admin UI
- Same-session hybrid execution (some tools on cloud workers)
- Central cross-user semantic search / public RAG knowledge base
- Default E2E Sync (optional later)
- Cursor Cloud Agent and mapping Cursor tools to `tool_calls`
