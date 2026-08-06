# 多工具 Ingest → 个人知识库设计（方案 A）

- 日期：2026-08-05
- 状态：实现中（I0）
- 关联：
  - [竞品调研](./2026-08-05-personal-kb-competitive-research.md)（**Go：方案 A**）
  - [Client Agent Runtime PRD](./2026-07-27-client-agent-runtime-prd.md)
  - [SaaS Hybrid 拆分](./2026-08-03-saas-hybrid-agent-design.md)
  - [采信飞轮](./2026-08-04-trust-signal-data-flywheel-design.md)
  - [Cursor sidecar](./2026-08-04-llm-openai-cursor-sidecar-design.md)

## 1. 背景与结论

用户同时使用 Cursor / Claude Code / Codex 等工具；个人助理要形成 **分型个人知识库**（Semantic / Episode / Workspace / Procedural），并在换工具、换设备后仍可召回。

竞品调研结论：跨工具记忆需求已验证，但多数停在 MCP/markdown/git；我们应做 **端上分型 Memory + 薄 Sync + 采信**，Ingest 为喂料层，而非再做一个 Mem0。

**可行性结论：采用方案 A。**  
通用 `ingest_event` + Python 薄 adapter；**Memory 只在 client-agent 消费写入**；Java 控制面保持瘦（鉴权 / Sync / 可选事件副本）；统一入口（Hybrid 派活到各 sidecar）**后置**。

### 1.1 已确认决策

| 决策点 | 选择 |
|--------|------|
| 产品双轨 | **3**：旁路采集 + 统一入口；一期只做旁路 |
| 协议 | **通用 ingest schema** + 每工具薄 adapter |
| Memory 真相 | **端上** client-agent（四类 Memory） |
| Ingest 运行时 | **Python**（可扩现有 `python-sidecar` 或独立 `ingest` 进程） |
| Java 控制面 | 不跑重逻辑；可复用 Sync；可选 append-only ingest 副本（类 trust_events） |
| 一期 adapter | **Cursor transcript / 会话摘要**（已有本地路径与 sidecar 基础） |
| 一期 Memory 落点 | **Episode + Workspace 元数据** 优先；Semantic / Procedural 抽取可异步后置 |
| 中心 ANN | **不做** |

## 2. 目标与边界

### 2.1 一期目标

1. 定义稳定的 `ingest_event` JSON schema（版本化）。
2. Python：Cursor adapter 将本地会话/transcript 归一为事件流。
3. client-agent：`applyIngest(events)` → 写入 Episode（摘要）+ Workspace（路径/提示）；可 Sync 多端可见。
4. 密钥/隐私：ingest 路径做 secrets scrub；用户可关闭采集。
5. 文档与 Demo：一端 ingest 后，另一端（或刷新后）能召回相关 Episode。

### 2.2 一期非目标

- Claude Code / Codex adapter（schema 预留 `source`，实现后置）。
- Hybrid 统一入口派活到 Claude/Codex/Cursor（后置双轨第二段）。
- 云端根据 ingest 自动改写 Memory（与 trust 设计一致：消费在端上）。
- 中心向量检索 / 跨用户知识库。
- 把竞品级 MCP server 作为对外主产品（内部可用 MCP 作投递通道，但产品叙事是个人助理知识库）。

## 3. 架构（方案 A）

```text
[Cursor | Claude* | Codex*]
        │  transcript / hooks / SDK events
        ▼
[Python adapters] ──normalize──► ingest_event[]
        │
        ▼
[python ingest host]   (扩展 sidecar 或独立进程，本机)
        │  投递：本机 HTTP / stdin 队列 /（可选）MCP tool
        ▼
[client-agent]
        applyIngest
          → Episode Memory
          → Workspace metadata
          → (async) Semantic / Procedural extract
          → SyncEngine.push
          → (可选) trust 质量信号
        ▼
[saas-hybrid-agent control plane]
        /v1/sync/*     多端可读副本
        /v1/trust/*    既有采信（可选联动）
        （无中心 ANN；无云端 Memory 重写）

[后置]
[Hybrid UI] → 召回 Memory → dispatch sidecar (cursor/claude/codex)
```

