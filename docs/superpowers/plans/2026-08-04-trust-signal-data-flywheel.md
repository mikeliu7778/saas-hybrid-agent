# Trust Signal Data Flywheel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 端上用隐式/显式采信自动改个人 Memory，事件上行控制面做 metrics；并提供可交互 Web UI，让用户真正参与（发消息、👍👎、删 Memory），替换当前写死的 `demo.ts` 脚本演示。

**Architecture:** `TrustSignalCollector` 在 `client-agent` 生成事件 → `MemoryStore.applyTrust` 本地改 `trust_score` / `deprecated` → Sync 可读副本多端一致 → `POST /v1/trust/events` append-only；云端不改 Memory、不做中心向量库。新增 `client-agent/web/` 静态页调用 Runtime API。

**Tech Stack:** TypeScript (`client-agent` + vitest)、Spring Boot 控制面 (JUnit + MockMvc)、原生 HTML/JS Web demo（无新前端框架）。

## Global Constraints

- 不做中心向量库 / 跨用户语义检索 / 云端 Memory 重写。
- Sync 一期保持**平台可读**（与现有 Phase A plaintext sync 一致）；E2E 后置。
- trust 上报失败不得阻塞对话；本地队列重试。
- `trust_events` 不携带完整对话正文。
- 私有仓 `java-agent-runtime` 本期不接入。
- 采信以隐式为主；显式 UI 必须可点，供校准与验收。

---

## File Structure

| 路径 | 职责 |
|------|------|
| `client-agent/src/trust/types.ts` | `TrustEvent` / signal 类型 |
| `client-agent/src/trust/applyTrust.ts` | 纯函数：对 SemanticRow 应用 trust |
| `client-agent/src/trust/TrustSignalCollector.ts` | 隐式/显式事件生成 |
| `client-agent/src/trust/TrustEventQueue.ts` | 本地队列 + 上报开关 |
| `client-agent/src/trust/HttpTrustEventClient.ts` | `POST /v1/trust/events` |
| `client-agent/src/memory/InMemoryMemoryStore.ts` | 扩展字段 + `applyTrust` + 召回过滤 |
| `client-agent/src/runtime/types.ts` | `MemoryOrchestrator` / Runtime 扩展 |
| `client-agent/src/runtime/DefaultClientAgentRuntime.ts` | 挂钩 collector + submitFeedback |
| `client-agent/src/runtime/createBrowserRuntime.ts` | 装配 trust 客户端 |
| `client-agent/web/index.html` + `app.js` | **可交互 UI**（对话 / 👍👎 / Memory 列表删除） |
| `server/.../trust/*` | Store、DTO、Controller、metrics |
| `server/.../BearerTokenFilter.java` | 放开 `/v1/trust/**` 需鉴权 |
| `client-agent/schemas/openapi-phase-a.yaml` | 文档化新 API |
| `README.md` | 说明 trust API + Web demo |

---

### Task 1: Trust 类型 + `applyTrust` 纯函数（TDD）

**Files:**
- Create: `client-agent/src/trust/types.ts`
- Create: `client-agent/src/trust/applyTrust.ts`
- Create: `client-agent/test/trust-apply.test.ts`

**Interfaces:**
- Produces: `TrustEvent`, `TrustSignal`, `applyTrustToSemantic(row, event) → SemanticRow`

- [ ] **Step 1: Write the failing test**

