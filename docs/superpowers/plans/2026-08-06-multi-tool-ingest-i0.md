# Multi-tool Ingest I0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship I0 — universal `ingest_event` schema, Python Cursor adapter + scrub, client-agent `applyIngest` writing Episode/Workspace, Sync-friendly persistence, and a Demo path to prove “Cursor session → Hybrid remembers.”

**Architecture:** Python normalizes Cursor transcripts into `ingest_event[]` (no full transcript in events). `client-agent` is the sole Memory writer via `applyIngest`. Java control plane unchanged (no Cursor format parsing). Optional local HTTP deliver into the Web demo.

**Tech Stack:** TypeScript (`client-agent` + vitest), Python (`python-sidecar` + pytest/FastAPI), existing Sync/Memory stores.

## Global Constraints

- No central ANN / cloud Memory rewrite.
- Events must not carry full conversation bodies by default.
- Secrets scrub required before deliver / apply.
- Idempotent on `event_id`.
- I0 kinds applied: `session_summary` → Episode, `file_touch` → Workspace paths; `decision` / `procedure_draft` may be ignored or queued no-op.
- Claude/Codex adapters and unified dispatch are out of scope (I1/I2).

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `client-agent/src/ingest/types.ts` | `IngestEvent` types |
| `client-agent/src/ingest/scrub.ts` | Client-side scrub helper (defense in depth) |
| `client-agent/src/ingest/applyIngest.ts` | Pure apply rules → episode upserts + workspace paths |
| `client-agent/src/memory/InMemoryMemoryStore.ts` | `applyIngest`, optional episode `source` fields, `listEpisode` |
| `client-agent/src/storage/PersistedMemoryStore.ts` | Persist after applyIngest |
| `client-agent/src/runtime/types.ts` | `MemoryOrchestrator.applyIngest?` |
| `client-agent/src/runtime/DefaultClientAgentRuntime.ts` | Expose `applyIngest` if needed by demo |
| `client-agent/test/ingest-apply.test.ts` | TDD for apply + scrub |
| `python-sidecar/ingest/schema.py` | Validate events |
| `python-sidecar/ingest/scrub.py` | Secret scrubbing |
| `python-sidecar/ingest/adapters/cursor.py` | Transcript → events |
| `python-sidecar/ingest/deliver.py` | Optional HTTP POST to client |
| `python-sidecar/app.py` (or `app_ingest` routes) | `POST /v1/ingest/run` |
| `python-sidecar/tests/test_ingest_*.py` | Schema / scrub / cursor / API |
| `python-sidecar/fixtures/cursor_transcript.jsonl` | Test fixture |
| `client-agent/web/*` | Demo: ingest sample events + list episodes |
| `docs/.../2026-08-05-multi-tool-ingest-memory-design.md` | Mark I0 in progress / done notes |

---

### Task 1: TS `IngestEvent` + scrub + `applyIngest` (TDD)

**Files:**
- Create: `client-agent/src/ingest/types.ts`
- Create: `client-agent/src/ingest/scrub.ts`
- Create: `client-agent/src/ingest/applyIngest.ts`
- Create: `client-agent/test/ingest-apply.test.ts`

**Steps:**

- [x] **Step 1: Write failing tests** for scrub (API key redacted) and apply (`session_summary` → episode id `epi-ingest-{event_id}`, idempotent; `file_touch` → workspace path; ignore `raw_marker`).
- [x] **Step 2: Run tests — expect fail.**
- [x] **Step 3: Implement types, scrub, applyIngest pure functions.**
- [x] **Step 4: Run tests — expect pass.**
- [ ] **Step 5: Commit** `feat(ingest): applyIngest and scrub for I0 events`

---

### Task 2: Wire MemoryStore + Runtime + exports

**Files:**
- Modify: `InMemoryMemoryStore.ts`, `PersistedMemoryStore.ts`, `runtime/types.ts`, `DefaultClientAgentRuntime.ts`, `index.ts`
- Extend `EpisodeRow` with optional `source?`, `nativeSessionId?`