**职责**

| 组件 | 职责 |
|------|------|
| Adapter | 只懂单一工具的文件/API 形状 → `ingest_event` |
| Python ingest host | 调度 adapter、scrub、缓冲、投递给 Runtime |
| `applyIngest` | **唯一**「事件 → Memory 行」消费者（确定性规则 + 可选 LLM 摘要） |
| Sync | 多端 Memory 真相 |
| Java | 设备鉴权、Sync、配额；**不**解析各工具私有格式 |

## 4. `ingest_event` Schema（一期）

### 4.1 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `event_id` | string | 客户端生成，幂等键（建议 `source + native_id` 哈希） |
| `schema_version` | string | 如 `1` |
| `source` | enum | `cursor` \| `claude_code` \| `codex` \| `hybrid` \| `other` |
| `kind` | enum | 见下 |
| `account_hint` | string? | 可选；最终以设备登录账号为准 |
| `device_id` | string? | 产出设备 |
| `native_session_id` | string? | 工具侧会话 id |
| `ts_start` / `ts_end` | string (ISO8601) | 时段 |
| `cwd` / `workspace_root` | string? | 工作区根 |
| `summary` | string | 短摘要（adapter 或本地 LLM 生成；**非**全文 transcript） |
| `paths` | string[] | 触及的相对/绝对路径（截断上限） |
| `skill_hint` | string? |  procedural 候选标题/步骤草稿 |
| `payload` | object? | 小结构扩展；**禁止**默认携带完整对话正文 |
| `scrubbed` | boolean | 是否已做过密钥擦除 |

### 4.2 `kind`（一期）

| kind | 映射 Memory | 说明 |
|------|-------------|------|
| `session_summary` | Episode | 一次工具会话结束摘要 |
| `file_touch` | Workspace | 文件被读/写/提及 |
| `decision` | Semantic（可后置） | 明确决策/偏好句 |
| `procedure_draft` | Procedural（可后置） | 可复用步骤草稿 |
| `raw_marker` | 仅审计 / 丢弃 | 无法分类的标记，一期可忽略 |

**原则：** 事件流是分析/喂料；**Memory 行才是召回真相**。不在端上或云端把 ingest 事件回放成第二套 Memory（对齐 trust_events 与 Memory 的关系）。

### 4.3 体量与隐私

- 单事件 `summary` ≤ 2KB；`paths` ≤ 50；单批 ≤ 100 events。  
- Adapter **必须** scrub：常见 API key、`sk-`、`crsr_`、Bearer、私钥头等。  
- 默认不上传完整 transcript；若需调试，仅本地落盘且不 Sync。

## 5. 端上 `applyIngest` 规则

1. **幂等**：相同 `event_id` 跳过。  
2. `session_summary` → upsert Episode（`source`, `native_session_id`, `summary`, time range, embedding 可异步）。  
3. `file_touch` → Workspace 元数据（path + last_seen + source）；不做大文件拷贝。  
4. `decision` / `procedure_draft`：一期可入队，由现有/后续抽取管线写 Semantic / Procedural。  
5. Sync：Memory 变更走现有 push；失败不丢本地，不阻塞 ingest 队列。  
6. 与 Trust：用户删除/👎 相关 Episode 时，可发 trust `distrust`（复用现有飞轮，非必须一期）。

## 6. Python Ingest Host

### 6.1 布局（建议）

```text
python-sidecar/          # 或新建 python-ingest/
  ingest/
    schema.py            # 校验
    scrub.py
    adapters/
      cursor.py          # 一期
      claude_code.py     # stub
      codex.py           # stub
    deliver.py           # → client-agent
  app_ingest.py          # FastAPI：POST /v1/ingest/run, GET /health
```

与现有 Cursor **补全** sidecar 关系：

- **逻辑分离**：`complete`（LLM 文本）≠ `ingest`（知识喂料）。  
- **进程**：一期可同进程不同路由，或分进程；文档写清端口/环境变量。  
- Java **不必**理解 ingest；若需云副本，另开可选 `POST /v1/ingest/events`（append-only，类 trust）——**默认关闭**，优先 Sync Memory。

### 6.2 投递到 client-agent

