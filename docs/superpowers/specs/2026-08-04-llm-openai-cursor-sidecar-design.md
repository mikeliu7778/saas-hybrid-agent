# LLM OpenAI + Cursor Sidecar 兼容设计

- 日期：2026-08-04
- 状态：已实现（待验收）
- 关联：
  - [2026-08-03-saas-hybrid-agent-design.md](./2026-08-03-saas-hybrid-agent-design.md)
  - 参考实现：`/Users/liubing/work/feedForge/wp_niche/ai.py`（`CursorProvider` + `Agent.prompt`）

## 1. 背景与结论

本控制面默认把 `SAAS_HYBRID_AGENT_API_KEY` 发往 OpenAI 兼容 `chat/completions`。Cursor 的 `CURSOR_API_KEY`（`crsr_…`）**不是**该协议的密钥，直接填入会得到上游 401。

**可行性结论：可兼容，但是「统一 `/v1/llm/chat` + Provider 分流」，不是把 Cursor SDK 伪装成 OpenAI 官方 endpoint。**

参考 `wp_niche`：同一套 `AIProvider` 接口下，`cursor` 走 Cursor SDK；本仓将其提升为 **Python sidecar + 真流式**，由 Java 转成现有 SSE，**端上 Hybrid 工具环不变**。

### 1.1 已确认决策

| 决策点 | 选择 |
|--------|------|
| 产品形态 | Provider 切换（非独立 `/v1/agents` 产品模式） |
| Sidecar 语言 | **Python**（`cursor-sdk`） |
| Cursor runtime | **Local**（`LocalAgentOptions`）；Cloud 后置 |
| 流式 | **真流式**：`Agent.create` + `send` + `stream` |
| 对外协议 | 仍为 `POST /v1/llm/chat`（JSON / SSE） |
| 端上工具环 | **不变**；Cursor 路径一期 **忽略** 请求中的 `tools`，不映射 Cursor 内部工具为 `tool_call` |
| 默认模型 | `composer-2.5`（可配） |

## 2. 目标与边界

### 2.1 目标

- `provider=openai`（及 OpenAI 兼容 base URL）：现有 Spring AI 路径不变。
- `provider=cursor`：Java → Python sidecar → Cursor SDK 流式文本 → 现有 SSE `delta` / `done`。
- `client-agent` 的 `HttpLlmTransport` / ConversationLoop **无需为 Cursor 改协议**（最多传 `provider` 字段）。
- 错误可区分：sidecar 不可达、Cursor 鉴权失败，**不再**表现为 OpenAI 401 堆栈。

### 2.2 非目标（一期）

- Cloud Agent / 独立 `/v1/agents/**` API。
- 「Cursor 模式关闭端上工具环」的双产品模式（可后置）。
- embeddings 走 Cursor（仍用 OpenAI 兼容或端上 `hashEmbed`）。
- 将 Python 嵌进 JVM。
- 把 Cursor 内部 tool/file 事件映射成控制面 `tool_call`。

## 3. 架构（方案 1）

```text
[client-agent]
  HttpLlmTransport → POST /v1/llm/chat { provider?, messages, tools, stream }

[saas-hybrid-agent Java]
  LlmGatewayService
    ├ provider=openai → Spring AI ChatModel → OpenAI-compatible upstream
    └ provider=cursor → CursorSidecarClient → python-sidecar

[python-sidecar]
  FastAPI
    POST /v1/complete
      Agent.create(api_key, model, local={cwd})
      agent.send(prompt from messages)
      stream assistant text → SSE/NDJSON
```

**职责**

| 组件 | 职责 |
|------|------|
| Java 控制面 | 设备鉴权、配额/限流、provider 分流、SSE cursor、错误码映射 |
| Python sidecar | 持有 `CURSOR_API_KEY`、跑 Cursor SDK、产出文本流 |
| client-agent | 不变的工具环；Cursor 路径下通常拿不到 `tool_calls` |

## 4. Sidecar HTTP

### 4.1 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 探活 |
| `POST` | `/v1/complete` | 补全；`stream=false` JSON；`stream=true` 文本增量流 |

### 4.2 请求体

```json
{
  "model": "composer-2.5",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "cwd": "/optional/workdir",
  "stream": true
}
```

- `messages`：由 Java 从 `LlmChatRequest` 原样或精简转发（含 system/user/assistant/tool 文本拼接策略在实现计划中写死：一期将多轮拼成单一 user prompt 或保留多段文本进 `send`，以 SDK 可接受为准）。
- `tools`：**不转发**到 sidecar（一期忽略）。
- 鉴权：sidecar 默认只监听 `127.0.0.1`；不校验设备 token（由 Java 完成）。

### 4.3 流式响应（sidecar → Java）

推荐 sidecar 输出 SSE JSON 行：

