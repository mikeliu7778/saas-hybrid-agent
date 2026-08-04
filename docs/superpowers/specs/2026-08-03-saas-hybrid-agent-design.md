# SaaS Hybrid Agent 拆分设计

- 日期：2026-08-03
- 状态：已确认
- 关联：
  - [2026-07-27-client-agent-runtime-prd.md](./2026-07-27-client-agent-runtime-prd.md)
  - 私有 Runtime 实现迁至姊妹仓 `java-agent-runtime`

## 1. 目标

将本仓库正式定位为 **SaaS Hybrid Agent**：

- **云端**：薄控制面（鉴权/设备、LLM 代理、Sync、Quota）
- **端上**：`client-agent` 跑 ConversationLoop、工具与 Memory
- **私有化服务端 AgentRuntime**（`/v1/sessions/**`）迁出到独立项目，且迁出后可独立构建、测试、运行

### 1.1 本期范围（A）

- 产品定位与代码边界对齐 Hybrid
- 从本仓移除服务端工具环与 session API
- 在 `/Users/liubing/work/java-agent-runtime` 落地可工作的私有 Runtime

### 1.2 明确非目标（后置 B 及其他）

- 多租户账号体系、计费后台、管理控制台
- 同一会话端云混合执行（工具部分上云 Worker）
- 两仓长期共享 Maven 构件（本期允许复制配置/鉴权精简版，不抽公共库）

## 2. 职责与边界

### 2.1 本仓库 `saas-hybrid-agent`（SaaS Hybrid Control Plane）

**保留：**

- `server` 控制面：`/v1/devices`、`/v1/llm/*`、`/v1/sync/*`、`/v1/quota`
- 设备鉴权、限流/配额、健康检查
- `client-agent` 与 Phase A OpenAPI/协议文档
- 控制面相关测试（如 `ControlPlaneApiTest`）

**移除：**

- `core` 模块（AgentRuntime、工具、SQLite 会话等）
- `/v1/sessions/**` 及 session DTO、`SseEventWriter`（session 用）
- `AgentConfig`、`SqliteConfig` 及对 `core` 的 Maven 依赖
- 以私有化服务端 Runtime 为主叙事的 README/验收项

**定位：** 云端薄控制面；Agent 循环与工具在端上。

### 2.2 新项目 `/Users/liubing/work/java-agent-runtime`（Private Server Runtime）

**迁入：**

- 完整 `core` 模块及测试
- 带 Session API 的 Spring Boot `server` 切片（可独立 `spring-boot:run` / Docker / smoke）
- Runtime 向配置、Dockerfile、`scripts/smoke.sh`

**不包含：**

- 控制面多设备 SaaS API
- `client-agent`

**定位：** 自托管「服务端跑 Agent」；密钥与工具在服务端。

**包名：** 迁出代码保持 `com.github.javaagent.*`，避免无谓重命名；父 POM `artifactId` 改为 `java-agent-runtime` 以区分部署产物。

### 2.3 运行时耦合

两仓 **无运行时耦合**：不共享进程、不共享 DB、不互相 HTTP 依赖。

## 3. 目录结构与迁出清单

### 3.1 新仓结构

```text
/Users/liubing/work/java-agent-runtime/
  pom.xml                 # 多模块父工程（artifact: java-agent-runtime）
  core/                   # 整模块迁入
  server/                 # 仅私有 Runtime HTTP
  Dockerfile
  scripts/smoke.sh
  README.md
  docs/                   # 可选：复制一期 Runtime 设计说明
```

### 3.2 新仓迁入清单

从本仓 **复制后删除**：

- 整模块 `core/`
- `SessionController`、`SseEventWriter`、session 相关 DTO
- `AgentConfig`、`SqliteConfig`
- `SessionControllerTest` 及所有 `core` 测试
- Runtime 相关 `application.yml` 片段（workspace / sqlite / model 等）
- Docker、`scripts/smoke.sh`（session 验收）

