# SaaS Hybrid

SaaS Hybrid **薄控制面**：设备鉴权、LLM 代理、Sync、Quota。Agent 循环与工具在端上 `client-agent` 执行。

私有化「服务端跑 Agent」已迁至姊妹项目 [`java-agent-runtime`](../../java-agent-runtime)（`/v1/sessions/**`、工具与 SQLite）。

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

## Run locally

```bash
./mvnw -pl server spring-boot:run
```

API 默认监听 `http://localhost:8080`。

## Trust Demo Web UI

```bash
# terminal 1 — control plane
./mvnw -pl server spring-boot:run

# terminal 2 — static demo (serves client-agent so /web/ can import ../dist)
cd client-agent && npm run demo:web
```

浏览器打开 `http://localhost:5173/web/`：注册设备 → 发消息 → 👍/👎 → Memory 删除；勾选「上报采信」后可查 `GET /v1/trust/metrics`。

手动验收：发「我喜欢简体中文」→ Memory 出现 preference → 👎 或删除 Memory → 列表更新。

## Environment variables

| Variable | Description |
|----------|-------------|
| `SAAS_HYBRID_AGENT_API_KEY` | OpenAI-compatible API key（控制面 LLM/embeddings 上游） |
| `SAAS_HYBRID_AGENT_BASE_URL` | Chat Completions base URL (default: `https://api.openai.com`) |
| `SAAS_HYBRID_AGENT_MODEL` | Model name (default: `gpt-4o-mini`) |

## Phase A control plane

| Path | Auth | Notes |
|------|------|-------|
| `POST /v1/devices` | none | Register device → `{ deviceId, token, userId }` |
| `DELETE /v1/devices/{id}` | bearer | Revoke device token |
| `POST /v1/llm/chat` | bearer | SSE (default) or JSON (`stream: false`) |
| `POST /v1/llm/embeddings` | bearer | Returns `{ model, data: [{ embedding, index }] }` |
| `POST /v1/sync/push` | bearer | Mutation upload (Phase A **plaintext**, not E2E) |
| `GET /v1/sync/pull?since=cursor` | bearer | Monotonic cursor pull |
| `GET /v1/quota` | bearer | Usage vs limits |
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

OpenAPI: `client-agent/schemas/openapi-phase-a.yaml`

## Modules

- `server` — Spring Boot 控制面
- `client-agent` — 端上 ConversationLoop / Tools / Memory（TypeScript）

## Docs

- PRD: `docs/superpowers/specs/2026-07-27-client-agent-runtime-prd.md`
- Design: `docs/superpowers/specs/2026-08-03-saas-hybrid-agent-design.md`

## Non-goals（后置）

多租户账号体系、计费后台、管理控制台；同一会话端云混合执行工具。
