# SSH MCP 领域模型与统一语言 (SSH MCP Context)

本领域上下文定义了通过 Model Context Protocol (MCP) 建立与操控远程 Linux/Unix 系统的核心概念与通用语言，旨在确保所有设计、代码符号与 Agent 交互使用一致的术语。

## 统一领域语言 (Language)

### 连接与会话 (Connections & Sessions)

**Connection (连接)**:
MCP 服务端与目标 Linux/Unix 主机之间已建立并完成身份鉴权的单个持久 SSH 客户端网络链路。
_Avoid_: Session (会话), Socket (套接字), Tunnel (隧道)

**Default Connection (默认连接)**:
当前被指定为活跃接收通道的 Connection；当调用命令或文件工具未显式指定目标标识时，所有操作均自动路由至此连接。
_Avoid_: Primary Connection (主连接), Global Connection (全局连接)

**Session (交互终端会话)**:
在某个特定 Connection 内部启动的常驻交互式伪终端（PTY）Shell 进程，支持跨多次输入维持工作目录、环境变量及命令连续性。
_Avoid_: Connection (连接), Channel (通道), Terminal Window (终端窗口)

**Channel (通道)**:
在单个 SSH Connection 内部多路复用划分的独立逻辑数据流，分别专用于单次 Exec 执行、SFTP 子系统或 PTY 终端。
_Avoid_: Thread (线程), Process (进程), Pipe (管道)

**Jump Host (跳板机 / 堡垒机)**:
处于网络边界、用于建立中继隧道以代理转发访问内网目标主机的中间 SSH 服务器（ProxyJump）。
_Avoid_: Gateway (网关), Proxy (通用代理), Router (路由器)

### 命令与安全防护 (Execution & Safety)

**Safety Guard (安全拦截引擎)**:
在命令下发至远程系统前执行前置模式匹配与语义校验的防御组件，用于拦截可能导致系统毁灭的高危操作。
_Avoid_: Firewall (防火墙), Sanitizer (净化器), Validator (通用校验器)

**Output Truncator (输出截断器)**:
负责监控与限制命令执行返回体积的下游流处理器，在输出超出 Token 安全阈值时智能保留头尾关键上下文并注入元数据说明。
_Avoid_: Logger (日志记录器), Formatter (格式化器), Filter (过滤器)

**Login Shell Wrapper (登录 Shell 包装器)**:
为避免非登录非交互式环境缺失 PATH 与环境变量，自动将待执行命令封装在登录环境（`bash -l -c`）中执行的机制。
_Avoid_: Shell Script (Shell 脚本), Subshell (子 Shell)

### 文件系统 (Filesystem)

**Remote Path (远程路径)**:
目标 Linux 系统文件系统上的绝对路径，统一采用标准 POSIX 正斜杠规范（如 `/var/log`）。
_Avoid_: File Path (模糊的文件路径), Windows Path (Windows 反斜杠路径), URI

**SFTP Subsystem (SFTP 子系统)**:
运行于 SSH 协议通道内部的标准安全文件传输子协议服务，负责提供原子化的 POSIX 文件读写、属性查询与目录遍历能力。
_Avoid_: FTP (普通文件传输协议), SCP (已废弃的安全复制协议), WebDAV

### 分发与生态接入 (Distribution & Ecosystem)

**Scoped Package (作用域包)**:
专指在 NPM 官方公共注册表下以 `@atengk/` 命名空间为前缀的唯一发布包名（`@atengk/mcp-server-ssh`），确立组织唯一所有权并防范供应链混淆。
_Avoid_: Global Unscoped Package (无作用域全局包), Bare Package

**NPM Registry (分发注册表)**:
全球 Node.js 官方公共软件包索引与存储服务，允许任何 AI 客户端通过 `npx` 零依赖即开即用拉取 MCP 独立 Bundle。
_Avoid_: Private Mirror (私有镜像), Code Repository (代码仓库)

**MCP Catalog (生态目录 / 市场)**:
官方及开源社区设立的公开索引清单与插件发现平台（如 PulseMCP、Glama、Awesome MCP Servers 及官方 Servers 目录），用于使全球开发者在 AI 工具箱中一键发现与安装。
_Avoid_: App Store (移动应用商店), Extension Marketplace (扩展市场)

**Distribution Matrix (分发矩阵)**:
由 NPM 独立二进制包、GitHub Releases 语义化版本源码与各大 MCP Catalog 索引收录构成的三位一体立体分发触达网络。
_Avoid_: Single Channel (单一渠道)

