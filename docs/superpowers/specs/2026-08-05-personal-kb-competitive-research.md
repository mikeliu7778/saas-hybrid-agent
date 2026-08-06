# 个人知识库 / 多工具 Memory 竞品调研

- 日期：2026-08-05
- 状态：调研结论（支撑 Ingest 方案 A）
- 关联产品意图：多工具（Cursor / Claude Code / Codex）旁路采集 + Hybrid 统一入口后置 → 端上四类 Memory → Sync 多端

## 1. 结论（先读）

| 判断 | 说明 |
|------|------|
| **市场方向成立** | 2025–2026「Agent Memory」已成为独立赛道；编码 Agent 跨工具遗忘是真实痛点 |
| **赛道已挤** | OSS/MCP 层已有一批「读各家 transcript → 本地库」产品，纯做 adapter 差异化弱 |
| **我们仍有空位** | 多数竞品停在「给 coding agent 塞记忆」；少见 **薄 SaaS 多端 Sync + 分型 Memory + 采信飞轮 + 个人助理 Runtime** 的一体化 |
| **建议继续做方案 A** | 通用 `ingest_event` + Python adapter；Memory 在端上；控制面只 Sync/鉴权。先证明闭环，再统一入口 |

**一句话：** 需求已被市场验证；不要做成又一个 Mem0/MCP vault，而要做成 **个人助理的知识飞轮（记住 + 多端同步 + 可采信）**，Ingest 是喂料层。

## 2. 市场分层

### 2.1 基础设施型 Memory API（面向开发者）

