# Multimodal Vision (Images) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow user messages to carry images (OpenAI content parts), reject non-vision models on client and server, and forward images through both `openai` and `cursor` LLM providers.

**Architecture:** Extend `content` to `string | ContentPart[]`. Java validates against a static vision capability table before routing. OpenAI path builds Spring AI `UserMessage` with `Media`; Cursor path passes parts to the Python sidecar, which calls `agent.send({ text, images })`. client-agent persists parts in OPFS sessions; Demo adds attach/paste with capability-aware UI.

**Tech Stack:** Java 17 / Spring Boot 3 / Spring AI 1.0, Python FastAPI + cursor-sdk, TypeScript client-agent + vitest, JUnit, pytest.

**Spec:** [docs/superpowers/specs/2026-08-05-multimodal-vision-design.md](../specs/2026-08-05-multimodal-vision-design.md)

## Global Constraints

- Phase 1: **images only**; inline `data:` URI (https URL shape allowed, no object storage).
- Max **5** images per request; each decoded ≤ **4MB**; MIME `image/png|jpeg|gif|webp` only.
- Only `role=user` may include `image_url` parts.
- Vision table: `gpt-4o*`, `gpt-4.1*`, `gpt-4-turbo*`, `gpt-5*`, `composer-*`, `cursor-*` → yes; else **no**.
- Hard block (no soft drop of images). Error codes: `model_lacks_vision`, `image_limit`, `image_unsupported`, `image_role_invalid`.
- HTTP errors use existing flat `ErrorResponse { code, message }` (not nested `{ error: {...} }`).
- History: persist and re-send image parts; Cursor sidecar drops oldest images beyond 5 with `[image omitted]` text note.
- Do not embed image bytes into Memory.

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `server/.../llm/ModelVisionCapabilities.java` | Static model → vision lookup |
| `server/.../llm/MultimodalContent.java` | Normalize content; extract/validate images |
| `server/.../llm/MultimodalValidationException.java` | 400 + error code |
| `server/.../dto/ChatMessageDto.java` | `content` as `JsonNode` |
| `server/.../llm/LlmGatewayService.java` | Validate before route; multimodal `UserMessage` |
| `server/.../llm/CursorSidecarClient.java` | Forward parts JSON as-is |
| `server/.../api/LlmCapabilitiesController.java` | `GET /v1/llm/capabilities` |
| `server/.../api/ApiExceptionHandler.java` | Map multimodal exception |
| `server/src/test/.../ModelVisionCapabilitiesTest.java` | Table unit tests |
| `server/src/test/.../MultimodalLlmGatewayTest.java` | 400 gate + text compat |
| `python-sidecar/app.py` | `messages_to_prompt_and_images` |
| `python-sidecar/cursor_runner.py` | `send` with optional images |
| `python-sidecar/tests/test_multimodal.py` | Assembler + runner mock |
| `client-agent/src/runtime/types.ts` | `ContentPart`, `LlmMessage.content` |
| `client-agent/src/runtime/contentParts.ts` | Helpers: text extract, build user content |
| `client-agent/src/runtime/ConversationLoop.ts` | `runTurn` accepts images |
| `client-agent/src/runtime/DefaultClientAgentRuntime.ts` | Pass-through images; episode text |
| `client-agent/src/llm/HttpLlmCapabilities.ts` | Fetch capabilities |
| `client-agent/web/app.js` + `index.html` | Attach / paste / gate UI |
| `client-agent/schemas/openapi-phase-a.yaml` | content oneOf + capabilities |
| `client-agent/test/multimodal-*.test.ts` | Serialization + runTurn |

---

### Task 1: Java vision capability table