- `{ "type": "delta", "text": "..." }`
- `{ "type": "done", "finish_reason": "stop" }`
- `{ "type": "error", "message": "..." }`

Java 再包装为现有控制面 SSE（带 `cursor` / event `id`），与 OpenAI 路径同形，供 `HttpLlmTransport` 解析。

### 4.4 非流式

等 run 结束后返回：

```json
{ "content": "...", "tool_calls": [], "finish_reason": "stop" }
```

### 4.5 与 wp_niche 的差异

| wp_niche | 本设计一期 |
|----------|------------|
| `Agent.prompt` one-shot | `Agent.create` + `send` + **stream** |
| `generate_json` | 纯文本补全（对话） |
| CLI 进程内调用 | **独立 HTTP sidecar** |

## 5. Java 控制面变更

### 5.1 请求

`LlmChatRequest` 增加可选字段：

- `provider`: `openai` | `cursor`（可扩展）

缺省：`saas-hybrid-agent.llm.default-provider`（默认 `openai`）。

### 5.2 分流

`LlmGatewayService`：

1. 解析有效 provider。
2. `cursor` → `CursorSidecarClient.complete/stream`。
3. 否则 → 现有 `ChatModel`。
4. 两条路径共用 `RateLimiter` / `QuotaService`。

### 5.3 错误映射

| 情况 | HTTP / SSE |
|------|------------|
| sidecar 连接失败 | 503 `cursor_sidecar_unavailable` |
| Cursor 鉴权失败（缺 key / 无效） | 401 或 502 `cursor_unauthorized`（实现选一种写死） |
| run `status=error` | 502 `cursor_run_failed` |
| OpenAI 路径 | 保持现有行为 |

## 6. 配置与环境变量

```yaml
saas-hybrid-agent:
  llm:
    default-provider: ${SAAS_HYBRID_AGENT_LLM_PROVIDER:openai}
    cursor-sidecar-url: ${CURSOR_SIDECAR_URL:http://127.0.0.1:8091}
```

| 变量 | 谁读 | 含义 |
|------|------|------|
| `SAAS_HYBRID_AGENT_API_KEY` / `BASE_URL` / `MODEL` | Java / Spring AI | OpenAI 兼容路径 |
| `SAAS_HYBRID_AGENT_LLM_PROVIDER` | Java | 默认 provider |
| `CURSOR_SIDECAR_URL` | Java | sidecar 基址 |
| `CURSOR_API_KEY` | **仅 sidecar** | Cursor 密钥 |
| `CURSOR_MODEL` | sidecar | 默认 `composer-2.5` |
| `CURSOR_AGENT_CWD` | sidecar | Local Agent 工作目录 |

## 7. 仓库布局

```text
python-sidecar/
  app.py                 # FastAPI
  requirements.txt       # fastapi, uvicorn, cursor-sdk, ...
  README.md
scripts/dev.sh           # 启 Java + sidecar + web（可环境开关跳过 sidecar）
```

## 8. client / Web

- `HttpLlmTransport` body 增加可选 `provider`。
- Web demo：可选 provider 下拉或查询参数；默认跟随服务端。
- ConversationLoop / ToolHost：**不改**。文档注明：Cursor 路径下一期无 LLM `tool_calls`，端上工具需 `provider=openai`。

## 9. 验收标准

1. `provider=openai` + 有效兼容 key：对话与工具调用回归通过。
2. `provider=cursor` + `CURSOR_API_KEY` + sidecar 运行：Web/流式可见增量文本；**不**出现打向 `api.openai.com` 的 401。
3. sidecar 未启动或 key 缺失：返回明确错误码/文案，而非 OpenAI Unauthorized。
4. Cursor 路径 SSE **不**包含由 sidecar 产生的 `tool_call` 事件。
5. `./scripts/dev.sh` 可同时拉起控制面、sidecar、前端（或文档说明 `SKIP_CURSOR_SIDECAR=1`）。

## 10. 测试策略

- **python-sidecar**：health；complete 非流式 mock SDK；流式增量（可用 fake agent 注入）。
- **server**：`LlmGateway` 在 `provider=cursor` 时 MockWebServer/WireMock sidecar；openai 路径现有测试不变。
- **client-agent**：transport 带 `provider` 字段的契约测（可选）。

## 11. 后置

- Cloud Agent runtime。
- 双模式：Cursor 拥有工具环、端上变薄。
- Cursor 工具事件 → 控制面 `tool_call` 映射。
- embeddings / 多租户 sidecar。
- Node `@cursor/sdk` 替换 Python（协议稳定后可选）。

## 12. 选定方案摘要

**Java `/v1/llm/chat` 按 `provider` 分流；Cursor 走本机 Python sidecar 真流式文本；对外 SSE 与 client 协议保持不变；端上 Hybrid 工具环仍依赖 OpenAI 兼容路径。**