| 产品 | 形态 | 要点 | 与我们的关系 |
|------|------|------|--------------|
| [Mem0](https://mem0.ai) | 托管/自托管 memory API | 抽取事实 + 向量/图；生态大、接入快 | 偏「给任意 Agent 挂一层记忆」；默认云端/中心检索，与 Hybrid「端上索引」相反 |
| [Zep / Graphiti](https://www.getzep.com) | 时序知识图 | 事实有效期、时序推理强 | 企业/CRM 向；过重，非个人助理主路径 |
| [Letta](https://www.letta.com)（原 MemGPT） | **Agent Runtime** + 分层 Memory | Agent 自管理 memory blocks | 竞品偏「换 Runtime」；我们已有 client-agent Runtime |
| [Mnemoverse](https://mnemoverse.com) | 跨工具托管 Memory API | 一 key 连 Claude/Cursor 等；强调 outcome feedback | 最接近「跨工具共享记忆」的商业叙事，但是 **云 API**，非端上四类 Memory |
| Cognee / Cloudflare Agent Memory 等 | 图 ingest / 托管 | 文档 ingest、平台绑定 | 参考能力，非直接对标 |

共性：卖的是 **memory infrastructure**，不是「个人助理产品 + 多端 Sync 体验」。

### 2.2 编码 Agent 跨工具本地记忆（最直接对标）

痛点几乎同一句：**Claude / Cursor / Codex 各记各的，换工具就失忆。**

| 项目 | 接入方式 | 存储 / 同步 | 备注 |
|------|----------|-------------|------|
| [agent-knowledge](https://github.com/keshrath/agent-knowledge) | 多 host transcript adapter（Claude/Cursor/Codex/Aider…） | Markdown vault + **git sync** | 与方案 A「通用协议 + 薄 adapter」高度同构 |
| [code-session-memory](https://github.com/djannot/code-session-memory) | stop hook / 读本地 session 文件 | 统一向量库 + MCP | Cursor/Claude/Codex 等同库 |
| [PMB](https://github.com/oleksiijko/pmb) | MCP + hooks | 本地 SQLite；无云 | 强调 local-first、注入上下文 |
| [memento-vault](https://github.com/sandsower/memento-vault) | SessionEnd triage → Zettelkasten | markdown + git；可远程 MCP | 会话蒸馏成笔记 |
| [memex](https://github.com/yuvrajangadsingh/memex) | MCP | markdown cards + git | 无向量库叙事 |
| [MemRosetta](https://github.com/obst2580/memrosetta) | MCP + 本地引擎 | SQLite；可选自托管 sync hub | 文案直接打「Claude + Codex + Cursor 一台脑子」 |

共性：

- **旁路采集**（读 `~/.cursor`、`~/.claude`、`~/.codex` 或 hook）已是主流路径  
- 同步多为 **git / 自托管 hub**，少有「账号级 Sync API + 设备鉴权 + 配额」的产品化控制面  
- 记忆模型多为 **扁平笔记 / 向量片段**，少见 PRD 级 **Semantic / Episode / Workspace / Procedural** 分型  
- 几乎都没有 **采信信号 → 降权/强化** 的产品闭环  

### 2.3 个人 PKM / 知识工 AI

| 产品 | 要点 | 关系 |
|------|------|------|
| ZIBRI 等 | 笔记/PDF → 个人 AI | 知识工向，非 coding agent ingest |
| Obsidian + AI 插件 | 人写 vault，Agent 读写 | 互补；可作 Workspace 导出目标，不作主竞品 |

## 3. 机会与风险

### 3.1 机会（做）

1. **产品位比「又一个 MCP memory」高一档**：端上 Runtime + 四类 Memory + Sync 多端 + Trust 飞轮 +（后置）统一入口派活。  
2. **服务端保持瘦**：与 Mem0/Mnemoverse 云记忆形成差异——成本与隐私叙事对齐现有 Hybrid。  
3. **Ingest 协议可兼容竞品思路**：adapter 模式已被验证；我们把事件归一进 **自己的 Memory 分型**，而不是停在 markdown vault。  
4. **编码用户已习惯多工具**：Cursor + Claude Code + Codex 并存是常态，跨工具记忆需求真实。

### 3.2 风险（避）

1. **功能重叠**：若一期只做「读 transcript → 向量搜索 → MCP」，会与 agent-knowledge / PMB / memex 硬撞，难赢开源免费层。  
2. **中心向量库诱惑**：一上云 ANN 就掉进 Mem0 赛道，丢掉 Hybrid 成本优势。  
3. **双环混乱**：统一入口后若端上工具环与 Cursor/Claude 内部工具同时开，体验与 Memory 归属会乱（需产品规则）。  
4. **合规/密钥**：旁路读本地 session 可能含密钥与隐私；必须 scrub + 用户同意（竞品已普遍做 secrets scrubbing）。

## 4. 差异化主张（建议对外叙事）

> **不是「给 Agent 挂一块记忆 API」，而是「个人助理拥有分型知识库：多工具喂料、多设备同步、采信改进、服务端保持轻」。**

| 维度 | 典型竞品 | Hybrid 目标态 |
|------|----------|----------------|
| 记忆模型 | 扁平笔记 / 单一向量 | Semantic · Episode · Workspace · Procedural |
| 运行时 | 无 / 外挂 MCP | client-agent 自有循环 |
| 同步 | git / 可选自托管 | 账号 Sync API + 设备鉴权（薄控制面） |
| 质量 | 少 | Trust 信号强化/降权 |
| 入口 | 仅旁路 | 旁路 + 后置统一派活（sidecar） |
| 服务端 | 常有中心库或纯本地无账号 | 瘦：auth / LLM proxy / Sync / metrics |

## 5. Go / No-Go

| 选项 | 建议 |
|------|------|
| 只做跨工具 transcript MCP | **No-Go**（红海、难差异化） |
| 方案 A：通用 Ingest → 端上四类 Memory → Sync；Python adapter；统一入口后置 | **Go** |
| 一上来做云端个人知识库 ANN | **No-Go**（违背 Hybrid） |

## 6. 对设计文档的输入

已确认可写入 [multi-tool ingest design](./2026-08-05-multi-tool-ingest-memory-design.md)：

- 路径：**双轨**（旁路 ingest 先，统一入口后）  
- 协议：**通用 ingest_event + 薄 adapter**  
- 实现：**Python 做 ingest/adapter；Java 控制面保持瘦（可不做重逻辑）**  
- Memory：**client-agent 写入与召回**  
- 一期：schema + 一个最简 adapter（建议 Cursor transcript）+ Episode/Workspace 落库 + Sync 可见  

详细阶段见该设计 **§11 Roadmap（I0–I5）**：I0 Cursor 闭环 → I1 多 adapter → I2 统一派活 → I3 采信 → I4 移动/MCP → I5 增强。