### 传输协议与云原生部署 (Transport & Containerization)

**Transport Mode (传输模式)**:
MCP 服务端与 AI 客户端之间进行 JSON-RPC 消息交换的底层通信协议承载形态。本项目支持进程间标准输入输出管道 (`stdio`) 与网络长轮询事件流 (`sse`) 两种模式。
_Avoid_: Protocol (协议混称), Communication Method (通信方式)

**SSE Endpoint (SSE 网络端点)**:
在 `sse` 传输模式下，轻量 HTTP 服务对外暴露的标准接口，专指用于建立长轮询事件流的 `/sse` 路由与用于接收客户端 JSON-RPC 消息的 `/message` 路由。
_Avoid_: HTTP API, Webhook, REST Route

**Canonical Environment Variable (标准规范环境变量)**:
遵循 12-Factor App 体系、以 `MCP_SSH_*` 为唯一官方命名空间的一等公民环境变量，具备最高解析优先级与强类型校验约束。
_Avoid_: Raw Env, Config Key, Config Flag

**Pre-connection (预连接)**:
在 MCP 服务初始化启动阶段，依据规范环境变量（`MCP_SSH_*`）自动建立并指定为默认活跃通道的 SSH 物理连接机制。
_Avoid_: Auto Connect (模糊的自动建连), Static Connection (静态连接)

**Structured ProxyJump (结构化跳板机配置)**:
将跳板机主机名、端口与专用鉴权凭据（独立用户、密码或私钥）封装为强类型对象的跳板机配置模式，以区别于非结构化的单行连接字符串。
_Avoid_: Proxy String, Raw Proxy

**Health Probe (健康检查探针)**:
在 `sse` 传输模式下由 HTTP 服务在 `/health` 暴露的轻量无状态检测端点，供 Docker、K8s 或负载均衡器探测服务就绪（Readiness）与存活（Liveness）状态。
_Avoid_: Ping, Heartbeat Endpoint, Status Page

### 开源工程与持续集成规范 (Open Source Engineering & CI/CD)

**Semantic PR Title (语义化 PR 标题)**:
在 GitHub Pull Request 提交时强制遵循 Conventional Commits 规范的标题格式（`<type>(<scope>): <subject>`），用于自动化流水线提取版本更新日志并保障代码审查意图清晰。
_Avoid_: Loose PR Title (松散 PR 标题), Freeform PR Name

**GitHub Container Registry (GHCR 容器镜像源)**:
由 GitHub 官方托管的高性能 OCI 兼容容器镜像注册表（`ghcr.io`），用于自动分发多架构 Docker 镜像，具备与 GitHub 仓库权限原生集成与无缝免密拉取特性。
_Avoid_: Private Mirror (私有镜像), Generic Hub

**Conventional Changelog Engine (规范化变更日志引擎)**:
基于标准化提交历史与语义化标签自动抓取、过滤并分类生成发布说明的工具或规则体系（如 git-cliff 与 GitHub Actions 发布工作流）。
_Avoid_: Manual Changelog (纯手写日志), Random Commit Log

**Pre-built Container Image (预构建容器镜像)**:
由 GitHub Actions CI/CD 流水线在发版时自动编译、测试并推送至 GHCR 的开箱即用多架构 OCI 镜像制品，终端用户无需克隆本地源码及安装编译工具链即可单文件直接拉起。
_Avoid_: Source Build (本地源码构建), Dynamic Image

**Container Tag Hierarchy (容器镜像标签分层体系)**:
指 GHCR 多架构镜像在语义化发布时，自动维护的 `{{major}}` (如 `1`)、`{{major}}.{{minor}}` (如 `1.2`)、`{{version}}` (如 `1.2.4`) 与 `latest` 四级递进浮动指针架构，支持用户按需锁定不同粒度的兼容性与补丁级别。
_Avoid_: Flat Tagging (扁平无分级标签), Static Tag (固定单标签)

**Registry Hygiene (制品纯净性治理)**:
在容器镜像构建中显式禁用 SLSA Provenance 与 SBOM Attestation 附属层（`provenance: false` 与 `sbom: false`），消除 GHCR 列表中的 `unknown/unknown` 幽灵架构层并保障边缘节点与各类 Docker 引擎极致兼容性的工程策略。
_Avoid_: Phantom Arch (幽灵架构), Attestation Pollution (凭证层污染)


