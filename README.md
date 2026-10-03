# @atengk/mcp-server-ssh

[![NPM Version](https://img.shields.io/npm/v/@atengk/mcp-server-ssh.svg?style=flat-square)](https://www.npmjs.com/package/@atengk/mcp-server-ssh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-1.x-orange.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-81%2F81%20passing-brightgreen.svg?style=flat-square)](./src)

基于标准 **OpenSSH 协议** 深度连接与操控 Linux/Unix 系统的 **Model Context Protocol (MCP)** 服务。为大语言模型（LLM）和 AI 智能体（Claude Desktop、Cursor、Antigravity、Cline 等）提供安全、可控、零侵入的远程终端执行与 POSIX 文件系统管理基础设施。

---

## 🌟 核心特性 (Features)

- **🌐 零侵入标准协议直连**：目标 Linux 主机仅需原生 OpenSSH 服务，绝不安装任何专有 Agent 或 HTTP 守护进程（[ADR-0001](docs/adr/0001-direct-openssh-protocol.md)）。
- **⚡ 双模命令执行引擎**（[ADR-0002](docs/adr/0002-dual-execution-modes.md)）：
  - **无状态执行 (`ssh_exec`)**：单命令独立通道，默认包装为登录 Shell（`bash -l -c`）以完整继承用户环境变量与 `PATH`，精确捕获退出码、耗时与标准输出/错误。
  - **交互式会话 (`ssh_session_*`)**：基于 PTY 伪终端维持常驻会话流，支持流式增量回显与 `\x03` (Ctrl+C) 中断控制信号。
- **📁 全功能 POSIX SFTP 管理**：文本安全读写（内置 512KB 防撑爆阈值）、双向文件极速上传与下载、目录树浏览、POSIX 元数据获取、目录递归建删与软链接防环保护（`maxDepth: 10`）。
- **🔑 工业级凭证链与企业网络**：完整支持本地公私钥（`id_ed25519` / `id_rsa`）、SSH-Agent 探测、密码认证、`~/.ssh/config` 配置继承以及企业级 `ProxyJump` 堡垒机/跳板机隧道。
- **🛡️ 严格安全防护双保险**（[ADR-0003](docs/adr/0003-safety-guard-and-output-truncation.md)）：
  - **前置安全守卫 (`SafetyGuard`)**：实时拦截全盘强删（`rm -rf /`）、磁盘覆写（`dd`/`mkfs`）、关机重启（`reboot`/`shutdown`）及 Fork 炸弹等致命破坏，支持 `dryRun` 演练。
  - **智能防爆截断 (`OutputTruncator`)**：单次输出实施 64KB 双端智能截断（保留前 8KB 标头与后 56KB 最新日志），自动清洗 ANSI 终端转义符，保护 LLM 上下文不崩溃。
- **📦 免安装一键即用**：打包为独立单文件 Bundle，全球用户通过 `npx` 零依赖即开即用（[ADR-0004](docs/adr/0004-distribution-and-registry-strategy.md)）。

---

## 🚀 快速上手 (Quick Start)

无需 git clone 或本地编译，在任何支持 MCP 的宿主客户端配置文件（如 Claude Desktop 的 `claude_desktop_config.json`、Cursor 的 `mcp.json` 或 Antigravity / Cline 对应配置）中添加如下配置即可直接启动：

### 通用 MCP 客户端基础配置模板

```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@atengk/mcp-server-ssh"],
      "env": {
        "SSH_HOST": "192.168.1.100",
        "SSH_PORT": "22",
        "SSH_USER": "root",
        "SSH_KEY_PATH": "/Users/yourname/.ssh/id_ed25519"
      }
    }
  }
}
```

---

## ⚙️ 5 大连接场景配置矩阵 (Scenarios)

针对不同网络拓扑与鉴权需求，提供开箱即用的配置范例：

### 场景 1：密码账密直连 (最简临时测试)
```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@atengk/mcp-server-ssh"],
      "env": {
        "SSH_HOST": "192.168.1.100",
        "SSH_PORT": "22",
        "SSH_USER": "root",
        "SSH_PASSWORD": "your_secure_password"
      }
    }
  }
}
```

### 场景 2：公私钥免密直连 (生产环境规范推荐)
```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@atengk/mcp-server-ssh"],
      "env": {
        "SSH_HOST": "192.168.1.100",
        "SSH_PORT": "22",
        "SSH_USER": "root",
        "SSH_KEY_PATH": "D:/files/server/id_ed25519",
        "SSH_KEY_PASSPHRASE": "optional_passphrase"
      }
    }
  }
}
```
> 💡 **Windows 提示**：本地路径强烈推荐统一使用正斜杠（如 `"D:/files/server/id_ed25519"`），Node.js 原生完美支持，且能彻底避免 JSON 反斜杠转义（`\\`）遗漏导致的解析崩溃。

### 场景 3：直接复用本地 `~/.ssh/config` 别名 (最推荐，省心免配)
直接继承本机既有的公私钥路径、跳板机、自定义端口与 Host 别名：
```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@atengk/mcp-server-ssh"],
      "env": {
        "SSH_CONFIG_ALIAS": "my-cloud-vps"
      }
    }
  }
}
```

### 场景 4：企业级 ProxyJump 堡垒机/跳板机隧道
通过公网跳板机（Bastion）安全穿透至隔离内网中的私有目标服务器：
```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@atengk/mcp-server-ssh"],
      "env": {
        "SSH_HOST": "10.0.1.50",
        "SSH_PORT": "22",
        "SSH_USER": "deploy",
        "SSH_PROXY_JUMP": "bastion_user@bastion.company.com:2222"
      }
    }
  }
}
```

### 场景 5：纯空载启动 (在会话中动态管理多主机)
启动时不配置任何环境变量，后续在对话中直接通过自然语言指示 AI 连接或切换不同的主机：
```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@atengk/mcp-server-ssh"]
    }
  }
}
```

---

## 🌐 多服务器连接与集群管理 (Multi-Host Architecture)

`@atengk/mcp-server-ssh` 内置企业级连接池管理器（`ConnectionPool`），原生支持在单个服务内同时维持与调度多台 Linux 主机。根据您的使用习惯，提供三种灵活的架构模式：

### 模式一：单 MCP 实例内的【动态连接池路由】（最灵活、推荐）

只需启动一个通用的 MCP 服务（如上述“场景 5”的空载配置），AI 即可在自然语言对话中随时建立、切换并并发调度多台主机：

#### 跨主机协同调度机制
所有命令与文件工具（`ssh_exec`、`sftp_*` 等）均包含可选参数 `connectionId`：
- **建立连接**：调用 `ssh_connect` 时指定 `connectionId: "prod"` 或 `connectionId: "test"`；
- **定向下发**：传入 `connectionId` 时，请求将精准路由至对应主机的物理通道；未传入时自动路由至当前的默认连接（`Default Connection`）；
- **跨机数据同步**：AI 可在一个任务链中从主机 A 下载文件（`sftp_download(..., connectionId: "test")`），紧接着直接上传至主机 B（`sftp_upload(..., connectionId: "prod")`）！

#### 跨机实战对话范例：
> **用户**：“帮我连上生产机 `192.168.1.100:22` (命名为 `prod`)，再连上测试机 `192.168.1.50:22` (命名为 `test`)。然后对比两台机器的可用内存。”
>
> 🤖 **AI 行为**：
> 1. 调用 `ssh_connect({ host: "192.168.1.100", port: 22, username: "root", connectionId: "prod", setAsDefault: true })`；
> 2. 调用 `ssh_connect({ host: "192.168.1.50", port: 22, username: "dev", connectionId: "test" })`；
> 3. 分别调用 `ssh_exec({ command: "free -m", connectionId: "prod" })` 与 `ssh_exec({ command: "free -m", connectionId: "test" })`；
> 4. 对比两台服务器的内存指标并为您生成直观的可视化对比表格。

---

### 模式二：客户端级别的【静态多实例隔离】（物理隔离、互不干扰）

如果您希望在客户端一打开时就有几个**完全独立、固定常驻**的主机通道，直接在客户端配置文件中声明多个独立的 Server 实例：

```json
{
  "mcpServers": {
    "ssh-prod": {
      "command": "npx",
      "args": ["-y", "@atengk/mcp-server-ssh"],
      "env": {
        "SSH_HOST": "192.168.1.100",
        "SSH_PORT": "22",
        "SSH_USER": "root",
        "SSH_KEY_PATH": "D:/files/server/id_ed25519"
      }
    },
    "ssh-test": {
      "command": "npx",
      "args": ["-y", "@atengk/mcp-server-ssh"],
      "env": {
        "SSH_HOST": "192.168.1.50",
        "SSH_PORT": "22",
        "SSH_USER": "dev",
        "SSH_PASSWORD": "test_password"
      }
    }
  }
}
```
* **效果**：客户端会同时启动两个独立的 Node.js 子进程，AI 的工具箱中会自动隔离出 `ssh-prod:ssh_exec` 和 `ssh-test:ssh_exec` 两个独立工具集。

---

### 模式三：继承本地 `~/.ssh/config` 集群别名（零凭证泄露）

在宿主机的 `~/.ssh/config` 中配置多主机拓扑（含各自私钥、自定义端口与跳板机），启动服务后，无需在聊天中告知 AI 任何敏感 IP 或密码：
> **用户**：“帮我连上本地配置里的 `ali-prod` 和 `tencent-test` 主机。”  
> 🤖 **AI**：自动通过 `sshConfigAlias` 建立连接并映射路由，安全优雅！

---

## 💬 AI 对话实战范例 (Showcase & Prompts)

配置完成后，您可以直接在 AI 聊天窗口中像与专业资深运维工程师对话一样发出自然指令：

### 🎯 场景 A：日常系统巡检与资源监控
> **用户**：“帮我巡检一下当前服务器的健康状态：检查内核版本、CPU 负载、可用内存以及根目录磁盘空间。”
>
> 🤖 **AI 行为**：自动调用 `ssh_exec` 执行 `uname -r`、`uptime`、`free -m`、`df -h /`，格式化提取核心指标并为您生成美观的巡检摘要。

### 🎯 场景 B：服务配置热更新与平滑重载
> **用户**：“把 `/etc/nginx/nginx.conf` 中的 `worker_processes` 修改为 `4`，确认语法无误后平滑重载 Nginx。”
>
> 🤖 **AI 行为**：
> 1. 调用 `sftp_read_file` 查阅原配置文件；
> 2. 将修改后的内容通过 `sftp_write_file` 安全覆盖回写；
> 3. 调用 `ssh_exec` 运行 `nginx -t` 测试配置语法；
> 4. 语法正确后执行 `nginx -s reload` 并向您汇报执行状态。

### 🎯 场景 C：异常日志排查与智能截断保护
> **用户**：“分析 `/var/log/syslog` 中最近发生的错误日志，找出异常原因。”
>
> 🤖 **AI 行为**：自动调用 `ssh_exec` 或 `sftp_read_file` 查阅日志。即使远端日志文件达到数十兆，`OutputTruncator` 也会自动智能截断，保留头部标头与最新的 56KB 报错堆栈，彻底避免上下文撑爆。

### 🎯 场景 D：长阻塞进程实时跟踪与 Ctrl+C 中断
> **用户**：“在终端中实时跟踪 `tail -f /var/log/app.log`，观察 5 秒后帮我发送 Ctrl+C 中断它。”
>
> 🤖 **AI 行为**：自动调用 `ssh_session_start` 开启 PTY 终端并启动 tail 进程；通过 `ssh_session_send` 获取流式增量回显，随后下发 `\x03` (Ctrl+C) 安全终止进程，最后调用 `ssh_session_close` 回收伪终端资源。

### 🎯 场景 E：文件双向极速上传与备份
> **用户**：“把本地当前目录下的 `config.prod.yaml` 上传到服务器的 `/data/app/config.yaml`，并在上传前把远程旧文件备份为 `.bak`。”
>
> 🤖 **AI 行为**：自动调用 `ssh_exec` 执行备份命令，随后调用 `sftp_upload` 高效完成文件传输并校验文件大小。

---

## 🛠️ 全量 17 个原子工具矩阵参考 (Tools)

| 分类 | 工具名称 | 功能描述 | 核心参数 |
| :--- | :--- | :--- | :--- |
| **基础运维** | `ssh_ping` | 检测 MCP 服务存活、版本及协议延迟 | `message?` |
| **连接管理** | `ssh_connect` | 建立新 SSH 连接或依据配置别名载入 | `host`, `port`, `username`, `password`, `privateKey`, `proxyJump`, `sshConfigAlias` |
| | `ssh_disconnect` | 安全关闭并移除指定的物理 SSH 连接 | `connectionId` |
| | `ssh_list_connections` | 列出当前连接池中所有活跃连接及默认路由 | 无 |
| | `ssh_list_config_hosts` | 读取并列出本机 `~/.ssh/config` 预设的所有别名 | 无 |
| **命令执行** | `ssh_exec` | 无状态执行远程命令（继承 PATH，支持 dryRun 与安全逃生门） | `command`, `connectionId?`, `cwd?`, `timeoutMs?`, `dryRun?`, `dangerouslySkipSafetyCheck?` |
| **持久终端** | `ssh_session_start` | 启动常驻交互式 PTY 伪终端会话流 | `connectionId?`, `cols?`, `rows?` |
| | `ssh_session_send` | 向 PTY 终端注入输入或控制信号（如 `\x03` Ctrl+C） | `sessionId`, `input`, `waitForMs?` |
| | `ssh_session_close` | 优雅关闭指定的交互式终端会话并回收系统资源 | `sessionId` |
| **文件系统** | `sftp_read_file` | 读取远程文本文件（单次限制 512KB 防撑爆） | `remotePath`, `connectionId?`, `encoding?`, `maxBytes?` |
| | `sftp_write_file` | 写入并覆盖远程文本文件（支持自动递归建父目录） | `remotePath`, `content`, `createDirectories?` |
| | `sftp_list_dir` | 浏览远程目录，返回 POSIX 元数据列表 | `remotePath`, `connectionId?` |
| | `sftp_stat` | 获取指定远程文件或目录的详细 POSIX 状态 | `remotePath`, `connectionId?` |
| | `sftp_mkdir` | 在远程主机上创建目录（默认递归 `mkdir -p`） | `remotePath`, `recursive?` |
| | `sftp_remove` | 删除远程文件或目录（支持级联删除与防环保护） | `remotePath`, `recursive?` |
| | `sftp_upload` | 将宿主机本地文件极速上传至远程目标路径 | `localPath`, `remotePath`, `connectionId?` |
| | `sftp_download` | 将远程主机文件极速下载至宿主机本地目标路径 | `remotePath`, `localPath`, `connectionId?` |

---

## 🛡️ 安全防御矩阵与演练模式 (SafetyGuard)

为了防范 AI 模型幻觉引发毁灭性系统灾难，服务内置了强力前置守卫：
- **实时拦截黑名单**：自动阻断系统全盘强删（`rm -rf /`、`rm -rf /*`）、块设备覆写（`mkfs`、`dd if=... of=/dev/...`）、系统停机关机（`reboot`、`shutdown`、`init 0`）、清空根权限（`chmod -R 000 /`）及 Fork 炸弹等。
- **运维受控逃生门**：针对系统管理员确需执行重启等特殊运维任务的场景，服务提供双重授权逃生门机制——必须在服务端配置环境变量 `SSH_ALLOW_DANGEROUS_COMMANDS=true`，且在 `ssh_exec` 调用时显式传入 `dangerouslySkipSafetyCheck: true` 方可放行，单方面调用将被严格拒绝。
- **实机绝对安全**：拦截发生在客户端下发前，**危险字节流绝对不会走出本地网络，远端物理通道零受影响**。
- **安全演练模式 (`dryRun`)**：在调用 `ssh_exec` 时传入 `dryRun: true`，可在不下发执行的前提下验证命令是否符合安全规则。

---

## ❓ 常见问题与排坑指南 (FAQ & Troubleshooting)

<details>
<summary><b>Q1: Windows 宿主机下私钥文件路径该如何填写？</b></summary>
<br>
推荐直接使用跨平台通用的正斜杠格式，例如 <code>D:/files/server/id_ed25519</code>，Node.js 原生支持且能规避 JSON 字符转义问题；若坚持使用 Windows 传统反斜杠，必须写成双反斜杠转义形式 <code>D:\\files\\server\\id_ed25519</code>。
</details>

<details>
<summary><b>Q2: 为什么尝试读取大日志文件时报错“超出最大读取限制”？</b></summary>
<br>
为了防止数十兆或上百兆的日志文本一次性灌入撑爆宿主客户端内存或消耗百万级 Token，<code>sftp_read_file</code> 默认设置了 512KB 安全阈值。对于大型日志，建议使用 <code>sftp_download</code> 下载到本地，或者使用 <code>ssh_exec</code> 运行 <code>tail -n 200</code> 进行截取。
</details>

<details>
<summary><b>Q3: 连接时提示“All configured authentication methods failed”怎么排查？</b></summary>
<br>
通常由于目标服务器禁用了该认证方式引起：<br>
1. 若使用公私钥，检查目标机 <code>/etc/ssh/sshd_config</code> 是否配置了 <code>PubkeyAuthentication yes</code>，以及目标机 <code>~/.ssh/authorized_keys</code> 权限是否为 <code>600</code>；<br>
2. 若使用密码，检查 <code>PasswordAuthentication yes</code> 是否开启。
</details>

<details>
<summary><b>Q4: 为什么执行带有 sudo 的命令可能挂起？</b></summary>
<br>
无状态 <code>ssh_exec</code> 不分配交互式伪终端，若目标机 <code>sudo</code> 需要输入密码会导致命令等待输入直至超时。如果需要执行需要密码的 sudo 命令，请使用 <code>ssh_session_start</code> 启动持久 PTY 交互会话，或者在目标机 <code>sudoers</code> 中配置相应权限为 <code>NOPASSWD</code>。
</details>

---

## 🏗️ 架构拓扑 (Architecture)

```mermaid
flowchart TD
    Client["MCP 宿主客户端 (Claude Desktop / Cursor / Antigravity)"]
    
    subgraph MCP_Server["@atengk/mcp-server-ssh (Node.js Bundle)"]
        Stdio["Stdio 传输层 (src/index.ts)"]
        
        subgraph Safety_Module["前置安全守卫 & 输出流控"]
            Guard["SafetyGuard (致命破坏模式阻断)"]
            Truncator["OutputTruncator (64KB 双端智能截断)"]
        end
        
        subgraph Core_Services["核心能力服务"]
            ConnPool["ConnectionPool (多主机连接池与心跳保活)"]
            Exec["ExecService (无状态登录 Shell 执行)"]
            Session["SessionService (常驻 PTY 终端会话流)"]
            SFTP["SFTPService (POSIX 文件系统与防环)"]
        end
    end
    
    subgraph Remote_Network["远程目标网络"]
        Bastion["ProxyJump 堡垒机 / 跳板机"]
        LinuxHost["目标 Linux 服务器 (OpenSSH Server)"]
    end
    
    Client <==>|JSON-RPC via stdio| Stdio
    Stdio --> Safety_Module
    Safety_Module --> Core_Services
    ConnPool -.->|SSH 隧道转发| Bastion
    Bastion -.->|Direct TCP/IP| LinuxHost
    ConnPool ===>|SSH2 / SFTP 子通道| LinuxHost
```

---

## 🏛️ 架构决策记录 (Architecture Decision Records)

本项目遵循严格的 ADR 演进机制：
- [ADR-0001: 采用零侵入标准 OpenSSH 协议直连](docs/adr/0001-direct-openssh-protocol.md)
- [ADR-0002: 双模命令执行引擎设计（独立通道与持久 PTY 会话）](docs/adr/0002-dual-execution-modes.md)
- [ADR-0003: 前置命令安全拦截与 64KB 双端输出防爆策略](docs/adr/0003-safety-guard-and-output-truncation.md)
- [ADR-0004: 作用域包命名与三位一体 MCP 生态分发矩阵](docs/adr/0004-distribution-and-registry-strategy.md)

---

## 🌐 官方生态与目录收录 (Community Catalogs)

本项目支持通过标准 PR / Issue 形式收录至全球 MCP 目录：
- **Model Context Protocol 官方社区**：[modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- **Glama MCP Directory**：[glama.co/mcp/servers](https://glama.co/mcp/servers)
- **PulseMCP Registry**：[pulsemcp.com](https://www.pulsemcp.com)
- **Awesome MCP Servers**：[punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)

---

## 📄 开源许可证 (License)

本项目基于 [MIT License](./LICENSE) 协议完全开源。
