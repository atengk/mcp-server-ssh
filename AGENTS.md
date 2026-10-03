# Agent 行为准则与项目工程规范 (mcp-server-ssh)

本项目为通过 OpenSSH 协议深度连接并操控 Linux/Unix 系统的 Model Context Protocol (MCP) 服务。所有在此仓库工作的 Agent 必须严格遵守以下工程规范与架构准则。

## 1. 核心架构与设计准则 (Architecture & Principles)

- **无侵入 OpenSSH 直连**：基于标准 OpenSSH 协议直连目标主机，无需安装专有 Agent 或守护进程。决策背景与考量见 [ADR-0001](docs/adr/0001-direct-openssh-protocol.md)。
- **双模命令执行引擎**：
  - 默认采用无状态独立执行（`ssh_exec`），自动使用登录 Shell（`bash -l -c`）包装以继承环境完整 `PATH`，精准捕获命令退出码；
  - 针对需持续交互或接收控制信号（如 Ctrl+C）场景，提供持久 PTY 终端（`ssh_session_*`）。决策背景与考量见 [ADR-0002](docs/adr/0002-dual-execution-modes.md)。
- **安全拦截与防爆双保险**：
  - **前置安全守卫 (`SafetyGuard`)**：命令下发前实施模式匹配，强力阻断全盘强删、块设备覆写、关机重启等致命操作，支持 `dry_run` 与外部自定义规则；
  - **输出截断与净化 (`OutputTruncator`)**：单次命令输出限制 64KB，保留前 8KB 标头与后 56KB 最新日志，并自动剥离 ANSI 彩色控制符。决策背景与考量见 [ADR-0003](docs/adr/0003-safety-guard-and-output-truncation.md)。
- **POSIX SFTP 规范与防环**：远程路径一律强制转译为 POSIX 正斜杠（`/`）；SFTP 递归操作默认开启深度限制与软链接防环保护。

## 2. 统一领域术语约束 (Ubiquitous Language)

严格遵守 [CONTEXT.md](CONTEXT.md) 锁定的通用领域语言，严禁使用禁用同义词：
- **Connection (连接)**：指代已建立并鉴权的单个 SSH 物理网络链路（严禁混称为 Session 或 Socket）；
- **Default Connection (默认连接)**：未显式传入连接标识时自动路由的活跃连接；
- **Session (交互终端会话)**：专指持久常驻的 PTY 伪终端进程（严禁与物理 Connection 混淆）；
- **Channel (通道)**：指 Connection 内部多路复用划分的 Exec、SFTP 或 PTY 子数据流；
- **Jump Host (跳板机)**：专指中继代理访问内网的堡垒机（ProxyJump）。

## 3. 技术栈与模块架构 (Tech Stack & Modules)

- **基础依赖栈**：Node.js (>= 18) + TypeScript 5.x + `@modelcontextprotocol/sdk` + `ssh2` + `zod`。
- **打包与分发**：使用 `tsup` 打包输出单文件独立执行 Bundle，配置 CLI `bin` 入口与 `stdio` 协议传输。
- **模块解耦职责划分**：
  - `src/index.ts`：装配入口（Coordinator），负责服务启动、工具注册、`stdio` 通信监听与环境变量预建连；
  - `src/connection/`：连接池管理器（KeepAlive 心跳保活、ProxyJump 隧道中继、凭证探测与多主机路由）；
  - `src/services/`：核心能力实现（无状态命令执行、PTY 会话流、SFTP POSIX 文件操作）；
  - `src/security/`：前置安全拦截守卫与输出智能截断器；
  - `src/types/`：统一的数据模型契约与 Zod 校验 Schema。

## 4. Agent 技能配置 (Agent skills)

### 问题跟踪器 (Issue tracker)

本项目所有需求、缺陷与任务卡片均基于 GitHub Issues 进行全流程跟踪与管理。详见 `docs/agents/issue-tracker.md`。

### 分流标签 (Triage labels)

采用标准五位分流标签规范（needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix）。详见 `docs/agents/triage-labels.md`。

### 领域架构文档 (Domain docs)

采用单上下文规范（Single-context 架构：根目录 `CONTEXT.md` 与 `docs/adr/` 架构决策记录）。详见 `docs/agents/domain.md`。
