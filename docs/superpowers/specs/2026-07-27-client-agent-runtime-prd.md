# 客户端 Agent Runtime 产品需求文档（PRD）

- 日期：2026-07-27
- 状态：草案（待评审）
- 关联 design：[2026-08-03-saas-hybrid-agent-design.md](./2026-08-03-saas-hybrid-agent-design.md)
- 关联 trust：[2026-08-04-trust-signal-data-flywheel-design.md](./2026-08-04-trust-signal-data-flywheel-design.md)
- 产品定位：一人一设备本地 Agent Runtime + 共享 LLM / 同步云控制面

## 1. 背景与问题

现有 Java 一期以服务端托管 Agent 循环与工具执行为主。面向千万级个人助理场景时，存在三类硬约束：

1. **成本**：中心化向量库（ANN + embedding）按用户数线性膨胀，存储与检索成本不可接受。
2. **上下文**：工具调用与 Memory 召回强依赖设备侧上下文（文件、剪贴板、相册等），放云端增加延迟与隐私面。
3. **多端连续**：同一账号在手机 / 平板 / Web 间需要状态连续，但不需要中心在线共享完整向量索引。

**产品结论：** 不做「一人一 Pod」；采用 **客户端跑循环 + Memory + 工具，服务端做薄控制面（鉴权、LLM 代理、同步、配额）**。

**Sync 与采信飞轮：** 一期 Sync 在服务端保存**平台可读** messages / Memory 副本，支撑多端一致；采信信号经 `POST /v1/trust/events` 上行、控制面聚合 `GET /v1/trust/metrics`，端上 `applyTrust` 消费信号改进本地 Memory。E2E 加密同步为后置可选，详见 [trust design](./2026-08-04-trust-signal-data-flywheel-design.md)。

## 2. 产品目标

### 2.1 愿景

用户在任意已登录设备上，获得能记住偏好与往事、能操作本机沙箱能力、并能跨端接续对话的个人 Agent；云侧只转发模型与同步加密数据，不托管中心语义检索。

### 2.2 一期成功标准（可度量）

| ID | 标准 | 度量方式 |
|----|------|----------|
| SC-1 | 用户可在 Web 完成「对话 → 本地 Memory 召回 → 工具调用 → 流式回复」闭环 | Phase A 演示 / E2E |
| SC-2 | Memory 检索不请求中心向量库；单用户本地索引可支撑 ≤1e5 条量级 | 架构评审 + 本地压测 |
| SC-3 | 同账号两设备间 messages + Memory 行数据可异步同步并冲突可收敛 | 双端同步用例 |
| SC-4 | LLM API Key 不出端；Sync 默认平台可读；E2E 加密为后置可选（见 trust design） | 安全评审 |
| SC-5 | 不支持的工具能力向模型返回明确 unsupported，不导致 Runtime 崩溃 | 工具矩阵用例 |

### 2.3 非目标（一期明确不做）

- 端侧跑 7B+ 本地主对话模型
- 服务端全局「跨用户」语义搜索
- 完整桌面级终端沙箱 / 多租户远程 shell
- 将现有 JVM `AgentRuntime` 原样搬入浏览器或移动端
- 消息平台网关（Telegram / Discord 等）

## 3. 用户与角色

| 角色 | 描述 | 核心诉求 |
|------|------|----------|
| 终端用户（个人助理用户） | 在 Web / iOS / Android 使用 Agent | 记得我、能办事、多端连续、隐私可控 |
| 多设备用户 | 同一账号 ≥2 台设备 | 换机不丢会话与记忆；冲突可理解、可处理 |
| 隐私敏感用户 | 不愿云端明文存笔记/记忆 | 默认可 E2E 加密备份；密钥不出端 |
| 客户端集成方 / SDK 使用者 | 嵌入 ClientAgentRuntime | 跨端协议一致、可测、可扩展 ToolHost |
| 平台运维 | 运维 Cloud Control Plane | 轻控制面：鉴权、限流、同步、配额；无中心 ANN |

## 4. 分期与范围