新仓 server **自带精简版**：

- `JavaAgentApplication`、`HealthController`
- 简化 `JavaAgentProperties`（去掉 control-plane 配额/限流；优先精简）
- 简化鉴权：仅可选 `JAVA_AGENT_TOKEN`（**不要** DeviceRegistry / 控制面路径）
- `ApiExceptionHandler`（只保留 Runtime 相关异常映射）

### 3.3 本仓精简后结构

```text
saas-hybrid-agent/
  pom.xml                 # 去掉 core 子模块；artifactId saas-hybrid-agent
  server/                 # 仅控制面（包 com.github.saashybridagent）
  client-agent/
  docs/
  README.md
```

**保留并改造：**

- `controlplane/**` 全套 + `ControlPlaneApiTest`
- `HealthController`、`ErrorResponse`
- 设备鉴权版 `BearerTokenFilter` / `SecurityConfig`
- 控制面向 `SaasHybridAgentProperties`
- **去掉** `server` 对 `core` 的 Maven 依赖

**删除：**

- `core/` 模块
- session API 与 Agent 装配类
- 依赖 `AgentRuntime` / `SessionStore` 的测试与配置

## 4. 数据流

```text
[Web/客户端] --client-agent--> ConversationLoop / Tools / Memory (端上)
        | LLM SSE / embeddings / sync / quota
        v
[saas-hybrid-agent server]  Control Plane only

[运维/自托管] --HTTP /v1/sessions--> [java-agent-runtime]
        AgentRuntime + Tools + SQLite (服务端)
```

## 5. 错误与配置

| 仓 | 鉴权 | 失败行为 |
|----|------|----------|
| saas-hybrid-agent | 设备 Bearer（注册/吊销） | 控制面 401/429/配额错误保持现有映射 |
| java-agent-runtime | 可选 `JAVA_AGENT_TOKEN` | session 409 busy / 4xx/5xx 保持现有行为 |

本仓可删除或忽略 `disable-server-terminal`（不再装配服务端 terminal 工具）。新仓默认启用服务端工具（含 terminal），行为对齐迁出前私有 Runtime。

## 6. 执行顺序

1. **先建新仓**：在 `/Users/liubing/work/java-agent-runtime` 用当前 `core` + Runtime `server` 切片搭好可编译工程（复制，本仓暂不删）。
2. **新仓修通**：去掉控制面依赖；精简鉴权/配置；`./mvnw test` + session smoke 通过。
3. **再削本仓**：删除 `core` 与 session 路径；`server` 去 `core` 依赖；控制面测试通过；`client-agent` 测试照旧。
4. **文档对齐**：本仓 README 定位 SaaS Hybrid；新仓 README 定位私有服务端 Runtime；互相链接路径；注明多租户/计费为后置。

## 7. 测试与验收

### 7.1 测试策略

- **新仓**：迁入现有 `core` 测试 + `SessionControllerTest`；鉴权测试改为仅可选 API token。
- **本仓**：保留 `ControlPlaneApiTest`；删除 session 相关测试；鉴权测试只覆盖设备 token 路径。

### 7.2 验收标准

- **新仓**：`./mvnw test` 绿；能 `spring-boot:run`；smoke 覆盖创建 session + 发消息（有 API key 时尽量走工具链，无 key 时至少 API 可达）。
- **本仓**：`./mvnw -pl server -am test` 绿（含 `ControlPlaneApiTest`）；`client-agent` 单测绿；**不再**暴露 `/v1/sessions/**`；父 POM 无 `core` 模块。
- **文档**：两边 README 各自说清职责，并互相链接。

## 8. 选定方案

**方案 1：一次切干净 + 新仓可独立跑通**（已确认）。

不采用「先双份长期并存」或「本仓保留 core 作共享 jar」——避免本仓继续背负服务端 Runtime 职责。