一期选定一种并写死（实现计划中二选一）：

| 方式 | 适用 |
|------|------|
| **本机 HTTP** | Web demo / 桌面壳暴露 `POST /local/ingest` |
| **共享目录队列** | ingest 写 JSONL，Runtime 轮询（无 UI 时） |

推荐：**本机 HTTP**（与 demo 对齐）；队列作离线缓冲。

## 7. Cursor Adapter（一期最简）

- 输入：Cursor agent transcript JSONL（如 `~/.cursor/projects/*/agent-transcripts/`）或 stop-hook 提供的 `transcript_path`（若可用）。  
- 输出：1× `session_summary` + 0..N× `file_touch`（从消息中抽路径启发式即可）。  
- `summary`：规则截断首尾用户/助手句，或可选本地/代理 LLM 一句话摘要（无 key 则规则摘要）。  
- `event_id`：`cursor:{transcript_file}:{mtime_or_hash}`。

Claude / Codex：只留 adapter 接口与 `source` 枚举；实现列入后置。

## 8. 错误处理与降级

| 场景 | 行为 |
|------|------|
| adapter 读文件失败 | 跳过该会话；记本地日志 |
| scrub 疑似密钥 | 擦除或丢弃该字段；事件仍可带 `scrubbed=true` |
| client-agent 不可达 | 本地队列重试；不丢已生成事件文件 |
| Sync 失败 | 与现网一致：本地 Memory 为准直至同步成功 |
| 用户关闭采集 | adapter 不跑 / deliver no-op；已有 Memory 保留 |

## 9. 验收标准

1. Cursor 完成一次可识别会话后，ingest 产出合法 `ingest_event[]`（schema 校验通过）。  
2. `applyIngest` 后本地出现 Episode；含 `paths` 时 Workspace 元数据更新。  
3. 同账号另一端 Sync pull 后可见对应 Memory（或单端重启/重新打开 demo 可见持久化）。  
4. 故意放入假 API key 的 transcript → 落库 summary/paths **不含**该密钥。  
5. 重复投递同一 `event_id` 不产生重复 Episode。  
6. 控制面仍无中心向量检索 API；Java 不解析 Cursor 私有格式。

## 10. 测试策略

- **Python**：schema 校验；scrub 单测；Cursor adapter 用夹具 JSONL。  
- **client-agent**：`applyIngest` 幂等、Episode/Workspace 写入单测。  
- **可选集成**：ingest → apply → Sync pull 冒烟。  
- 不做强制「真实 Cursor 账户」E2E。

## 11. Roadmap

与 PRD Phase A/B/C 并行的一条 **个人知识库 / Ingest** 轨道。下面阶段编号用 **I0–I5**（Ingest track），避免与产品总 Phase 混淆。

### 11.1 总览

```text
I0 协议与 Cursor 闭环（本期）
 → I1 多 adapter + 抽取强化
 → I2 统一入口（派活）+ 工具环规则
 → I3 采信联动 + 可选 ingest 分析流
 → I4 移动端 / E2E / MCP 只读外露
 → I5 生态与增强（大 Workspace、小模型抽取…）
```

| 阶段 | 主题 | 依赖 | 优先级 |
|------|------|------|--------|
| **I0** | 通用 schema + Cursor adapter + `applyIngest` → Episode/Workspace + Sync | 现有 client-agent Memory、Sync | P0（本期） |
| **I1** | Claude Code / Codex adapters；Semantic / Procedural 异步抽取 | I0；PRD Procedural（约 Phase B） | P0 |
| **I2** | Hybrid 统一入口：召回 Memory 后 dispatch cursor/claude/codex sidecar | I0；现有 Cursor complete sidecar | P0（接 I1 或并行后半） |
| **I3** | Ingest ↔ Trust 采信；可选控制面 `ingest_events` 分析流 | I0 + trust API | P1 |
| **I4** | iOS/Android 同协议召回；可选 E2E Sync；MCP 只读暴露个人库 | PRD Phase B；I1 | P1 |
| **I5** | Workspace 大文件分块；端侧小模型摘要/重排；更多 host adapter | PRD Phase C | P2 |