| 阶段 | 名称 | 范围摘要 | 优先级 |
|------|------|----------|--------|
| Phase A | 验证闭环（Web 优先） | TS Runtime + LlmGateway；Semantic + Episode 本地检索；messages + memory 同步（可先非 E2E）；沙箱文件 + HTTP 工具 | P0 |
| Phase B | 移动端与加固 | iOS/Android 同协议 Runtime；端侧 embedding；采信飞轮与 trust metrics；Procedural Memory；E2E 加密同步为可选后置 | P0（接 A） |
| Phase C | 增强 | Workspace 大文件分块；可选 Dev Companion 远程终端；端侧小模型抽取/重排 | P1 |

本 PRD 的 User Story 按阶段标注；**验收以 Phase A 为第一交付门槛**，B/C 作为后续里程碑。

## 5. User Stories

格式：`作为…，我希望…，以便…`；每条含优先级、阶段与验收标准（Acceptance Criteria）。

### 5.1 对话与 Agent 循环

#### US-A01 发起一轮对话 Turn

- **Story：** 作为终端用户，我希望向 Agent 发送一条消息并看到流式回复，以便快速获得帮助。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. 可创建会话并发送用户消息。
  2. 通过流式通道收到文本增量与 Turn 结束事件。
  3. Turn 内若模型产生 tool_calls，客户端本地执行后再继续 LLM，全程不把工具环交给服务端。

#### US-A02 多步工具协作

- **Story：** 作为终端用户，我希望 Agent 能在一轮对话中多次调用本机可用工具（如读写沙箱文件、HTTP），以便完成「查资料 + 改文件」类任务。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. ConversationLoop 在无 tool_calls、预算耗尽、中断或失败时结束。
  2. 每次用户 Turn 开始时重置 IterationBudget（默认上限可配置，语义对齐服务端一期）。
  3. 非法工具名 / 损坏参数回传模型可见错误，不崩溃 Runtime。

#### US-A03 中断当前任务

- **Story：** 作为终端用户，我希望能中断正在进行的 Turn，以便停止错误或过长的任务。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. 在模型等待与工具执行间隙响应中断。
  2. Turn 状态为 cancelled；历史已落盘部分可续聊。

#### US-A04 平台能力不足时的降级

- **Story：** 作为终端用户，我希望当某工具在当前平台不可用时 Agent 能说明限制并换路径，而不是静默失败。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. ToolHost 对不支持能力返回明确 `unsupported`（或等价错误）给模型。
  2. Web / iOS / Android 能力矩阵与产品文案一致（一期无任意 shell）。

---

### 5.2 四类 Memory

#### US-M01 语义记忆自动沉淀与召回

- **Story：** 作为终端用户，我希望 Agent 记住我的稳定偏好与事实（如语言、时区），并在后续对话自动用上，以便少重复说明。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. Turn 结束后可异步抽取并写入 Semantic Memory（`text` + `embedding` + 元数据）。
  2. 新 Turn 组装 prompt 前在**本地**完成 top-k 语义检索，不请求中心向量库。
  3. 条目可同步到同账号其他设备，对端拉取后更新本地向量表。

#### US-M02 情景记忆（往事）召回

- **Story：** 作为终端用户，我希望 Agent 能想起相关的历史任务摘要（如「上周改过简历」），以便接续上下文。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. Episode 以摘要 + 时间范围 + embedding 存储；原始长对话可仅存引用。
  2. 检索支持时间衰减 × 语义相似度，注入短摘要并控制 token。
  3. 摘要必同步；原始长对话可懒同步。

#### US-M03 工作区记忆

- **Story：** 作为终端用户，我希望 Agent 能感知我当前工作区中的文件与摘要，以便基于我的笔记/附件回答。
- **优先级：** P0｜**阶段：** A（基础）/ C（大文件分块）
- **验收标准：**
  1. Workspace 落在应用沙箱（Web OPFS / 移动端 App 目录）+ 元数据表。
  2. 检索以路径 / FTS 为主；大文件可用摘要 embedding 辅助。
  3. Phase C：大文件按内容哈希分块同步，可按需拉取。

#### US-M04 过程记忆 / 技能包

