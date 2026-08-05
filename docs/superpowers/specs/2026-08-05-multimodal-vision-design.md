# 多模态 Vision（图片）设计

- 日期：2026-08-05
- 状态：已确认（待实现）
- 关联：
  - [2026-08-03-saas-hybrid-agent-design.md](./2026-08-03-saas-hybrid-agent-design.md)
  - [2026-08-04-llm-openai-cursor-sidecar-design.md](./2026-08-04-llm-openai-cursor-sidecar-design.md)

## 1. 背景与结论

当前 Hybrid 链路（client-agent → `/v1/llm/chat` → OpenAI / Cursor sidecar）的消息 `content` 仅为字符串，Demo 也只有文本输入。需要支持用户附带图片，并在模型不支持 vision 时硬拦截。

**可行性结论：可行。** 一期只做图片；协议对齐 OpenAI content parts；`openai` 与 `cursor` 两条路径都通；能力用服务端静态表判定。

### 1.1 已确认决策

| 决策点 | 选择 |
|--------|------|
| 模态范围 | **仅图片**（文档/音频后置） |
| 传输形态 | 一期 **内联 base64 data URI**；协议预留 `https://` URL，不做对象存储 |
| 门禁 | **端上硬拦 + 服务端校验**（双保险）；不做软降级丢图 |
| Provider | **`openai` + `cursor` 都支持** |
| 能力判定 | **服务端静态能力表**；未知模型默认无 vision；一期不做配置覆盖 |
| 历史消息 | **保留并重发图片 parts**（有条数/体积上限） |
| 协议方案 | **方案 1**：`content: string \| ContentPart[]`（兼容旧字符串） |

## 2. 目标与边界

### 2.1 一期目标

- 用户消息可附带图片；会话持久化保存完整 parts。
- 无 vision 模型：端上禁用选图；若请求仍含图则服务端 `400`。
- OpenAI 兼容路径把 parts 交给上游；Cursor 路径经 sidecar 调用 `agent.send({ text, images })`。
- Demo：选图 / 粘贴截图、预览、能力感知禁用。

### 2.2 非目标（一期）

- 对象存储上传、PDF/音频、配置热更新能力表。
- 图片写入 Memory embedding / 语义检索。
- 真实上游视觉 E2E（可手工验收；自动化以单测 + 协议测为主）。
- 为无 vision 模型做「先看图再摘要」的双模型流水线。

## 3. 协议与消息形态

```ts
type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: {
        url: string; // data:image/...;base64,... 或 https://...
        detail?: "auto" | "low" | "high";
      };
    };

// 兼容旧客户端
content: string | ContentPart[] | null;
```

约定：

- 纯文本可继续传 `content: "hello"`；服务端归一化为 `[{ type: "text", text: "hello" }]`。
- 仅 `role=user` 允许 `image_url`；system / assistant / tool 含图 → 拒绝。
- 单请求最多 **5** 张图；单张解码后 ≤ **4MB**；MIME 仅 `image/png|jpeg|gif|webp`。
- OpenAPI `ChatMessage.content` 改为 `oneOf: [string, ContentPart[]]`。
- `PersistedSessionStore` 持久化完整 parts，刷新后历史图仍在。

## 4. 能力表与门禁

### 4.1 静态表（代码常量）

| 匹配规则 | vision |
|---------|--------|
| `gpt-4o*`、`gpt-4.1*`、`gpt-4-turbo*`、`gpt-5*` | yes |
| `composer-*`、`cursor-*` | yes |
| 其他 / 未知（含未单列的 `o1*` / `o3*` 等） | **no** |

解析用请求 `model`；缺省则用配置 `saas-hybrid-agent.llm.model`（默认 `gpt-4o-mini` → yes）。

### 4.2 服务端校验（`POST /v1/llm/chat`）

1. 规范化 messages。
2. 若存在任意 `image_url`：
   - model 无 vision → `400`，`code: model_lacks_vision`
   - 超限 → `image_limit`；非法 MIME → `image_unsupported`；非 user role → 对应 400
3. 通过后再按 `provider` 分流。

错误体：`{ "error": { "code": "model_lacks_vision", "message": "..." } }`。

### 4.3 端上

- `GET /v1/llm/capabilities?model=&provider=` 返回 `{ vision: boolean }`（provider 不改变静态表结果，仅便于客户端一并查询）。
- 发送前本地再检；失败时不清空已选图片，提示换模型。

## 5. Provider 路径

共同前置：`LlmGatewayService` 规范化 + vision 门禁，再分流。

### 5.1 `provider=openai`

- `ChatMessageDto.content` 支持 string / parts（如 `JsonNode` + 规范化）。
- `toSpringMessage`：有图时构造 Spring AI 多模态 `UserMessage`；纯文本保持现状。
- 上游 OpenAI-compatible Chat Completions 接收标准 content parts。

### 5.2 `provider=cursor`

- Java → sidecar 传完整 `messages`（含 parts），不在 Java 侧压成纯字符串。
- Sidecar：
  - 将各轮文字拼成 `text` prompt；从 messages 收集图片进 `images[{ data, mime_type }]`（总上限 5；超限丢最旧，文字注明 `[image omitted]`）。
  - `agent.send({ "text": prompt, "images": [...] })`；无图时保持现有 `send(prompt)`。
  - data URI 在 sidecar 拆成 raw base64 + mime。

### 5.3 client-agent

- `LlmMessage.content` 对齐 §3。
- `ConversationLoop.runTurn` 支持附带图片；写入 session 为 parts。
- `HttpLlmTransport` JSON 原样序列化。
- Memory / trust：仍基于文本；episode 可记 `[N images]`；图片不进 embedding。

## 6. Demo UI

- 输入区「附图片」+ `paste` 截图；缩略图预览与单张移除。
- 未注册或 `vision=false` 时禁用入口。
- 聊天气泡展示缩略图。
- 切换 provider/model 后重拉 capabilities；已选图但新模型无 vision → 禁用发送并提示，不清空预览。

## 7. 错误处理

| 场景 | 行为 |
|------|------|
| 端上无 vision + 有图 | 不发请求，status 提示 |
| 服务端无 vision | `400 model_lacks_vision` |
| 超限 / MIME | `400 image_limit` / `image_unsupported` |
| Cursor sidecar 拒图 | 映射 `502 cursor_error`，可读文案 |

## 8. 测试

- Java：能力表单测；含图 + 无 vision → 400；纯文本旧协议仍通；openai 路径 parts 序列化。
- Sidecar：messages → `send({ text, images })`（mock runner）。
- client-agent：消息序列化、`runTurn` 带图持久化、capabilities 禁用逻辑（假 transport）。
- 不做强制真实上游视觉 E2E。

## 9. 组件边界

| 组件 | 职责 |
|------|------|
| client-agent runtime | parts 建模、会话持久化、发送前门禁、Demo 选图 |
| Java 控制面 | 规范化、静态能力表、400 门禁、openai/cursor 分流、capabilities API |
| Python sidecar | parts → Cursor SDK `send({ text, images })` |
| Memory / trust | 不消费图片像素；最多文本占位 |

## 10. 验收标准

1. 默认 `gpt-4o-mini` + openai：可发图并得到与图相关的回复（手工）。
2. 人为指定无 vision 模型名：端上禁用选图；强制请求返回 `model_lacks_vision`。
3. `provider=cursor` + 支持模型：sidecar 收到图并以 SDK 多模态形式发送（单测证明组装；手工可选）。
4. 纯文本旧客户端请求行为不变。
5. 刷新后会话历史中的图片仍可随后续 turn 重发（OPFS 持久化）。
