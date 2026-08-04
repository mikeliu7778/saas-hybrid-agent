# 采信信号与个人数据飞轮设计

- 日期：2026-08-04
- 状态：已实现（待验收）
- 关联：
  - [2026-08-03-saas-hybrid-agent-design.md](./2026-08-03-saas-hybrid-agent-design.md)
  - [2026-07-27-client-agent-runtime-prd.md](./2026-07-27-client-agent-runtime-prd.md)

## 1. 背景与结论

「数据是 AI 的瓶颈」在本产品中拆成两层：

1. **个人数据飞轮**：用户越用，端上 Memory 越准（采信强化 / 不采信降权）。
2. **平台信号飞轮**：结构化采信事件上行控制面，用于聚合指标与后续产品/策略改进。

**可行性结论：可行**，且与 SaaS Hybrid（端上循环 + 薄控制面）对齐——前提是一期不做跨用户中心向量库 / 公共 RAG，消费逻辑在端上。

### 1.1 已确认决策

| 决策点 | 选择 |
|--------|------|
| Sync 存储 | 服务端保存**可读** messages / Memory 副本（非默认 E2E） |
| 飞轮范围 | 先做个人 Memory + 采信信号；公共知识库 / RAG **后置** |
| 采信观测 | 显式 + 隐式都做；**一期以隐式为主** |
| 一期成功形态 | 端上自动改 Memory **且** 控制面有基础 metrics/日志 |
| 架构方案 | **方案 1**：端上消费采信；控制面只收事件 + 聚合 |

### 1.2 与现有文档的对齐

- 仍**不做中心向量库 / 跨用户语义检索**（与 PRD 非目标一致）。
- 「服务端有用户数据」指 **Sync 可读副本**，不是中心 ANN。
- PRD Phase B「默认 E2E 加密同步」已修订为：**E2E 为后置可选**；一期默认平台可读（见 PRD §1 / US-C03 / OD-1）。

## 2. 目标与边界

### 2.1 一期目标

- 隐式为主、显式为辅的采信信号，在端上自动强化 / 降权个人 Memory。
- 结构化 `trust_events` 上行控制面，支持基础聚合指标（API + 日志级即可）。
- Sync 服务端保存可读 messages + Memory，支撑多端。

### 2.2 一期非目标

- 中心向量库 / 跨用户语义检索 / 公共 RAG 知识沉淀。
- 云端根据对话正文自动改写 Memory。
- 正式运营管理后台 UI。
- 默认 E2E 加密。
- 将本能力接入私有仓 `java-agent-runtime`（本期仅 SaaS Hybrid）。

## 3. 架构（方案 1）

```text
[client-agent]
  ConversationLoop
    → TrustSignalCollector（隐式/显式）
    → MemoryStore.applyTrust(event)     // 本地改 confidence / deprecated
    → SyncEngine.push(messages, memory) // 可读副本 → /v1/sync/*
    → TrustEventClient.append(events)   // → /v1/trust/events

[saas-hybrid-agent control plane]
  /v1/sync/*          账号维度可读副本
  /v1/trust/events    POST 批量 append（幂等）
  /v1/trust/metrics   GET 聚合计数
  （无中心向量检索；无云端 Memory 重写）
```

**职责边界**

| 组件 | 职责 |
|------|------|
| `TrustSignalCollector` | 从对话/Memory/工具行为生成事件 |
| `MemoryStore.applyTrust` | 唯一「采信 → Memory 状态」消费者 |
| Sync | 多端 Memory/messages 真相同步（可读） |
| Control plane trust API | append-only 事件存储 + 聚合 metrics |
| ConversationLoop | 不因 trust 上报失败而阻塞 |

## 4. 事件模型

### 4.1 Schema

| 字段 | 含义 |
|------|------|
| `event_id` | 客户端生成，幂等键 |
| `device_id` / `account_id` | 设备与账号 |
| `session_id` / `turn_id` | 会话与轮次 |
| `kind` | `implicit_*` 或 `explicit_*` |
| `target` | `assistant_message` / `memory_item` / `tool_result` / `citation` |
| `target_id` | 目标对象 id |
| `signal` | `trust` / `distrust` / `correct` |
| `strength` | 0–1；隐式默认较低，显式较高 |
| `payload` | 可选；`correct` 时可带短纠正摘要（非全文对话） |
| `ts` | 事件时间 |

事件**不**携带完整对话正文；正文仅存在于 Sync 副本。

### 4.2 一期隐式信号（优先）