- **Story：** 作为终端用户，我希望 Agent 能复用「如何做某事」的技能步骤，以便同类任务更稳、更快。
- **优先级：** P0｜**阶段：** B
- **验收标准：**
  1. Procedural Memory 以 Markdown/结构化步骤 + 可选 embedding 存储，按 `skill_id` 版本化。
  2. 检索为关键词 + 语义 top-k；命中后注入提示，不每次灌全量技能库。
  3. 冲突默认以较高 version 或「最近成功使用」策略收敛（可配置）。

#### US-M05 Memory 导入导出

- **Story：** 作为隐私敏感用户，我希望能导出/导入 Memory 包，以便备份或迁移到新设备。
- **优先级：** P1｜**阶段：** B
- **验收标准：**
  1. Runtime 提供 `exportMemoryPack` / `importMemoryPack`。
  2. 包格式版本化；导入后本地索引可重建。

---

### 5.3 同步与多端

#### US-S01 同账号跨端接续对话

- **Story：** 作为多设备用户，我希望在手机上开聊、在 Web 上继续，以便工作流不被设备绑死。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. Chat messages 按 message id 同步；冲突默认 LWW（`updated_at` + 时钟校正）。
  2. 设备无需同时在线；经 Sync Service 异步 push/pull。
  3. Session meta 可同步。

#### US-S02 Memory 跨端一致

- **Story：** 作为多设备用户，我希望一端学到的偏好与情景在另一端也能被召回，以便体验连续。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. Semantic / Episode / Procedural 行按 row id 同步，含 embedding。
  2. 删除使用 tombstone；版本号 + LWW。
  3. 各端本地维护向量索引；服务端不做在线 ANN。

#### US-S03 工作区冲突可处理

- **Story：** 作为多设备用户，我希望两端同时改同一文件时不丢数据，并能察觉冲突。
- **优先级：** P1｜**阶段：** C（完整）/ A（可简化）
- **验收标准：**
  1. 同路径冲突生成 conflict copy 或引导用户选主端。
  2. UI 有明确冲突提示（至少 conflict copy 可发现）。

#### US-S04 设备注册与吊销

- **Story：** 作为隐私敏感用户，我希望查看已登录设备并吊销丢失设备，以便控制数据同步面。
- **优先级：** P0｜**阶段：** A（API）/ B（完整产品体验）
- **验收标准：**
  1. 可注册设备；可 DELETE 吊销。
  2. 吊销后该设备 token 失效，无法再 push/pull 与调用 LLM 代理。

---

### 5.4 云控制面与安全

#### US-C01 通过云代理调用 LLM

- **Story：** 作为终端用户，我希望正常对话而无需在客户端配置模型厂商密钥，以便安全地使用云端模型。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. 客户端仅持用户/设备 token；经 `POST /v1/llm/chat`（SSE）完成补全。
  2. 本次请求的 tools schema 由客户端上传。
  3. 按用户限流；超限返回明确错误。

#### US-C02 Embedding 可用（端或云）

- **Story：** 作为终端用户，我希望语义检索可用且尽量保护隐私。
- **优先级：** P0｜**阶段：** A（Web 可用云 Embedding）/ B（移动端优先端侧）
- **验收标准：**
  1. Phase A Web：可通过 `POST /v1/llm/embeddings` 或等价路径获取向量。
  2. Phase B 移动端：优先端侧小 embedding 模型；同步携带 `embedding_model_id`。
  3. 模型版本变更后可触发懒重嵌，旧向量不导致崩溃。

#### US-C03 端到端加密备份（可选后置）

- **Story：** 作为隐私敏感用户，我希望可选地让云端看不到我的 Memory 与 workspace 明文，以便在需要时加强隐私。
- **优先级：** P1｜**阶段：** 后置可选（A/B 默认平台可读 Sync，见 [trust design](./2026-08-04-trust-signal-data-flywheel-design.md)）
- **验收标准：**
  1. 开启 E2E 时：Memory/workspace 上传前使用用户密钥派生的信封加密；服务端仅存密文。
  2. 默认 Sync 为平台可读副本，支撑多端与采信飞轮；「明文云记忆 / 服务端智能推荐」若存在，必须单独显式开关。

#### US-C04 用量与配额可见

