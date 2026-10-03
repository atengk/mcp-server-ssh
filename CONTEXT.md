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