**Steps:**

- [ ] **Step 1: Add store test** that `memory.applyIngest(events)` upserts episode + paths and second call is no-op.
- [ ] **Step 2: Implement** `applyIngest` on store (call pure apply, embed summaries via existing `embed`), flush in PersistedMemoryStore, `listEpisode()`, Runtime passthrough.
- [ ] **Step 3: Export from `index.ts`.**
- [ ] **Step 4: `npm test` green.**
- [ ] **Step 5: Commit** `feat(memory): applyIngest on store and runtime`

---

### Task 3: Python schema + scrub (TDD)

**Files:**
- Create: `python-sidecar/ingest/__init__.py`, `schema.py`, `scrub.py`
- Create: `python-sidecar/tests/test_ingest_schema.py`, `test_ingest_scrub.py`

**Steps:**

- [ ] **Step 1: Failing tests** — valid event passes; missing `event_id` fails; `sk-` / `crsr_` scrubbed from summary.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: `pytest` green.**
- [ ] **Step 4: Commit** `feat(ingest): python schema and scrub`

---

### Task 4: Python Cursor adapter (TDD)

**Files:**
- Create: `python-sidecar/ingest/adapters/__init__.py`, `cursor.py`
- Create: `python-sidecar/fixtures/cursor_transcript.jsonl`
- Create: `python-sidecar/tests/test_ingest_cursor.py`

**Steps:**

- [ ] **Step 1: Fixture** OpenAI/Cursor-like JSONL lines with user/assistant text + a fake path mention + fake API key.
- [ ] **Step 2: Failing test** — adapter returns ≥1 `session_summary` + `file_touch`s; summary has no secret; stable `event_id`.
- [ ] **Step 3: Implement** path heuristics + rule summary (truncate), scrub before return.
- [ ] **Step 4: Commit** `feat(ingest): cursor transcript adapter`

---

### Task 5: Python HTTP `POST /v1/ingest/run`

**Files:**
- Modify: `python-sidecar/app.py` (mount ingest routes) or add router
- Create: `python-sidecar/ingest/deliver.py` (optional forward to `INGEST_DELIVER_URL`)
- Create: `python-sidecar/tests/test_ingest_api.py`

**Steps:**

- [ ] **Step 1: API test** — body `{ "transcript_path": <fixture> }` or `{ "events": [...] }` returns scrubbed events; optional deliver mocked.
- [ ] **Step 2: Implement** endpoint; keep `/v1/complete` unchanged.
- [ ] **Step 3: Commit** `feat(ingest): POST /v1/ingest/run on sidecar`

---

### Task 6: Web demo — apply sample ingest + show episodes

**Files:**
- Modify: `client-agent/web/index.html`, `app.js`
- Optionally call sidecar or apply embedded fixture JSON

**Steps:**

- [ ] **Step 1: UI** button “Ingest sample Cursor session”; list Episode summaries + workspace hints in Memory panel.
- [ ] **Step 2: Wire** `runtime` / memory `applyIngest` after register.
- [ ] **Step 3: Manual smoke via `./scripts/dev.sh` (document in README briefly).
- [ ] **Step 4: Commit** `feat(web): demo ingest sample into Episode memory`

---

### Task 7: Docs touch-up

**Files:**
- Modify: design status → 实现中/已实现；README Docs table link to research + ingest design

**Steps:**

- [ ] **Step 1: Update design status and README docs links.**
- [ ] **Step 2: Commit** `docs: mark ingest I0 and link specs`

---

## Done when

1. `cd client-agent && npm test` green (incl. ingest tests).
2. `cd python-sidecar && pytest` green (incl. ingest tests).
3. Demo can ingest sample → Episode appears; secret not stored.
4. Duplicate ingest same `event_id` does not duplicate episodes.
