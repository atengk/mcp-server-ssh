# 0001. 基于无侵入标准 OpenSSH 协议直连

## 背景与决策 (Context & Decision)

在设计连接远程 Linux 系统的 MCP 服务时，我们需要在“目标机部署私有 Agent/Daemon（如 HTTP/gRPC 服务）”与“基于标准 OpenSSH 协议无侵入直连”之间做出权衡。我们决定完全基于标准 OpenSSH 协议进行通信与控制，不要求在目标 Linux 上安装任何专有软件。

## 权衡考量 (Considered Options)

- **选项 1：目标机驻留 Daemon / Agent**。优点是可以在远程机器上深度集成专用监控指标，缺点是部署侵入性高、权限敏感、且在受限环境或临时容器中难以推广。
- **选项 2：标准 OpenSSH 直连（已采纳）**。绝大多数 Linux 发行版与云服务器均默认预装 OpenSSH Server，结合现有的账密、SSH-Agent 与跳板机即可实现即插即用，普适性最强，零维护负担。

## 后果与影响 (Consequences)

- 优势：接入成本极低，天然兼容 Linux 既有的公私钥认证、sudo 机制与跳板机网络。
- 代价：所有文件管理必须基于 SFTP 协议实现，命令输出与会话状态需由 MCP 服务端在客户端侧进行解析和维护。
