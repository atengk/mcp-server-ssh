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
遵循 12-Factor App 体系、以 `MCP_SSH_*` 为唯一官方命名空间的一等公民环境变量，彻底剔除历史别名与模糊降级，具备排他性解析权与强类型校验约束。
_Avoid_: Raw Env, Config Key, Config Flag, Legacy Alias (废弃别名)

**Strict Configuration Guard (严格配置守卫)**:
对输入环境变量实施严格字面量判定与单命名空间收敛的校验中枢，彻底禁止宽松类型推断（如将 `"yes"`/`"1"` 自动转为布尔），对非标输入实施立即熔断，并对非 `MCP_SSH_*` 外部变量执行静默忽略。
_Avoid_: Loose Converter (宽松转换器), Permissive Parser (宽容解析器), Fuzzy Config (模糊配置)

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

### 高级网络与杀手级扩展 (Advanced Networking & Killer Capabilities)

**Target Discovery (统一目标发现)**:
将已建立活跃连接列表与本机 `~/.ssh/config` 静态预设主机别名聚合输出为统一目标视图的元数据发现机制。
_Avoid_: Host Scanner (主机扫描器), Endpoint Enum

**Streaming Tar Transfer (流式 Tar 打包传输)**:
利用纯 JavaScript 内存流结合远程 Linux `tar` 管道实现目录树级双向高速批量归档传输的机制，彻底规避逐文件 SFTP 往返延迟。
_Avoid_: File-by-file Copy (逐文件拷贝), SCP Recursive

**SSH Tunnel (SSH 端口转发隧道)**:
基于 SSH 协议直接建立的物理链路多路复用隧道，将宿主机本地端口通过目标主机转发至远程隔离内网端口（Local Forwarding）的机制。
_Avoid_: VPN (虚拟专用网), Port Mapping (端口映射)

**System Diagnostic Probe (系统巡检探针)**:
通过无侵入式只读探针一次性采集目标 Linux 主机硬件架构、内核、负载、内存、磁盘与关键监听状态的轻量结构化体检服务。
_Avoid_: Agent Daemon (专有监控守护进程), Telemetry SDK

**Remote File Patching (远程差异补丁)**:
基于文本块锚点匹配或统一 Diff 算法对远程大文本文件实施局部原子化更新的机制，避免全量文件反复覆写传输。
_Avoid_: Full File Overwrite (全量文件覆写), Blind In-place Edit

**Expect Pattern (提示符模式探测)**:
在交互式 PTY 终端会话流中通过正则模式主动检测 Shell 提示符或预期输出以实现即刻响应的事件驱动等待机制。
_Avoid_: Fixed Sleep (固定硬等休眠), Busy Wait (忙轮询等待)

**Detached Background Job (脱机后台作业)**:
在远程 Linux 主机通过用户态解耦目录与后台进程守护运行的长耗时命令执行机制，支持客户端异步轮询进程状态、增量获取日志及精确捕获最终退出码。
_Avoid_: Foreground Process (前台阻塞进程), Daemon Thread (守护线程)

**Exclude Filter (传输排除过滤)**:
在双向流式目录归档传输过程中，依据 Glob 通配符模式或项目级 `.gitignore` 规则动态拦截并剔除冗余依赖与二进制文件的机制。
_Avoid_: Blacklist (非标准黑名单), Silent Skip

**Privilege Escalation (非交互特权提权 / Sudo)**:
在无 TTY 分配的无状态执行环境中，通过专有密码流管道（`sudo -S`）将受管凭据无回显下发至安全进程的特权命令提升机制。
_Avoid_: Root Login (直接以 Root 建连), Insecure Command Piping (明文命令管道)

**Dynamic SOCKS5 Proxy (动态 SOCKS5 代理)**:
在本地监听标准 SOCKS5 协议端口，将客户端所有动态 TCP/IP 连接基于 SSH 底层物理连接实施多路复用隧道转发至远程网络边界的动态穿透机制。
_Avoid_: Fixed Forwarding (固定单端口转发), HTTP Tunnel (纯 HTTP 隧道)

**CLI Diagnostic Probe (CLI 诊断探针)**:
在命令行执行阶段用于快速自省 Node.js 运行时、操作系统兼容性、本地 OpenSSH 密钥链与 SSH Agent 存活性的一组无状态轻量探针。
_Avoid_: Telemetry (遥测), Benchmark (性能基准测试)

**Self-Inspection Doctor (自检诊断器)**:
由 `--doctor` 标志触发的四维全景自检套件，串联运行环境、本地密钥、环境变量合规性与远程目标连通性测试，并输出结构化 PASS/WARN/FAIL 诊断报告与修复指引。
_Avoid_: Health Check Endpoint (仅指 HTTP /health 探针), Debug Mode (调试模式)

### 安全合规与审计跟踪 (Safety, Audit & Compliance)

**Audit Trail (审计轨迹)**:
按时间序列严格递增、完整记录 AI Agent 或宿主客户端发起之所有远程运维操作全生命周期的结构化不可变证据链。
_Avoid_: System Log (系统常规日志), Debug Trace (调试追踪), Console Print

**Audit Sink (审计汇聚端)**:
负责对审计事件实施结构化序列化、文件尺寸滚动切割或标准流重定向的可插拔持久化中枢。
_Avoid_: Logger Adapter, Output Stream (裸输出流), Collector Service

**Audit Event (审计事件)**:
包含事件唯一全局 ID、精确 ISO 时间戳、目标连接元数据、操作分类、安全脱敏入参、执行耗时及合规结果的原子不可变数据载荷。
_Avoid_: Log Entry (普通日志条目), Log Line, Message Packet

**Credential Sanitizer (凭据脱敏引擎)**:
在审计事件持久化前深度遍历参数树并利用模式匹配强力遮蔽密码、私钥、Token 与内联命令凭据的安全防护管道。
_Avoid_: Filter (模糊过滤器), Masker, Stripper

### 服务标识与多实例编排 (Server Identity & Multi-Instance)

**Server Identity (服务身份标识)**:
在同一 AI 客户端挂载多个 MCP SSH 服务实例时，通过命令行标志（`--server-name`）或规范环境变量（`MCP_SSH_SERVER_NAME`）显式赋予单个服务进程的唯一命名空间与辨识名。
_Avoid_: Instance ID, Process Name, Tag

**Server Instructions (服务引导指示)**:
在 MCP 握手协商阶段直接注入至协议根级 `instructions` 字段、用于指导大模型精准领会当前服务角色定位与操作边界的自然语言上下文。
_Avoid_: System Prompt (模型底层系统提示词), Guide Text, README

**Tool Description Decoration (工具描述修饰)**:
当配置自定义服务身份标识时，在所有对外暴露的工具描述前透明追加 `[<serverName>] ` 紧凑前缀的轻量渲染机制，防止多服务并存时大模型混淆工具归属。
_Avoid_: Tool Renaming (重命名工具名), Tool Alias