```ts
// client-agent/test/trust-apply.test.ts
import { describe, it, expect } from "vitest";
import { applyTrustToSemantic } from "../src/trust/applyTrust.js";
import type { SemanticRow } from "../src/memory/InMemoryMemoryStore.js";

function baseRow(over: Partial<SemanticRow> = {}): SemanticRow {
  return {
    id: "sem-1",
    text: "喜欢简体中文",
    embedding: [1, 0],
    tags: [],
    updatedAt: "2026-08-04T00:00:00.000Z",
    deviceId: "d1",
    version: 1,
    trustScore: 0.5,
    confidence: 0.5,
    ...over,
  };
}

describe("applyTrustToSemantic", () => {
  it("raises trustScore on trust", () => {
    const next = applyTrustToSemantic(baseRow(), {
      eventId: "e1",
      kind: "explicit_message_feedback",
      target: "memory_item",
      targetId: "sem-1",
      signal: "trust",
      strength: 0.8,
      ts: "2026-08-04T01:00:00.000Z",
    });
    expect(next.trustScore).toBeGreaterThan(0.5);
    expect(next.lastTrustedAt).toBe("2026-08-04T01:00:00.000Z");
  });

  it("deprecates after strong distrust", () => {
    const next = applyTrustToSemantic(baseRow({ trustScore: 0.2 }), {
      eventId: "e2",
      kind: "explicit_message_feedback",
      target: "memory_item",
      targetId: "sem-1",
      signal: "distrust",
      strength: 0.9,
      ts: "2026-08-04T01:00:00.000Z",
    });
    expect(next.deprecated).toBe(true);
    expect(next.trustScore).toBeLessThan(0.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client-agent && npm test -- test/trust-apply.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement types + applyTrust**

```ts
// client-agent/src/trust/types.ts
export type TrustSignal = "trust" | "distrust" | "correct";
export type TrustTarget =
  | "assistant_message"
  | "memory_item"
  | "tool_result"
  | "citation";

export interface TrustEvent {
  eventId: string;
  deviceId?: string;
  accountId?: string;
  sessionId?: string;
  turnId?: string;
  kind: string;
  target: TrustTarget;
  targetId: string;
  signal: TrustSignal;
  strength: number; // 0..1
  payload?: Record<string, unknown>;
  ts: string;
}
```

```ts
// client-agent/src/trust/applyTrust.ts
import type { SemanticRow } from "../memory/InMemoryMemoryStore.js";
import type { TrustEvent } from "./types.js";

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Pure update for a semantic memory row. Ignores events for other targets/ids. */
export function applyTrustToSemantic(
  row: SemanticRow,
  event: TrustEvent,
): SemanticRow {
  if (event.target !== "memory_item" || event.targetId !== row.id) return row;
  const delta = event.strength * 0.25;
  let trustScore = row.trustScore ?? 0.5;
  let confidence = row.confidence ?? 0.5;
  let deprecated = row.deprecated ?? false;
  let lastTrustedAt = row.lastTrustedAt;
  let supersededBy = row.supersededBy;

  if (event.signal === "trust") {
    trustScore = clamp(trustScore + delta);
    confidence = clamp(confidence + delta * 0.5);
    lastTrustedAt = event.ts;
  } else if (event.signal === "distrust") {
    trustScore = clamp(trustScore - delta);
    confidence = clamp(confidence - delta * 0.5);
    if (event.strength >= 0.8 || trustScore < 0.15) deprecated = true;
  } else if (event.signal === "correct") {
    trustScore = clamp(trustScore - delta);
    deprecated = true;
    const sid = event.payload?.supersededBy;
    if (typeof sid === "string") supersededBy = sid;
  }

  return {
    ...row,
    trustScore,
    confidence,
    deprecated,
    lastTrustedAt,
    supersededBy,
    version: row.version + 1,
    updatedAt: event.ts,
  };
}
```

Extend `SemanticRow` in `InMemoryMemoryStore.ts`:

```ts
trustScore?: number;
confidence?: number;
lastTrustedAt?: string;
sourceTurnId?: string;
deprecated?: boolean;
supersededBy?: string;
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd client-agent && npm test -- test/trust-apply.test.ts`

- [ ] **Step 5: Commit**

```bash
git add client-agent/src/trust client-agent/src/memory/InMemoryMemoryStore.ts client-agent/test/trust-apply.test.ts
git commit -m "feat(client-agent): add trust event types and applyTrust"
```

---

### Task 2: MemoryStore.applyTrust + 召回降权

**Files:**
- Modify: `client-agent/src/memory/InMemoryMemoryStore.ts`
- Modify: `client-agent/src/runtime/types.ts` (`MemoryOrchestrator`)
- Modify: `client-agent/src/storage/PersistedMemoryStore.ts`（apply 后 flush）
- Create: `client-agent/test/trust-memory-retrieve.test.ts`

**Interfaces:**
- Consumes: `applyTrustToSemantic`
- Produces: `MemoryOrchestrator.applyTrust(event: TrustEvent): Promise<void>`

- [ ] **Step 1: Write failing test**

```ts
// client-agent/test/trust-memory-retrieve.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";