### 11.2 I0 — 协议与 Cursor 闭环（本期）

- `ingest_event` schema v1 + scrub + 幂等  
- Python Cursor adapter（transcript / hook）  
- client-agent `applyIngest` → Episode + Workspace 元数据  
- Sync 多端可见；Demo 可演示「Cursor 干活 → Hybrid 记得」  
- **不做**：Claude/Codex adapter、统一派活、中心 ANN  

### 11.3 I1 — 多工具喂料 + 分型写全

- Claude Code adapter（Agent SDK / `~/.claude` 会话）  
- Codex adapter（`~/.codex/sessions` 或 SDK events）  
- `decision` → Semantic、`procedure_draft` → Procedural 的异步抽取管线（可规则 + 可选 LLM）  
- adapter 注册表：按本机探测到的工具根目录自动启用  
- **成功标准**：同一账号下，三工具任一会话摘要可在另一端 Hybrid 召回  

### 11.4 I2 — 统一入口（双轨第二段）

- Hybrid UI：选 engine（`openai` 工具环 \| `cursor` \| `claude_code` \| `codex`）  
- 派活前 **先召回** 个人 Memory bundle 注入上下文  
- 产品规则写死：**sidecar 引擎忽略端上 `tools`**（对齐现 Cursor 一期），避免双工具环；`openai` 路径保留 Hybrid ToolHost  
- 派活产生的回合也可写成 `source=hybrid` 的 ingest/Episode，反哺知识库  
- **成功标准**：在 Claude/Codex/Cursor 间切换入口，Memory 连续，无需重讲项目约定  

### 11.5 I3 — 质量飞轮

- 用户删 Episode / 👎 摘要 → trust `distrust`，降低召回  
- 续用某条 ingest 来源的事实 → `trust` 强化  
- 可选：控制面 `POST /v1/ingest/events` append-only（分析用，**非** Memory 真相）；默认关闭或抽样  
- 平台 metrics：按 `source` / `kind` 的 ingest 采纳率（与 trust metrics 并列）  

### 11.6 I4 — 多端产品化与外露

- 移动 Runtime 召回同一 Sync Memory（PRD Phase B）  
- 可选 E2E Sync（隐私敏感用户）  
- MCP **只读** tools：`memory_search` / `memory_get`（给仍留在 Cursor/Claude 里的用户召回 Hybrid 库）  
- 主叙事仍是个人助理，不是「又一个 MCP memory 插件」  

### 11.7 I5 — 增强

- Workspace 大文件分块同步与按需拉取（PRD Phase C）  
- 端侧小模型做 session 摘要 / 重排，减少云摘要成本  
- 更多 host：Aider、Continue、OpenCode 等（仅当 adapter 成本低）  
- Dev Companion / 远程终端类能力若落地，其会话同样走 ingest  

### 11.8 明确不进 Roadmap（保持 No-Go）

| 项 | 原因 |
|----|------|
| 中心跨用户向量库 / 公共 RAG | 违背 Hybrid 成本与定位 |
| 云端自动改写用户 Memory | 消费必须在端上（对齐 trust） |
| 以 MCP vault 为唯一产品形态 | 红海、无 Sync/采信差异化 |
| 同一会话端上 tools + sidecar 内部 tools 双开 | 归属混乱；I2 用引擎互斥规则 |

### 11.9 与产品总 Phase 的对照

| 产品 Phase | Ingest 轨道大致落点 |
|------------|---------------------|
| A（Web 闭环，当前） | **I0**；I1/I2 可在 A 尾或 B 头启动 |
| B（移动 + Procedural + 可选 E2E） | **I1** Procedural 抽取、**I4** 移动召回 / E2E / MCP 只读 |
| C（大 Workspace、小模型） | **I5** |

## 12. 选定方案摘要

**通用 ingest 协议 + Python 薄 adapter 喂料；client-agent 写入分型 Memory 并 Sync 多端；Java 保持瘦控制面。**  
路线：**I0 Cursor 闭环 → I1 多 adapter 与分型写全 → I2 统一派活 → I3 采信 → I4 移动/MCP → I5 增强**；统一入口与中心 ANN 分别后置与永不做。