| 行为 | signal | 说明 |
|------|--------|------|
| 续问且沿用同一事实 | `trust` | 弱 |
| 改写 / 反驳助手结论 | `distrust` 或 `correct` | |
| 删除 / 编辑某条 Memory | `distrust` | 对该条，偏强 |
| 再次主动引用某条 Memory | `trust` | 中等 |
| 工具结果被用户立刻覆盖 | `distrust` | 对该结果，弱 |

### 4.3 一期显式信号

- 消息级 👍 / 👎
- Memory 条「有用 / 有误」

显式 `strength` 高于对应隐式，用作校准锚点。

## 5. 端上 Memory 更新规则

Memory 条目扩展字段：

- `confidence`
- `trust_score`
- `last_trusted_at`
- `source_turn_id`
- `deprecated`（可选）
- `superseded_by`（可选）

**规则（确定性、可单测，一期不做 ML）：**

1. `trust` → 提高 `trust_score` / `confidence`；召回排序加权。
2. `distrust` → 降权；连续多次或显式错误 → `deprecated=true`（仍同步，默认不召回）。
3. `correct` → 写入新 Memory（或 patch）；旧条降权并设置 `superseded_by`。

**多端真相：** 以 Sync 后的 Memory 状态为准。`trust_events` 为 append-only 分析流，**不**在端上或云端回放成第二套 Memory。

## 6. 控制面 API 与存储

### 6.1 API

**`POST /v1/trust/events`**

- 鉴权：现有设备 Bearer。
- Body：`{ "events": [ ... ] }` 批量。
- 幂等：相同 `event_id` 重复提交忽略。
- 限流：走现有 Quota；超限 429。
- 单条校验失败：该条 4xx 语义（或批次内标记失败），合法条目仍可入库；实现选定一种并在 OpenAPI 写死。

**`GET /v1/trust/metrics?from=&to=&grain=day`**

- 返回计数级聚合：总量、按 `kind` / `signal`。
- 无数据返回空桶，不 5xx。
- 一期无正式管理 UI。

### 6.2 存储

| 数据 | 位置 | 备注 |
|------|------|------|
| messages / memory | Sync 存储（服务端可读） | 多端同步真相 |
| trust_events | 控制面 append-only | 分析用 |
| 语义索引 | 仅端上 | 不做中心 ANN |

## 7. 错误处理与降级

| 场景 | 行为 |
|------|------|
| trust 上报失败 / 429 | 本地队列重试；不阻塞对话与本地 Memory 更新 |
| Sync 失败 | 现有 Sync 重试；Memory 仍以端上为准直至同步成功 |
| 未知 `kind` / 缺字段 | 拒绝该条；不影响其它合法事件 |
| 用户关闭上报 | 本地 `applyTrust` 仍生效；控制面无新事件 |

原则：采信是增强路径，不是对话主路径依赖。

## 8. 隐私与同意

- 默认：Sync **平台可读**；产品说明与 PRD 需明示。
- 账号级同意：对话备份 + 行为信号用于改进体验。
- 可关闭事件上报；关闭后本地采信逻辑仍可用。
- 一期不做跨用户训练集导出；公共知识沉淀明确后置。

## 9. 验收标准

1. 隐式信号（至少：续问采信、删 Memory 降权）与显式 👎 能改变本地 `trust_score` / 召回行为。
2. Memory 变更经 Sync 多端可见；服务端存在可读副本。
3. `POST /v1/trust/events` 幂等入库；断网重试不丢、不堵对话。
4. `GET /v1/trust/metrics` 能给出按日 / 按 kind 的计数。
5. 关闭上报后：本地采信仍生效，控制面无新事件。
6. 不出现中心向量检索 API；云端不自动改写 Memory。

## 10. 测试策略

- **client-agent**：`TrustSignalCollector` 单测；`MemoryStore.applyTrust` 单测（trust / distrust / correct / deprecated）。
- **server**：`TrustEventsApiTest`（鉴权、幂等、校验、metrics、429）。
- **可选集成**：双端 Sync；一端删 Memory → 另一端降权可见。

## 11. 后置（非一期）

- 公共 / 行业知识库与 RAG（用采信筛质量）。
- 可选 E2E Sync。
- 正式运营后台。
- 云端策略热更新或云端 Memory 重写。
- 私有 Runtime 仓接入同一套 trust API。

## 12. 选定方案摘要

**端上采集并消费采信 → 本地 Memory 变好；可读 Sync 多端一致；控制面只存事件流与聚合指标。**  
公共知识飞轮与中心向量库明确不在本期范围。
