# 更新日志 (Changelog)

本项目所有显著变更均记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范，版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

---

## [v1.2.1] - 2026-10-04

### 新增 (Added)
- **开源工程化规范基座**：集成 `atengk/oss-template` 最佳实践，引入 `.editorconfig`（统一跨 IDE 编码与缩进）与 `.gitattributes`（强制文本文件跨平台 LF 换行归一化，彻底消除 Windows CRLF 转换冲突）。
- **开源社区协作契约与模板矩阵**：引入规范的 `CONTRIBUTING.md`（GitHub Flow 与 Conventional Commits 提交指引）、`.github/PULL_REQUEST_TEMPLATE.md`（PR 质量自检清单）以及 `.github/ISSUE_TEMPLATE/`（Bug 反馈与特性建议模板）。
- **日常持续集成流水线 (CI)**：新增 `.github/workflows/ci.yml`，在代码 Push 到 `main` 分支或发起 PR 时自动执行 Semantic PR 标题规范校验、静态类型检查、单元与集成测试套件及产物完整性构建验证。
- **GHCR 多架构 Docker 镜像自动发布**：在发布流水线中接入 `publish-docker` Job，在打 Tag 发版时基于 QEMU + Buildx 自动构建 `linux/amd64` 与 `linux/arm64` 双架构镜像并推送至 GitHub Packages (`ghcr.io/atengk/mcp-server-ssh`)。
- **自动化变更日志配置**：引入 `.cliff.toml` 支持基于 Conventional Commits 的变更日志自动提取与分类，与高质量人工复核的 `CHANGELOG.md` 协同。
- **架构决策记录**：沉淀 [ADR-0006: 开源工程化规范与全自动流水线基建](docs/adr/0006-oss-template-engineering-standards.md)。

---

## [v1.2.0] - 2026-10-04

### 新增 (Added)
- **12-Factor App 标准环境变量解析中枢**：引入统一规范前缀 `MCP_SSH_*` 环境变量矩阵，提供严格强类型解析与边界诊断，同时 100% 透明向下兼容遗留的 `SSH_*` 环境变量。
- **多形态私钥免挂载注入**：支持本地文件路径（`MCP_SSH_KEY_PATH`）、PEM 多行文本自动换行还原（`MCP_SSH_PRIVATE_KEY`）及 Base64 编码字符串自动解码（`MCP_SSH_PRIVATE_KEY_BASE64`），彻底实现容器化零磁盘卷挂载启动。
- **双模通信传输引擎 (Stdio + HTTP SSE)**：支持通过 `MCP_SSH_TRANSPORT=sse` 启动轻量原生 HTTP 服务（默认 8000 端口），暴露 `/sse`（长轮询事件流）、`/message`（JSON-RPC 交互）及 `/health`（服务就绪探针）端点，支持远程网络客户端无缝接入。
- **生产级轻量容器化编排**：新增 Alpine 多阶段构建 `Dockerfile`（非 root 用户 `node` 运行，内置原生健康检查探针）与开箱即用的 `docker-compose.yaml`（`docker compose up -d` 常驻守护）。
- **SSE 会话工厂并发隔离**：在 SSE 服务层重构引入 `serverFactory` 机制，为每个接入的 HTTP 客户端动态生成专属 McpServer 实例，消除底层 SDK 单连接限制，实现多客户端并发接入与会话生命周期独立销毁。
- **结构化跳板机与高级连接参数贯通**：`ssh_connect` 扩充 `readyTimeout` 与 `keepaliveInterval` 参数，`proxyJump` 升级支持结构化对象配置（可为跳板机独立指定端口、用户、密码及私钥凭据）。

### 优化 (Changed)
- **敏感凭证脱敏防护**：日志输出与诊断信息全面实施全链路凭据掩码脱敏（`***`），严禁密码与私钥在任何日志中泄露。
- **多主机预连接体验**：服务启动阶段支持依据规范环境变量自动初始化并建立默认连接（Default Connection），免除客户端手动调用建连指令。

---

## [v1.1.0] - 2026-10-03

### 新增 (Added)
- **安全拦截受控逃生门**：在 `ssh_exec` 中新增 `dangerouslySkipSafetyCheck` 参数，配合环境变量 `SSH_ALLOW_DANGEROUS_COMMANDS=true` 实现双重授权机制，允许运维工程师在必要时受控执行系统重启或维护命令。
- **建连错误诊断感知**：`ConnectionPool` 记录最近一次建连失败原因 `lastConnectionError`，在 `ssh_list_connections` 中回显并在找不到连接时精准提示具体失败原因。
- **长任务超时语义化引导**：在 `ssh_exec` 达到 60s 快速熔断时，抛出明确的参数调优引导与 `ssh_session_*` 交互终端模式指引。
- **供应链 Provenance 签名**：GitHub Actions 发布流水线启用 `npm publish --provenance`，提供由 GitHub Actions OIDC 签发的不可篡改构建来源溯源证明。

### 优化 (Changed)
- **跨平台路径表达规范**：全文档与所有配置示例统一采用跨平台通用的正斜杠（`/`）规范，彻底规避 JSON 反斜杠双重转义陷阱。
- **自动化发版流水线**：重构 `release.yml`，在发布 GitHub Release 时自动提取 CHANGELOG.md 内容，并保底注入环境安装指引与安全溯源报告。

---

## [v1.0.0] - 2026-10-03

### 新增 (Added)
- **零侵入 OpenSSH 直连**：基于标准 OpenSSH 协议直连目标 Linux/Unix 主机，零 Agent、零额外守护进程侵入。
- **双模命令执行引擎**：
  - `ssh_exec`：无状态命令执行，默认包装为登录 Shell（`bash -l -c`）完整继承环境变量与 PATH，精确捕获退出码与耗时；
  - `ssh_session_*`：基于持久 PTY 伪终端的交互式会话流，支持增量回显收集与 `\x03` (Ctrl+C) 中断控制。
- **全功能 POSIX SFTP 文件套件**：支持文本安全读写（512KB 防爆阈值）、双向极速上传与下载、目录树浏览、POSIX 元数据查询与防环递归删除。
- **工业级凭证链与网络拓扑**：支持本地私钥（`id_ed25519` / `id_rsa`）、SSH-Agent 探测、密码认证、`~/.ssh/config` 配置解析及企业级 `ProxyJump` 跳板机隧道。
- **前置安全守卫 (SafetyGuard)**：前置正则匹配强力阻断全盘强删（`rm -rf /`）、块设备覆写（`mkfs`/`dd`）、关机重启（`reboot`/`shutdown`）及 Fork 炸弹等致命操作。
- **智能防爆截断 (OutputTruncator)**：单次执行输出严格限制 64KB（保留前 8KB 标头与后 56KB 最新日志），自动清洗 ANSI 终端转义字符。
- **三位一体分发矩阵**：发布至 NPM 官方注册表 `@atengk/mcp-server-ssh`，单文件打包 Bundle，支持 `npx -y @atengk/mcp-server-ssh` 零依赖即开即用。
