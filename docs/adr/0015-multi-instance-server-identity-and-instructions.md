# 0015. 多实例服务身份标识与引导指示架构

## 背景与决策 (Context & Decision)

在企业级或复杂运维场景中，开发者常在同一个 AI 客户端宿主（如 Claude Desktop、Cursor、Cline 等）中同时配置挂载多个 `mcp-server-ssh` 实例，分别用于连接不同网络分区或安全域的主机（如开发测试机、核心生产堡垒机、GPU 算力集群）。由于所有实例默认暴露完全相同的 29 个 MCP 工具名称（如 `ssh_exec`, `ssh_session_start` 等），大模型在生成工具调用时缺乏全局区分依据，极易出现指令路由混淆甚至向生产环境误发破坏性命令的重大隐患。

为此，我们做出如下架构决策：**构建轻量非侵入的多实例服务身份标识与引导指示体系 (Server Identity & Instructions)**：
1. **双通道配置接入 (CLI Flags + Canonical Env)**：
   - **CLI 命令行长标志**：支持 `--server-name <name>` 与 `--server-instructions <text>`（通过 Node 18 原生 `node:util` `parseArgs` 解析）；
   - **规范环境变量 (ADR-0012 对齐)**：支持 `MCP_SSH_SERVER_NAME` 与 `MCP_SSH_SERVER_INSTRUCTIONS`；
   - **优先级裁决**：CLI 命令行参数 > 规范环境变量 > 系统默认值（`name` 缺省为 `"mcp-server-ssh"`，`instructions` 缺省为 `undefined`）。
2. **协议级一等公民下发 (Protocol Native Handshake)**：
   - 将解析后的 `serverName` 直接赋予 `McpServer({ name: serverName, version: SERVICE_VERSION })`，在客户端发起 `initialize` 握手时明确向宿主声明服务唯一身份；
   - 将 `serverInstructions` 注入至 MCP 协议标准能力字段 `instructions`，由宿主客户端在初始化阶段直接作为系统引导上下文注入大模型。
3. **工具描述智能紧凑修饰 (Tool Description Decoration)**：
   - 为防御部分 AI 客户端未能向大模型有效透传根级 `instructions`，当且仅当配置了自定义 `serverName`（且不等于默认值 `"mcp-server-ssh"`）时，所有 29 个 MCP 工具对外声明的 `description` 统一追加紧凑前缀 `[${serverName}] `（例如 `[生产跳板机] 执行无状态远程 Bash 命令...`）；
   - 若未配置自定义名称，工具描述保持纯净原始文本，绝无冗余修饰。
4. **极简纯粹定位 (Zero Side-Effects)**：
   - 严格恪守“只做标识无其他功能”的原则，绝不篡改底层物理执行、连接池逻辑或工具输入 Schema；
   - 未显式指定 `instructions` 时保持纯粹空值，不擅自推测或注入冗余文本，保持模型上下文干净。

## 权衡考量 (Considered Options)

- **关于大模型辨识途径选型**：
  - 选项 1：工具名称重命名（例如将 `ssh_exec` 动态改为 `prod_ssh_exec`）。破坏了工具 Schema 的跨环境稳定性和通用提示词模板，造成各环境生态分裂。
  - 选项 2：双层下发：协议级 `serverInfo` / `instructions` + 工具描述修饰（已采纳）。既符合 MCP 官方标准规范，又通过工具描述前缀解决了弱客户端的兼容性死角。
- **关于默认指引是否自动推导**：
  - 选项 1：根据配置的 `MCP_SSH_HOST` 自动生成提示。可能会泄露内部网络拓扑或与用户真正想给大模型的提示词冲突。
  - 选项 2：纯字面量无推导（已采纳）。严格以用户显式指令为准，控制权 100% 移交用户。

## 后果与影响 (Consequences)

- 优势：
  - 大模型在面对多个 SSH MCP 服务时，能精准通过服务名与工具描述前缀选定正确的实例；
  - 完美契合 Claude Desktop / Cursor 的配置习惯，既支持在 `args: ["--server-name", "..."]` 中传参，也支持在 `env: {}` 中定义；
  - 零外部依赖，对已有工具逻辑与单测完全向后兼容。
- 代价：
  - 需要在 `src/cli/args.ts`、`src/config/env.ts` 与 `src/index.ts` 中轻量串联参数分流。