- **Story：** 作为终端用户，我希望能查看自己的用量配额，以便避免突然不可用。
- **优先级：** P1｜**阶段：** A
- **验收标准：**
  1. `GET /v1/quota` 返回当前用量与限额。
  2. 接近配额时客户端有可理解提示（至少错误码可映射文案）。

---

### 5.5 平台与工程

#### US-P01 Web 端可用个人助理

- **Story：** 作为终端用户，我希望在浏览器中使用 Agent（文件沙箱 + HTTP 工具 + Memory），以便无需装 App 即可验证价值。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. TS ClientAgentRuntime + OPFS/SQLite(wasm) 或等价本地存储。
  2. 工具矩阵符合设计 §5.2 Web 列。
  3. Web 存储易丢场景下，强制/引导云同步并有配额提示。

#### US-P02 iOS / Android 同协议体验

- **Story：** 作为多设备用户，我希望手机上的对话与记忆语义与 Web 一致，以便换端无学习成本。
- **优先级：** P0｜**阶段：** B
- **验收标准：**
  1. Swift / Kotlin Runtime 实现同一状态机规格（或共享 KMP/Rust 核心）。
  2. 协议 / Memory 实体版本化；与 Web 可互相同步。
  3. 原生能力（分享、剪贴板、通知、相机/相册授权）按矩阵开放。

#### US-P03 集成方可嵌入 Runtime

- **Story：** 作为客户端集成方，我希望有稳定的 Runtime API（建会话、跑 Turn、中断、导入导出 Memory、同步），以便嵌入自有 UI Shell。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. 暴露与设计一致的核心接口：`createSession` / `runTurn` / `interrupt` / Memory 与 Sync 入口。
  2. 提供 Mock LLM / 本地夹具，便于单测循环与 Memory 编排。
  3. OpenAPI / JSON Schema 描述 Sync 与 LLM 控制面，与现有 Java 服务演进路径兼容。

#### US-P04 运维可运行薄控制面

- **Story：** 作为平台运维，我希望只运维鉴权、LLM 代理、同步与配额，而不运维千万用户中心向量集群，以便成本可控。
- **优先级：** P0｜**阶段：** A
- **验收标准：**
  1. 本仓 `saas-hybrid-agent` server 作为 LlmGateway + Sync API 控制面；服务端工具执行降级或仅私有化单租户保留（姊妹仓 `java-agent-runtime`）。
  2. 无「跨用户语义搜索」API。
  3. 文档明确：服务端 Runtime 适合私有化/单租户；C 端默认走客户端 Runtime。

---

### 5.6 可选增强（Phase C）

#### US-X01 自有机器 Dev Companion

- **Story：** 作为进阶用户，我希望绑定自有机器上的 Companion 以获得强终端能力，以便在需要时做 DevOps/编码类任务，而不把危险 shell 放回多租户云。
- **优先级：** P1｜**阶段：** C
- **验收标准：**
  1. Companion 为可选扩展；未绑定用户仍可完整使用个人助理主路径。
  2. 产品文案区分「端侧沙箱工具」与「自有 Companion 终端」。

## 6. 功能需求追溯（Story → 能力）

| 能力域 | 相关 Story | 设计锚点 |
|--------|------------|----------|
| ConversationLoop | US-A01～A04 | 设计 §3.1 / §5.1 |
| ToolHost | US-A02, US-A04, US-P01, US-P02 | 设计 §5.2 |
| Semantic / Episode | US-M01, US-M02 | 设计 §4.2 / §4.4 |
| Workspace | US-M03, US-S03 | 设计 §4.1 / §6.1 |
| Procedural | US-M04 | 设计 §4.3 |
| SyncEngine | US-S01～S04, US-C03 | 设计 §6 |
| LlmGateway / Auth / Quota | US-C01, US-C02, US-C04, US-P04 | 设计 §7 |
| 跨端 SDK | US-P03, US-P02 | 设计 §8 |

## 7. 非功能需求