**Files:**
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/llm/ModelVisionCapabilities.java`
- Create: `server/src/test/java/com/github/saashybridagent/controlplane/llm/ModelVisionCapabilitiesTest.java`

**Interfaces:**
- Produces: `public final class ModelVisionCapabilities { public static boolean supportsVision(String modelId); }`
- Matching: lowercase; prefix rules from Global Constraints; `null`/blank → treat as no vision at this layer (caller supplies default model first).

- [ ] **Step 1: Write failing test**

```java
// server/src/test/java/com/github/saashybridagent/controlplane/llm/ModelVisionCapabilitiesTest.java
package com.github.saashybridagent.controlplane.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ModelVisionCapabilitiesTest {

  @Test
  void knownVisionModels() {
    assertThat(ModelVisionCapabilities.supportsVision("gpt-4o-mini")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("GPT-4.1")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("gpt-4-turbo")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("gpt-5")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("composer-2.5")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("cursor-small")).isTrue();
  }

  @Test
  void unknownAndBlankAreFalse() {
    assertThat(ModelVisionCapabilities.supportsVision("gpt-3.5-turbo")).isFalse();
    assertThat(ModelVisionCapabilities.supportsVision("o1-preview")).isFalse();
    assertThat(ModelVisionCapabilities.supportsVision("")).isFalse();
    assertThat(ModelVisionCapabilities.supportsVision(null)).isFalse();
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./mvnw -q -Dtest=ModelVisionCapabilitiesTest test`  
(or from repo root: `./mvnw -pl server -Dtest=ModelVisionCapabilitiesTest test`)  
Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

```java
package com.github.saashybridagent.controlplane.llm;

public final class ModelVisionCapabilities {
  private ModelVisionCapabilities() {}

  public static boolean supportsVision(String modelId) {
    if (modelId == null || modelId.isBlank()) {
      return false;
    }
    String m = modelId.trim().toLowerCase();
    return m.startsWith("gpt-4o")
        || m.startsWith("gpt-4.1")
        || m.startsWith("gpt-4-turbo")
        || m.startsWith("gpt-5")
        || m.startsWith("composer-")
        || m.startsWith("cursor-");
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/com/github/saashybridagent/controlplane/llm/ModelVisionCapabilities.java \
  server/src/test/java/com/github/saashybridagent/controlplane/llm/ModelVisionCapabilitiesTest.java
git commit -m "feat(server): add static model vision capability table"
```

---

### Task 2: Content normalization + multimodal validation

**Files:**
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/llm/MultimodalContent.java`
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/llm/MultimodalValidationException.java`
- Modify: `server/src/main/java/com/github/saashybridagent/controlplane/dto/ChatMessageDto.java` — change `String content` → `JsonNode content`
- Modify: `server/src/main/java/com/github/saashybridagent/api/ApiExceptionHandler.java` — handle `MultimodalValidationException` → 400
- Create: `server/src/test/java/com/github/saashybridagent/controlplane/llm/MultimodalContentTest.java`
- Fix any compile breakages in `LlmGatewayService` / `CursorSidecarClient` that read `dto.content()` as String (temporary: call `MultimodalContent.asPlainText(dto.content())` until Task 3/4).

**Interfaces:**
- Produces:
  - `MultimodalValidationException(String code, String message)` with `getCode()`
  - `MultimodalContent.countImages(List<ChatMessageDto>)`
  - `MultimodalContent.validate(List<ChatMessageDto> messages, String effectiveModel)` — throws if images present and !vision, or limits/MIME/role
  - `MultimodalContent.asPlainText(JsonNode content)` — concatenate text parts or string
  - `MultimodalContent.normalizedParts(JsonNode content)` → `List<Map<String,Object>>` or JsonNode array
- Constants: `MAX_IMAGES=5`, `MAX_BYTES=4*1024*1024`, allowed MIME set.

- [ ] **Step 1: Write failing unit tests for MultimodalContent**

```java
@Test
void rejectsImagesWhenModelLacksVision() {
  ObjectMapper om = new ObjectMapper();
  ArrayNode parts = om.createArrayNode();
  parts.addObject().put("type", "text").put("text", "see");
  parts.addObject().put("type", "image_url")
      .putObject("image_url")
      .put("url", "data:image/png;base64,aaaa");
  ChatMessageDto msg = new ChatMessageDto("user", parts, null, null, null);
  assertThatThrownBy(() -> MultimodalContent.validate(List.of(msg), "gpt-3.5-turbo"))
      .isInstanceOf(MultimodalValidationException.class)
      .extracting(ex -> ((MultimodalValidationException) ex).getCode())
      .isEqualTo("model_lacks_vision");
}

@Test
void acceptsVisionModelWithPngDataUri() {
  // same parts, model gpt-4o-mini — no throw
  MultimodalContent.validate(List.of(msg), "gpt-4o-mini");
}

@Test
void stringContentStillPlainText() {
  assertThat(MultimodalContent.asPlainText(om.getNodeFactory().textNode("hi")))
      .isEqualTo("hi");
}
```

Also add tests: image on assistant role → `image_role_invalid`; 6 images → `image_limit`; `data:image/svg+xml;base64,...` → `image_unsupported`.

For size check: decode base64 payload length (not full data URI string length); over 4MB → `image_limit`.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement MultimodalValidationException + MultimodalContent + ChatMessageDto**

```java
// ChatMessageDto — content field:
JsonNode content,
```

```java
public class MultimodalValidationException extends RuntimeException {
  private final String code;
  public MultimodalValidationException(String code, String message) {
    super(message);
    this.code = code;
  }
  public String getCode() { return code; }
}
```

`validate` algorithm:
1. Walk messages; for each, if content is array, for each part with `type=image_url`, require role `user`, check url MIME (data URI regex `^data:(image/(png|jpeg|jpg|gif|webp));base64,(.+)$` or `https?://`), estimate bytes from base64 for data URIs.
2. Total image count > 5 → `image_limit`.
3. If count > 0 && !ModelVisionCapabilities.supportsVision(effectiveModel) → `model_lacks_vision`.

`ApiExceptionHandler`:

```java
@ExceptionHandler(MultimodalValidationException.class)
public ResponseEntity<ErrorResponse> multimodal(MultimodalValidationException ex) {
  return ResponseEntity.badRequest().body(ErrorResponse.of(ex.getCode(), ex.getMessage()));
}
```

Update call sites that used `dto.content()` as String to `MultimodalContent.asPlainText(dto.content())` so the project compiles.

- [ ] **Step 4: Run MultimodalContentTest — expect PASS; run full `./mvnw -pl server test` to catch compile regressions**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): normalize multimodal content and validate vision gates"
```

---

### Task 3: Wire validation + capabilities API into chat gateway

**Files:**
- Modify: `server/src/main/java/com/github/saashybridagent/controlplane/llm/LlmGatewayService.java`
- Create: `server/src/main/java/com/github/saashybridagent/controlplane/api/LlmCapabilitiesController.java`
- Create: `server/src/test/java/com/github/saashybridagent/controlplane/MultimodalLlmGatewayTest.java` (MockMvc, reuse device register pattern from `ControlPlaneApiTest`)

**Interfaces:**
- Produces: `GET /v1/llm/capabilities?model=&provider=` → `{ "vision": boolean, "model": "<effective>" }`
- `LlmGatewayService` resolves `effectiveModel = request.model() != null ? request.model() : defaultModel` where `defaultModel` injected via `@Value("${spring.ai.openai.chat.options.model:gpt-4o-mini}")`
- Both `complete` and `stream` call `MultimodalContent.validate(request.messages(), effectiveModel)` **before** quota/provider work (or immediately after auth, before ChatModel/sidecar).

- [ ] **Step 1: Write failing MockMvc tests**

```java
@Test
void chatWithImageAndNonVisionModelReturns400() throws Exception {
  String token = registerAndGetToken(); // copy helper from ControlPlaneApiTest
  String body = """
      {
        "model": "gpt-3.5-turbo",
        "stream": false,
        "messages": [{
          "role": "user",
          "content": [
            {"type":"text","text":"what"},
            {"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}
          ]
        }]
      }
      """;
  mockMvc.perform(post("/v1/llm/chat")
          .header("Authorization", "Bearer " + token)
          .contentType(MediaType.APPLICATION_JSON)
          .content(body))
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.code").value("model_lacks_vision"));
}

@Test
void plainStringContentStillAcceptedShape() throws Exception {
  // register + post classic {"messages":[{"role":"user","content":"hi"}],"stream":false}
  // Expect not 400 model_lacks_vision (may 5xx if no real LLM — use @MockBean ChatModel if existing tests do)
}

@Test
void capabilitiesEndpoint() throws Exception {
  String token = registerAndGetToken();
  mockMvc.perform(get("/v1/llm/capabilities")
          .param("model", "gpt-4o-mini")
          .header("Authorization", "Bearer " + token))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.vision").value(true));
  mockMvc.perform(get("/v1/llm/capabilities")
          .param("model", "gpt-3.5-turbo")
          .header("Authorization", "Bearer " + token))
      .andExpect(jsonPath("$.vision").value(false));
}
```

Follow existing `ControlPlaneApiTest` patterns for mocking ChatModel if needed so plain text path does not call real OpenAI.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement controller + gateway validate hook**

```java
@RestController
@RequestMapping("/v1/llm")
public class LlmCapabilitiesController {
  @Value("${spring.ai.openai.chat.options.model:gpt-4o-mini}")
  private String defaultModel;

  @GetMapping("/capabilities")
  public Map<String, Object> capabilities(
      @RequestParam(required = false) String model,
      @RequestParam(required = false) String provider) {
    String effective = (model == null || model.isBlank()) ? defaultModel : model;
    return Map.of(
        "vision", ModelVisionCapabilities.supportsVision(effective),
        "model", effective,
        "provider", provider == null ? "" : provider);
  }
}
```

In `LlmGatewayService.complete` / `stream` at the top:

```java
String effectiveModel = request.model() != null ? request.model() : defaultModel;
MultimodalContent.validate(request.messages(), effectiveModel);
```

- [ ] **Step 4: Run MultimodalLlmGatewayTest — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): enforce vision gate on chat and expose capabilities API"
```

---

### Task 4: OpenAI path — Spring AI multimodal UserMessage

**Files:**
- Modify: `server/src/main/java/com/github/saashybridagent/controlplane/llm/LlmGatewayService.java` (`toSpringMessage`)
- Create: `server/src/test/java/com/github/saashybridagent/controlplane/llm/LlmGatewayMultimodalMappingTest.java` (unit test constructing messages without HTTP)

**Interfaces:**
- Consumes: `ChatMessageDto` with JsonNode content
- Produces: `UserMessage.builder().text(...).media(...).build()` when images present

- [ ] **Step 1: Write failing test that inspects media on UserMessage**

Prefer package-visible or package-private test via extracting logic into:

```java
// MultimodalContent.toUserMessage(JsonNode content) -> UserMessage
```

```java
@Test
void buildsUserMessageWithMediaFromDataUri() {
  // build parts with tiny png data uri
  UserMessage msg = MultimodalContent.toUserMessage(partsNode);
  assertThat(msg.getText()).contains("what");
  assertThat(msg.getMedia()).hasSize(1);
  assertThat(msg.getMedia().get(0).getMimeType().toString()).contains("image/png");
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```java
public static UserMessage toUserMessage(JsonNode content) {
  if (content == null || content.isNull()) {
    return new UserMessage("");
  }
  if (content.isTextual()) {
    return new UserMessage(content.asText());
  }
  StringBuilder text = new StringBuilder();
  List<Media> media = new ArrayList<>();
  for (JsonNode part : content) {
    String type = part.path("type").asText();
    if ("text".equals(type)) {
      text.append(part.path("text").asText(""));
    } else if ("image_url".equals(type)) {
      String url = part.path("image_url").path("url").asText();
      // data URI → ByteArrayResource + MimeType; https → Media(MimeType, URI)
      ...
    }
  }
  return UserMessage.builder().text(text.toString()).media(media).build();
}
```

Wire `toSpringMessage` user branch to `MultimodalContent.toUserMessage(dto.content())`. System/assistant/tool continue using `asPlainText`.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): map image content parts to Spring AI UserMessage media"
```

---

### Task 5: Cursor sidecar multimodal send

**Files:**
- Modify: `server/.../llm/CursorSidecarClient.java` — `toSidecarBody` put `content` as raw JsonNode (string or array), not forced string
- Modify: `python-sidecar/app.py` — replace `messages_to_prompt` with `messages_to_prompt_and_images`
- Modify: `python-sidecar/cursor_runner.py` — accept images list; call `agent.send({text, images})` when non-empty
- Create: `python-sidecar/tests/test_multimodal.py`
- Update: `python-sidecar/tests/test_app.py` FakeRunner signatures to accept optional `images=None`

**Interfaces:**
- Produces:
  - `messages_to_prompt_and_images(messages) -> tuple[str, list[dict]]` where each image dict is `{ "data": "<base64>", "mime_type": "image/png" }`
  - Max 5 images, oldest dropped; append `\n[image omitted]` to prompt when dropped
  - `CursorSdkRunner.run_stream(prompt, model, cwd, images=None)`
  - `run_complete(..., images=None)`

- [ ] **Step 1: Write failing pytest**

```python
# python-sidecar/tests/test_multimodal.py
from app import messages_to_prompt_and_images

def test_extracts_data_uri_images():
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "describe"},
            {"type": "image_url", "image_url": {
                "url": "data:image/png;base64,aGVsbG8="
            }},
        ],
    }]
    prompt, images = messages_to_prompt_and_images(messages)
    assert "user: describe" in prompt or "describe" in prompt
    assert len(images) == 1
    assert images[0]["mime_type"] == "image/png"
    assert images[0]["data"] == "aGVsbG8="

def test_string_content_unchanged():
    prompt, images = messages_to_prompt_and_images(
        [{"role": "user", "content": "hi"}]
    )
    assert "user: hi" in prompt
    assert images == []


class CapturingRunner:
    def __init__(self):
        self.calls = []

    def run_complete(self, prompt, model, cwd, images=None):
        self.calls.append((prompt, images))
        return "ok"

    def run_stream(self, prompt, model, cwd, images=None):
        self.calls.append((prompt, images))
        yield "ok"


def test_complete_passes_images_to_runner():
    from fastapi.testclient import TestClient
    from app import create_app
    runner = CapturingRunner()
    client = TestClient(create_app(runner))
    r = client.post("/v1/complete", json={
        "stream": False,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "x"},
                {"type": "image_url", "image_url": {
                    "url": "data:image/jpeg;base64,zz"
                }},
            ],
        }],
    })
    assert r.status_code == 200
    assert runner.calls[0][1][0]["mime_type"] == "image/jpeg"
```

- [ ] **Step 2: Run `cd python-sidecar && pytest tests/test_multimodal.py -v` — FAIL**

- [ ] **Step 3: Implement app.py + cursor_runner.py + CursorSidecarClient content passthrough**

```python
# cursor_runner run_stream core:
if images:
    run = agent.send({"text": prompt, "images": images})
else:
    run = agent.send(prompt)
```

Java `toSidecarBody`:

```java
msg.put("content", dto.content() == null || dto.content().isNull()
    ? ""
    : objectMapper.convertValue(dto.content(), Object.class));
```

- [ ] **Step 4: Run all python-sidecar tests — PASS; fix FakeRunner in old tests to `images=None` kw**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(sidecar): forward image parts to Cursor SDK send"
```

---

### Task 6: client-agent content parts + runTurn images

**Files:**
- Modify: `client-agent/src/runtime/types.ts`
- Create: `client-agent/src/runtime/contentParts.ts`
- Modify: `client-agent/src/runtime/ConversationLoop.ts`
- Modify: `client-agent/src/runtime/DefaultClientAgentRuntime.ts`
- Modify: `client-agent/src/runtime/StubClientAgentRuntime.ts` (signature)
- Modify: `client-agent/src/index.ts` — export helpers
- Create: `client-agent/test/multimodal-content.test.ts`
- Create: `client-agent/test/multimodal-runtime.test.ts`

**Interfaces:**
- Produces types:

```ts
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  // ...existing fields
}

export type RunTurnImages = { dataUrl: string }[]; // data:image/...;base64,...

// ConversationLoop / ClientAgentRuntime
runTurn(sessionId, userMessage: string, stream?, images?: RunTurnImages): Promise<TurnResult>
```

- Helpers in `contentParts.ts`:
  - `buildUserContent(text: string, images?: RunTurnImages): string | ContentPart[]`
  - `extractText(content: string | ContentPart[] | null): string`
  - `countImages(content): number`

- [ ] **Step 1: Write failing tests**

```ts
import { buildUserContent, extractText } from "../src/runtime/contentParts.js";

it("returns string when no images", () => {
  expect(buildUserContent("hi")).toBe("hi");
});

it("returns parts when images present", () => {
  const c = buildUserContent("see", [{ dataUrl: "data:image/png;base64,aa" }]);
  expect(Array.isArray(c)).toBe(true);
  expect(c).toEqual([
    { type: "text", text: "see" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
  ]);
});
```

```ts
// multimodal-runtime.test.ts — MockLlmTransport captures messages
const sid = await runtime.createSession();
await runtime.runTurn(sid, "look", undefined, [
  { dataUrl: "data:image/png;base64,aa" },
]);
const msgs = runtime.getSessionMessages(sid);
expect(Array.isArray(msgs[0].content)).toBe(true);
```

Memory `commitTurn` must receive `extractText(userMessage)` so preference regex still works — pass text-only into commitTurn.

- [ ] **Step 2: Run `cd client-agent && npx vitest run test/multimodal-content.test.ts test/multimodal-runtime.test.ts` — FAIL**

- [ ] **Step 3: Implement types, helpers, ConversationLoop push `buildUserContent(...)`, DefaultClientAgentRuntime pass-through**

Episode summary: use `extractText` + if images, append ` [N images]`.

- [ ] **Step 4: Run multimodal tests + existing ca1/ca3 tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(client-agent): support image content parts in runTurn and sessions"
```

---

### Task 7: Demo UI + client capabilities client

**Files:**
- Create: `client-agent/src/llm/HttpLlmCapabilities.ts`
- Modify: `client-agent/web/index.html` — file input, preview container, attach button
- Modify: `client-agent/web/app.js` — paste/attach, gate send, thumbnails in bubbles
- Create: `client-agent/test/http-llm-capabilities.test.ts` (mock fetch)
- Modify: `client-agent/src/index.ts` — export

**Interfaces:**
- `fetchLlmCapabilities({ baseUrl, token, model?, provider? }) => Promise<{ vision: boolean; model: string }>`
- Demo state: `pendingImages: { dataUrl: string }[]` (max 5)

- [ ] **Step 1: Write failing unit test for HttpLlmCapabilities**

```ts
it("parses vision flag", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ vision: true, model: "gpt-4o-mini" }), { status: 200 });
  const c = await fetchLlmCapabilities({
    baseUrl: "http://localhost:8080",
    token: "t",
    model: "gpt-4o-mini",
  });
  expect(c.vision).toBe(true);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement fetch helper + Demo UI**

HTML additions next to send row:
- `<input type="file" id="imageFile" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden />`
- `<button id="attachImage" disabled>附图片</button>`
- `<div id="imagePreview"></div>`

`app.js` behavior:
- After register/restore/provider change: `refreshCapabilities()` → enable/disable `#attachImage`
- Paste on `#msg` or document: if image item in clipboard, push dataUrl
- `sendMessage`: if `pendingImages.length && !vision` → status error, return
- `runtime.runTurn(sessionId, text, streamCb, pendingImages.map(...))` then clear pending
- `appendBubble` for user: if dataUrls, append `<img>` thumbnails

- [ ] **Step 4: vitest capabilities test PASS; manual smoke optional**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): image attach/paste with vision capability gating"
```

---

### Task 8: OpenAPI + README + schema fixture

**Files:**
- Modify: `client-agent/schemas/openapi-phase-a.yaml` — ChatMessage content oneOf; add `/v1/llm/capabilities`
- Modify: `client-agent/schemas/fixtures/phase-a-examples.json` — one multimodal example
- Modify: `README.md` — short multimodal / capabilities note
- Modify: `client-agent/test/ca2-schema-contract.test.ts` if it asserts content type strictly

- [ ] **Step 1: Update OpenAPI ChatMessage**

```yaml
content:
  oneOf:
    - type: string
      nullable: true
    - type: array
      items:
        $ref: "#/components/schemas/ContentPart"
ContentPart:
  type: object
  required: [type]
  properties:
    type:
      type: string
      enum: [text, image_url]
    text:
      type: string
    image_url:
      type: object
      properties:
        url: { type: string }
        detail: { type: string, enum: [auto, low, high] }
```

Add path `GET /v1/llm/capabilities`.

- [ ] **Step 2: Adjust schema contract test if needed; run `npx vitest run test/ca2-schema-contract.test.ts`**

- [ ] **Step 3: README bullet under API table for capabilities + note on vision models**

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: document multimodal content parts and capabilities API"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| content parts + string compat | 2, 6, 8 |
| 5 images / 4MB / MIME / user-only | 2 |
| Static vision table | 1 |
| Server 400 codes | 2, 3 |
| GET capabilities | 3, 7 |
| OpenAI Spring AI media | 4 |
| Cursor send images | 5 |
| Persist history parts | 6 (PersistedSessionStore already stores LlmMessage) |
| Demo attach/paste/gate | 7 |
| Memory text-only | 6 |
| OpenAPI | 8 |

No TBD placeholders. Error body uses flat `ErrorResponse` consistent with existing API (spec narrative codes preserved).

---

## Execution

Plan saved to `docs/superpowers/plans/2026-08-05-multimodal-vision.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
