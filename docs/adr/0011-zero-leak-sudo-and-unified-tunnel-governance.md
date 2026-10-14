# 0011. 零泄露 Sudo 提权通道、排除过滤与三位一体隧道治理

## 背景与决策 (Context & Decision)

在真实复杂网络拓扑与生产运维场景下，开发者与 AI Agent 面临三大严峻痛点：
1. **提权卡死与安全泄露**：非 NOPASSWD 环境执行 `sudo` 缺乏 TTY 导致挂死，且采用命令行管道（如 `echo pass | sudo`）会在 `ps` 进程树或系统审计中暴露明文密码；
2. **海量无谓同步**：目录双向传输缺乏排除规则，导致同步源码时无差别打包数万个 `node_modules` 或 `.git` 冗余小文件；
3. **网络穿透单一**：仅支持单向本地端口转发（Local Forwarding），无法支持将本地服务反向暴露给远端的反向代理（Remote Forwarding），亦无法提供跨内网漫游的动态 SOCKS5 代理。

为此，我们做出如下架构决策：
1. **零泄露 Sudo 提权通道**：在 `ssh_exec` 引入 `sudo: true`，底层直接调用 `sudo -S -p '' <cmd>`，并通过 SSH Channel 的 `stdin` 动态流式写入密码并关闭写管道，彻底消除命令行明文参数；
2. **多组 POSIX `--exclude` 规则转译**：在流式 Tar 传输中引入通配过滤机制，本地上传通过 Node 端过滤，远程下载前解析 `.gitignore` 并统一转译为多组标准的 `--exclude='<pattern>'` 拼接到远程 `tar` 命令，全面兼容 GNU tar 与 Alpine 容器；
3. **三位一体网络隧道治理**：在 `TunnelService` 内部将 Local 正向转发、Remote 反向转发与 SOCKS5 动态代理统一纳管，共享心跳保活、`idleTimeoutSeconds` 空闲自动熔断以及底层 SSH 物理连接断开时的级联销毁机制。

## 权衡考量 (Considered Options)

- **关于 Sudo 提权**：
  - 选项：Shell 级拼接 `echo '<password>' | sudo -S` vs SSH Stdin 管道流式注入（已采纳）。命令行拼接会在并发 `ps aux` 或主机审计日志中暴露密码，而 Stdin 管道注入使宿主进程树仅显式呈现标准命令，坚决守牢机密零泄露底线。
- **关于目录排除过滤**：
  - 选项：依赖 GNU tar 专有参数（`--exclude-ignore`）vs 客户端跨平台转译（已采纳）。由于 BusyBox / Alpine 等精简环境对复合通配符支持不全，由 Node 客户端预先解析并下发基础 POSIX `--exclude` 参数组具有最高的环境普适性。
- **关于网络代理架构**：
  - 选项：拆分为零散的独立微工具 vs 纳管进 `TunnelService` 统一模型（已采纳）。反向代理与 SOCKS5 代理与正向转发本质上共享同一组物理生命周期与安全审计需求，统一抽象为 `type: "local" | "remote" | "socks5"` 能够最大化复用连接池与防挂断治理逻辑。

## 后果与影响 (Consequences)

- 优势：
  - 解决真实运维中必须的 `sudo` 提权场景，同时实现绝对防泄露；
  - 目录同步效率大幅跃升，彻底杜绝传输依赖造成的网络与内存浪费；
  - 提供覆盖正向、反向、全局动态代理的全功能网络穿透矩阵。
- 代价：
  - 需引入轻量纯 JS SOCKS5 协议解析层；
  - 需要在远程命令中谨慎处理不同 shell 对 `sudo` 密码提示符的静默屏蔽。