| ID | 类别 | 要求 |
|----|------|------|
| NFR-1 | 规模 | 单用户本地 Memory 合计按 <1e5 条设计；检索超时可降级 FTS |
| NFR-2 | 隐私 | LLM 密钥仅存 Gateway；Sync 默认平台可读；E2E 加密为后置可选 |
| NFR-3 | 性能 | Turn 开始前 Memory 检索有时间预算；超时降级不得卡死 UI |
| NFR-4 | 可靠 | 同步支持 cursor 增量、tombstone；冲突策略文档化并可测 |
| NFR-5 | 安全 | ToolHost 域名白名单；禁止把密钥写入 Memory；提示词注入缓解 |
| NFR-6 | 兼容 | 跨端协议版本化；`embedding_model_id` 变更可懒重嵌 |
| NFR-7 | 演进 | Java ConversationLoop 作语义参考与私有化选项；与客户端协议兼容、非进程共用 |

## 8. 里程碑验收清单

### Phase A（Web 闭环）

- [ ] US-A01～A04：对话循环、工具、中断、unsupported
- [ ] US-M01、US-M02：Semantic + Episode 本地写入与检索
- [ ] US-M03（基础）：沙箱 Workspace + FTS/路径提示
- [ ] US-S01、US-S02：messages + memory rows 同步
- [ ] US-C01、US-C02（云 Embedding 可接受）、US-S04（设备 API）
- [ ] US-P01、US-P03、US-P04

### Phase B（移动 + 加固）

- [ ] US-P02；US-M04；US-M05
- [ ] US-C02 端侧 embedding；采信飞轮 + `POST /v1/trust/events` / `GET /v1/trust/metrics`（见 [trust design](./2026-08-04-trust-signal-data-flywheel-design.md)）
- [ ] US-S04 完整吊销体验
- [ ] US-C03 E2E 加密（可选后置，非 B 门槛）

### Phase C（增强）

- [ ] US-M03 大文件分块；US-S03 冲突 UX
- [ ] US-X01 Dev Companion（可选）

## 9. 风险与产品对策

| 风险 | 产品/工程对策 | 关联 Story |
|------|---------------|------------|
| 端检索卡顿 | 条数上限、后台索引、超时降级 FTS | NFR-1/3, US-M01 |
| Web 存储丢失 | 强制/引导同步 + 配额提示 | US-P01, US-S01 |
| 同步冲突伤信任 | conflict copy + 提示；关键 Semantic 可人工合并 | US-S03 |
| 用户期望任意 shell | 文案对齐能力矩阵；Companion 为高级能力 | US-A04, US-X01 |
| Embedding 升级 | 版本字段 + 懒重嵌 | US-C02 |

## 10. 术语

| 术语 | 含义 |
|------|------|
| ClientAgentRuntime | 跑在 Web/iOS/Android 的 Agent 运行时（循环 + 工具 + Memory + 同步） |
| Turn | 一次用户发消息触发的完整处理（可含多次模型调用与本地工具执行） |
| Cloud Control Plane | 鉴权、LLM 代理、Sync、配额等薄服务端 |
| MemoryBundle | 一次检索得到的 Semantic/Procedural/Episode/Workspace 提示集合 |
| ToolHost | 平台能力适配层；无能力则 unsupported |
| Companion | 用户自有机器上的可选强终端扩展（非一期默认） |

## 11. 开放决策（评审时确认）

| 编号 | 问题 | 建议默认 |
|------|------|----------|
| OD-1 | Phase A 同步是否允许暂时非 E2E？ | 允许；A/B 默认平台可读 Sync；E2E 为后置可选（见 trust design） |
| OD-2 | Web Embedding 一期用云还是尽早端侧？ | A 用云；B 移动端侧，Web 可随后跟上 |
| OD-3 | 共享核心用 KMP / Rust 还是三端各自实现？ | A 先 TS 规格 + 契约测试；B 再定共享核心 |
| OD-4 | 现有服务端 `run_terminal` 多租户路径？ | 降级/移除出默认 C 端路径；保留私有化文档 |

## 12. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-27 | 初稿：由客户端 Runtime 设计转化为 PRD；含角色、分期、User Stories 与验收标准 |
| 2026-08-04 | 对齐 trust design：Sync 默认平台可读；E2E 改为可选后置；链到采信飞轮设计 |