describe("Memory applyTrust retrieve", () => {
  it("excludes deprecated semantic from retrieve", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "t" });
    mem.upsertSemantic({
      id: "sem-bad",
      text: "喜欢繁体",
      embedding: [1, 0, 0, 0],
      tags: [],
      updatedAt: "2026-08-04T00:00:00.000Z",
      deviceId: "t",
      version: 1,
      trustScore: 0.5,
    });
    await mem.applyTrust({
      eventId: "e1",
      kind: "explicit_memory_feedback",
      target: "memory_item",
      targetId: "sem-bad",
      signal: "distrust",
      strength: 0.95,
      ts: "2026-08-04T01:00:00.000Z",
    });
    const bundle = await mem.retrieve("喜欢");
    expect(bundle.semantic.find((s) => s.id === "sem-bad")).toBeUndefined();
  });

  it("boosts high trustScore in ranking", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "t" });
    // identical-ish embeddings via same text prefix; trust should tip order
    mem.upsertSemantic({
      id: "low",
      text: "语言偏好 A",
      embedding: await (async () => (await mem["embed"]("语言偏好 A")).embedding)(),
      tags: [],
      updatedAt: "2026-08-04T00:00:00.000Z",
      deviceId: "t",
      version: 1,
      trustScore: 0.1,
    });
    mem.upsertSemantic({
      id: "high",
      text: "语言偏好 B",
      embedding: await (async () => (await mem["embed"]("语言偏好 B")).embedding)(),
      tags: [],
      updatedAt: "2026-08-04T00:00:00.000Z",
      deviceId: "t",
      version: 1,
      trustScore: 0.95,
    });
    await mem.applyTrust({
      eventId: "e2",
      kind: "implicit_memory_reuse",
      target: "memory_item",
      targetId: "high",
      signal: "trust",
      strength: 0.5,
      ts: "2026-08-04T02:00:00.000Z",
    });
    const bundle = await mem.retrieve("语言偏好");
    expect(bundle.semantic[0]?.id).toBe("high");
  });
});
```

Note: avoid accessing private `embed` — instead pass a custom `embed` in constructor for the ranking test, or use `hashEmbed` publicly:

```ts
import { hashEmbed, InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";
// embedding: hashEmbed("语言偏好 B")
```

- [ ] **Step 2: Run — expect FAIL** (`applyTrust` missing)

- [ ] **Step 3: Implement**

In `types.ts` add to `MemoryOrchestrator`:

```ts
import type { TrustEvent } from "../trust/types.js";
// ...
applyTrust?(event: TrustEvent): Promise<void>;
```

In `InMemoryMemoryStore.retrieve`: filter `!r.deprecated`; score `cosine * (0.5 + 0.5 * (r.trustScore ?? 0.5))`.

```ts
async applyTrust(event: TrustEvent): Promise<void> {
  if (event.target !== "memory_item") return;
  const row = this.semantic.get(event.targetId);
  if (!row) return;
  this.semantic.set(event.targetId, applyTrustToSemantic(row, event));
}
```

`PersistedMemoryStore`: override `applyTrust` to `await super.applyTrust` then `flush()`.

For `correct` with new text: Runtime/UI 负责先 `upsertSemantic` 新行再发带 `supersededBy` 的事件（Task 4/6）。

- [ ] **Step 4: Tests PASS**

Run: `cd client-agent && npm test -- test/trust-memory-retrieve.test.ts test/trust-apply.test.ts`

- [ ] **Step 5: Commit**

```bash
git add client-agent/src/memory client-agent/src/runtime/types.ts client-agent/src/storage/PersistedMemoryStore.ts client-agent/test/trust-memory-retrieve.test.ts
git commit -m "feat(client-agent): applyTrust updates memory ranking and deprecation"
```

---

### Task 3: TrustSignalCollector（隐式）+ TrustEventQueue

**Files:**
- Create: `client-agent/src/trust/TrustSignalCollector.ts`
- Create: `client-agent/src/trust/TrustEventQueue.ts`
- Create: `client-agent/test/trust-collector.test.ts`

**Interfaces:**
- Produces:
  - `collector.onTurnCompleted(...)` / `onMemoryDeleted(id)` / `onExplicitFeedback(...)`
  - `TrustEventQueue.enqueue` / `setReportingEnabled` / `drain` / `flush(client)`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { TrustSignalCollector } from "../src/trust/TrustSignalCollector.js";
import { TrustEventQueue } from "../src/trust/TrustEventQueue.js";

describe("TrustSignalCollector", () => {
  it("emits distrust when memory deleted", () => {
    const c = new TrustSignalCollector({ deviceId: "d1" });
    const ev = c.onMemoryDeleted("sem-1");
    expect(ev.signal).toBe("distrust");
    expect(ev.targetId).toBe("sem-1");
    expect(ev.strength).toBeGreaterThanOrEqual(0.8);
  });

  it("emits weak trust on memory reuse in follow-up", () => {
    const c = new TrustSignalCollector({ deviceId: "d1" });
    const evs = c.onTurnCompleted({
      sessionId: "s",
      turnId: "t2",
      userMessage: "继续用简体",
      recalledMemoryIds: ["sem-1"],
      assistantText: "好的",
    });
    expect(evs.some((e) => e.signal === "trust" && e.targetId === "sem-1")).toBe(true);
  });
});

describe("TrustEventQueue", () => {
  it("keeps events when reporting disabled but still drains locally", async () => {
    const q = new TrustEventQueue();
    q.setReportingEnabled(false);
    q.enqueue({
      eventId: "e1",
      kind: "explicit_message_feedback",
      target: "assistant_message",
      targetId: "m1",
      signal: "trust",
      strength: 1,
      ts: new Date().toISOString(),
    });
    const sent: unknown[] = [];
    await q.flush({
      append: async (events) => {
        sent.push(...events);
      },
    });
    expect(sent).toHaveLength(0);
    expect(q.pendingCount()).toBe(0); // dropped from upload queue when disabled after local consume path
  });
});
```

Clarify queue semantics in implementation: **reporting disabled → do not call network; clear upload buffer after local apply already done by caller.** Prefer: disabled flush is no-op leave queue OR drop — pick **leave queue but skip network** until re-enabled, so reconnect works. Update test:

```ts
expect(sent).toHaveLength(0);
expect(q.pendingCount()).toBe(1);
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement Collector + Queue**

`TrustSignalCollector`: generate `eventId` via `crypto.randomUUID()`; `onMemoryDeleted` → distrust 0.9; `onTurnCompleted` → for each `recalledMemoryIds` emit implicit trust 0.35; `onExplicitFeedback({target, targetId, signal})` strength 0.85.

`TrustEventQueue`: array buffer; `flush(client)` if `reportingEnabled` then `client.append(batch)` and clear on success; on failure keep batch; never throw to caller（catch log）.

- [ ] **Step 4: PASS + Commit**

```bash
git commit -m "feat(client-agent): add TrustSignalCollector and event queue"
```

---

### Task 4: Runtime 挂钩 + `submitFeedback` / `deleteMemory`

**Files:**
- Modify: `client-agent/src/runtime/types.ts`
- Modify: `client-agent/src/runtime/DefaultClientAgentRuntime.ts`
- Modify: `client-agent/src/memory/InMemoryMemoryStore.ts`（`deleteSemantic` tombstone/deprecated）
- Create: `client-agent/test/trust-runtime-feedback.test.ts`

**Interfaces:**
- Produces on `ClientAgentRuntime`:
  - `submitFeedback(input: { sessionId; turnId?; target; targetId; signal }): Promise<void>`
  - `listMemory(): Promise<Array<{ id; text; trustScore; deprecated }>>`
  - `deleteMemory(id: string): Promise<void>`
  - `setTrustReportingEnabled(enabled: boolean): void`

- [ ] **Step 1: Failing test** — runtime with InMemoryMemoryStore；`commitTurn` 写入 preference；`deleteMemory` 后 retrieve 不见；`submitFeedback` trust 提升 score。

- [ ] **Step 2: Implement**

In `runTurn` after retrieve，记下 `recalledIds`；turn 成功后 `collector.onTurnCompleted` → 每条 `memory.applyTrust` + `queue.enqueue`；可选 `queue.flush` 不 await 阻塞（`void`）。

`deleteMemory`: mark deprecated/tombstone + collector + applyTrust + queue。

Wire optional `trustQueue` / `trustClient` in `DefaultRuntimeOptions`.

- [ ] **Step 3: PASS + Commit**

```bash
git commit -m "feat(client-agent): wire trust feedback APIs into runtime"
```

---

### Task 5: 控制面 Trust Store + API（TDD）

**Files:**
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/dto/TrustEventDto.java`
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/dto/TrustEventsRequest.java`
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/dto/TrustMetricsResponse.java`
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/trust/InMemoryTrustEventStore.java`
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/api/TrustController.java`
- Modify: `server/src/main/java/com/github/saashybridagent/auth/BearerTokenFilter.java`（`uri.startsWith("/v1/trust/")` 需设备鉴权）
- Modify: `server/src/test/java/com/github/saashybridagent/controlplane/ControlPlaneApiTest.java`（或新建 `TrustEventsApiTest.java`）

**Interfaces:**
- `POST /v1/trust/events` body `{ "events": [ { "eventId", "kind", "target", "targetId", "signal", "strength", "ts", ... } ] }` → `{ "accepted": n, "duplicates": n }`
- `GET /v1/trust/metrics?from=&to=&grain=day` → `{ "buckets": [ { "key", "trust", "distrust", "correct", "byKind": {} } ] }`

- [ ] **Step 1: Write failing MockMvc tests**

```java
@Test
void trustEventsIdempotentAndMetricsAggregate() throws Exception {
  JsonNode registered = registerDevice("trust-web", "web");
  String token = registered.get("token").asText();
  String body =
      """
      {"events":[{"eventId":"e-1","kind":"explicit_message_feedback","target":"assistant_message",
      "targetId":"m1","signal":"trust","strength":0.9,"ts":"2026-08-04T10:00:00Z"}]}
      """;
  mockMvc
      .perform(
          post("/v1/trust/events")
              .header("Authorization", "Bearer " + token)
              .contentType(MediaType.APPLICATION_JSON)
              .content(body))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.accepted").value(1));

  mockMvc
      .perform(
          post("/v1/trust/events")
              .header("Authorization", "Bearer " + token)
              .contentType(MediaType.APPLICATION_JSON)
              .content(body))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.duplicates").value(1));

  mockMvc
      .perform(get("/v1/trust/metrics?grain=day").header("Authorization", "Bearer " + token))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.buckets[0].trust").value(1));
}
```

Also assert 401 without token.

- [ ] **Step 2: Run `./mvnw -pl server -am test -Dtest=TrustEventsApiTest` — FAIL**

- [ ] **Step 3: Implement store + controller**

`InMemoryTrustEventStore`: `ConcurrentHashMap<String /*userId*/, Map<eventId, Stored>>`；metrics 按 day 聚合当前 user。

校验：缺 `eventId`/`signal`/`target`/`targetId`/`kind`/`ts` → 400；`strength` 默认 0.5 clamp 0..1。

- [ ] **Step 4: Tests PASS**

Run: `./mvnw -pl server -am test`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): add trust events ingest and metrics API"
```

---

### Task 6: HttpTrustEventClient + createBrowserRuntime 装配

**Files:**
- Create: `client-agent/src/trust/HttpTrustEventClient.ts`
- Create: `client-agent/test/http-trust-client.test.ts`（可用 mock fetch）
- Modify: `client-agent/src/runtime/createBrowserRuntime.ts`
- Modify: `client-agent/src/index.ts`（export）

- [ ] **Step 1: Test** — mock `globalThis.fetch` 断言 POST path `/v1/trust/events` 与 Authorization header。

- [ ] **Step 2: Implement**

```ts
export class HttpTrustEventClient {
  constructor(private opts: { baseUrl: string; token: string }) {}
  async append(events: TrustEvent[]): Promise<void> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/v1/trust/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: events.map((e) => ({
          eventId: e.eventId,
          kind: e.kind,
          target: e.target,
          targetId: e.targetId,
          signal: e.signal,
          strength: e.strength,
          ts: e.ts,
          sessionId: e.sessionId,
          turnId: e.turnId,
          payload: e.payload,
        })),
      }),
    });
    if (!res.ok) throw new Error(`trust append ${res.status}`);
  }
}
```

`createBrowserRuntime`: 创建 `TrustEventQueue` + `HttpTrustEventClient`，传入 `DefaultClientAgentRuntime`。

- [ ] **Step 3: PASS + Commit**

```bash
git commit -m "feat(client-agent): HTTP trust event client wired into browser runtime"
```

---

### Task 7: 可交互 Web UI（解决「前端写死、用户没参与」）

**Files:**
- Create: `client-agent/web/index.html`
- Create: `client-agent/web/app.js`
- Modify: `client-agent/package.json`（可选 script `demo:web`）
- Modify: `README.md`（如何打开）

**目标 UX（一期最小，非运营后台）：**

1. 输入控制面 `baseUrl`，点「注册设备」→ 存 token  
2. 文本框发消息 → 流式/完整显示助手回复（可用 `createBrowserRuntime`；若无 OPFS 环境，提供「内存模式」fallback：`InMemoryMemoryStore` + `HttpLlmTransport`）  
3. 每条助手消息旁 **👍 / 👎** → `runtime.submitFeedback`  
4. 侧栏 **Memory 列表**（`listMemory`）+ **删除** → `deleteMemory`  
5. 开关「上报采信事件」→ `setTrustReportingEnabled`  

因浏览器 ES module 需能加载 `dist/`：

- [ ] **Step 1: 构建产物可被 web 引用**

`index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>SaaS Hybrid Agent — Trust Demo</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 960px; margin: 1rem auto; }
      #log { border: 1px solid #ccc; min-height: 240px; padding: 0.75rem; white-space: pre-wrap; }
      .row { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
      aside { border-left: 1px solid #ddd; padding-left: 1rem; }
      .layout { display: grid; grid-template-columns: 1fr 280px; gap: 1rem; }
      button { cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>Hybrid Agent</h1>
    <p>可交互演示：对话 + 显式采信 + Memory 删除（非写死脚本）。</p>
    <div class="row">
      <input id="baseUrl" value="http://localhost:8080" size="40" />
      <button id="register">注册设备</button>
      <label><input type="checkbox" id="reportTrust" checked /> 上报采信</label>
    </div>
    <div class="layout">
      <main>
        <div id="log"></div>
        <div class="row">
          <input id="msg" style="flex:1" placeholder="输入消息…" />
          <button id="send">发送</button>
        </div>
      </main>
      <aside>
        <h3>Memory</h3>
        <ul id="mem"></ul>
      </aside>
    </div>
    <script type="module" src="./app.js"></script>
  </body>
</html>
```

`app.js`：动态 `import` 从 `../dist/index.js`；实现 register → create runtime（若 `createBrowserRuntime` 因非安全上下文失败，则手写 InMemory + HttpLlm）；绑定 send / feedback / delete / refresh memory list。

本地静态服务：

```bash
cd client-agent && npm run build && npx --yes serve -p 5173 web
```

（或在 package.json 加 `"demo:web": "npm run build && npx --yes serve -p 5173 ."` 并从 `http://localhost:5173/web/` 打开，以便 `../dist` 可解析。）

更稳妥：`serve` 项目根 `client-agent`，页面在 `/web/index.html`，`import from '../dist/index.js'`。

- [ ] **Step 2: 手动验收清单（写入 README）**

1. 启动 server + 打开 Web  
2. 注册设备，发送「我喜欢简体中文」  
3. Memory 出现 preference  
4. 点 👎 或删除 Memory → 列表更新 / 再问不再召回  
5. 控制面 `GET /v1/trust/metrics` 有计数（上报开启时）  

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(client-agent): add interactive web demo for trust feedback"
```

---

### Task 8: OpenAPI / README / PRD 对齐

**Files:**
- Modify: `client-agent/schemas/openapi-phase-a.yaml`（`/v1/trust/events`, `/v1/trust/metrics`）
- Modify: `README.md`（API 表 + Web demo）
- Modify: `docs/superpowers/specs/2026-07-27-client-agent-runtime-prd.md` — Phase B「默认 E2E」改为「E2E 可选后置」；链到 trust design  
- Modify: `docs/superpowers/specs/2026-08-04-trust-signal-data-flywheel-design.md` 状态可标「实现中」

- [ ] **Step 1: 更新 OpenAPI paths + README 表格行**

- [ ] **Step 2: PRD 一小段修订**（明文 Sync 与 trust 飞轮）

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: document trust APIs and interactive demo; clarify E2E optional"
```

---

### Task 9: 端到端验收（证据）

- [ ] **Step 1: 跑全量测试**

```bash
cd client-agent && npm test && npm run build
./mvnw -pl server -am test
```

Expected: 全部绿。

- [ ] **Step 2: 手动 Web 路径**（有 API key 时走真 LLM；无 key 可用 Mock 注入模式——若 Web 未接 Mock，至少用 server mock 测 metrics + 单测覆盖隐式路径）

- [ ] **Step 3: 对照 design §9 验收表逐条打勾**，缺口补测或补代码。

- [ ] **Step 4: Final commit if any fixes**

```bash
git commit -m "test: close trust flywheel acceptance gaps"
```

---

## Spec Coverage Checklist

| Spec 项 | Task |
|---------|------|
| applyTrust / confidence / deprecated | 1–2 |
| 隐式采集 | 3–4 |
| 显式 👍👎 + 用户可参与 UI | 4, 7 |
| 上报队列 / 可关闭上报 | 3–4, 7 |
| POST events 幂等 | 5 |
| GET metrics | 5 |
| Http client + browser wire | 6 |
| 不做中心向量 / 不云改 Memory | 全程约束 |
| 可读 Sync（已有）+ 文档 E2E 后置 | 8 |
| 验收 | 9 |

## Placeholder / Consistency Review

- 事件字段统一 `eventId`（TS）↔ JSON `eventId`（Jackson 可用 `@JsonProperty` 或直接用同名 record 组件 `eventId`）。
- Runtime 方法名固定：`submitFeedback` / `deleteMemory` / `listMemory` / `setTrustReportingEnabled`。
- 无 TBD 步骤；Web UI 为明确交付，解决当前 demo 写死问题。
