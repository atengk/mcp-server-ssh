# 0005. 规范化环境变量与双传输常驻容器部署

## 背景与决策 (Context & Decision)

随着服务从本地个人终端向云原生容器化、局域网私有化、NAS（群晖/威联通）常驻服务及团队多端共享演进，原有的单机进程内 `stdio` 架构与零散环境变量暴露了若干局限：
1. 环境变量未隔离命名空间，易与系统原生 SSH 变量冲突；
2. 私钥仅支持物理路径，在容器化或无状态环境中必须进行卷挂载，无法直接通过环境变量或 Secret 注入；
3. 通信协议仅支持 `stdio`，无法通过局域网或云端 HTTP 端点远程接入。

为对标现代化 12-Factor App 架构，我们决定采纳以下核心设计决策：
1. **12-Factor App 环境变量规范矩阵**：
   - 官方主命名空间升级为 `MCP_SSH_*`，统一集中在 `src/config/env.ts` 进行强类型校验与格式诊断；
   - 保持对遗留 `SSH_*` 变量的无缝向下兼容，保障老用户无感平滑升级；
   - 实施全链路凭据掩码脱敏（`***`），杜绝密码与私钥在日志或错误堆栈中明文泄露。
2. **多形态私钥凭证注入**：
   - 支持文件路径（`MCP_SSH_KEY_PATH`）、原始 PEM 文本自动换行还原（`MCP_SSH_PRIVATE_KEY`）与 Base64 编码字符串自动解码（`MCP_SSH_PRIVATE_KEY_BASE64`），彻底实现容器化零磁盘卷挂载启动。
3. **双通信传输引擎 (Stdio + SSE)**：
   - 通过 `MCP_SSH_TRANSPORT` 环境变量在 `stdio` 与 `sse` 之间自由切换；
   - 本地桌面客户端维持默认零开销的 `stdio` 模式；
   - 容器常驻环境采用 `sse` 模式，基于 Node.js 原生 `http` 启动轻量服务，暴露 `/sse`（事件流建立）与 `/message`（JSON-RPC 交互）端点，支持 CORS 与优雅停机。
4. **多阶段轻量 Dockerfile 与单文件预构建编排**：
   - 采用多阶段构建（构建阶段使用 `--platform=$BUILDPLATFORM` 加速），基于 `node:20-alpine`，运行于非 root 用户 `node`，最小化镜像攻击面；
   - 根目录 `docker-compose.yaml` 默认直接消费云端 GHCR 预构建镜像（`ghcr.io/atengk/mcp-server-ssh:${MCP_SSH_IMAGE_TAG:-latest}`），彻底与本地源码及编译环境解耦，支持终端用户零源码、单文件秒级一键拉起与平滑升级。
5. **基于会话工厂的多客户端并发隔离 (Server Factory Pattern)**：
   - 针对 `@modelcontextprotocol/sdk` 的 Server 实例强绑定单 Transport 的底层限制，在 SSE 服务层引入 `serverFactory` 工厂模式，在每个 HTTP 客户端接入握手时动态生成独立的 McpServer 实例，底层共享 `ConnectionPool` 物理连接池，实现多客户端并发接入且会话生命周期互不干扰。

## 权衡考量 (Considered Options)

- **传输协议扩展选型**：
  - 引入重量级 Web 框架（Express / NestJS / Fastify）：会增加数倍依赖体积与冷启动时间；
  - Node 原生 HTTP 配合 MCP SDK 原生 `SSEServerTransport`（已采纳）：单文件 bundle 零外部 HTTP 依赖，打包体积仅增加数 KB，极致轻量且高度可控。
- **多客户端并发与实例复用**：
  - 单一静态 Server 实例复用：尝试将多个 SSE 客户端绑定至同一 `Server`，底层会直接抛出 `Already connected` 致命异常；
  - 工厂模式隔离 Server + 共享底层连接池（已采纳）：为每个入站 SSE 请求动态创建轻量 McpServer 包装层，共享底层的 `ConnectionPool` 物理连接，既遵守 MCP SDK 的单传输约束，又实现了高效的多客户端连接复用与会话安全独立销毁。
- **私钥传递形态**：
  - 仅支持宿主机目录挂载：对于 Kubernetes Secret、Docker 环境变量或 CI/CD 流水线非常繁琐；
  - 支持 PEM 文本与 Base64 自动解码（已采纳）：Base64 完美解决多行私钥在环境变量中的换行转义痛点，使用体验最佳。

## 后果与影响 (Consequences)

- 优势：
  - 实现了本地与远程全场景覆盖，客户端不仅可通过本地命令拉起，亦可通过网络 URL 远程接入；
  - 环境变量命名专业、规范，具备强类型自愈与错误诊断能力；
  - 容器化部署真正做到 100% 环境变量无参自启，无需强制挂载本地私钥卷。
- 代价：
  - 引入了 HTTP 监听网络端口（默认 8000），需要关注内网防火墙开放与 CORS 安全配置；
  - 需同时维护两套通信传输链路的自动化测试套件。
