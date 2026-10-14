# 0014. 安全审计轨迹与零泄密合规架构

## 背景与决策 (Context & Decision)

随着 AI Agent 在生产环境中拥有直接操控远程 Linux/Unix 主机的强大能力，其执行的任何命令、特权提权（Sudo）、文件覆写与网络隧道操作均关乎生产系统的生命线。缺乏结构化、不可篡改且可追溯的审计跟踪，会导致无法满足企业级安全合规（如 SOC2、ISO27001、等保三级）要求，并在发生安全事故时无法还原因果链条。

为此，我们做出如下架构决策：**构建原生零依赖安全审计轨迹系统 (Audit Trail System)**：
1. **混合全景审计拦截 (Hybrid Layered Audit)**：
   - 在 MCP 服务装配入口 (`src/index.ts`) 统一拦截全部 29 个 MCP 工具调用的生命周期（生成全局唯一 `id`、记录工具名、脱敏参数、执行耗时 `durationMs`、执行状态与错误信息）；
   - 在关键服务内部（`SafetyGuard` 高危拦截与放行、`ExecService` Sudo 特权提权、`SftpService` 文件差异补丁、`TunnelService` 隧道映射建立与释放、`JobService` 脱机作业生命周期）注入细粒度业务安全事件。
2. **纯原生零依赖文件尺寸监控与原子轮转器 (Native Rotator)**：
   - 坚持项目零多余外部依赖原则，基于 Node.js 原生标准库 (`node:fs`, `node:path`) 实现安全轮转器；
   - 监控主日志文件（`audit.log`）大小，当超过 `MCP_SSH_AUDIT_MAX_SIZE_MB`（默认 10MB）时，触发原子重命名轮转（`audit.log.1` -> `audit.log.2` ... 最多保留 `MCP_SSH_AUDIT_MAX_FILES` 份，默认 5 份），最后将当前主文件重命名为 `audit.log.1` 并新建空主文件，确保高并发写入下的文件原子性。
3. **多重可插拔汇聚端 (Pluggable Audit Sink)**：
   - 统一采用单行 JSON Lines (NDJSON) 作为数据交换标准；
   - 若设置了 `MCP_SSH_AUDIT_LOG_PATH`，则启用滚动文件写入器 (`FileAuditSink`)；若未配置文件路径但显式启用了审计，则输出至标准错误流 (`StderrAuditSink`)，完美适配 Docker/K8s 容器云原生日志采集代理。
4. **深度递归脱敏与模式遮蔽 (Credential Sanitizer)**：
   - 严格坚守零机密泄露红线（Zero-Secret Invariant）；
   - 在审计落盘前，对参数对象进行深层递归遍历，凡键名匹配敏感字段（`password`, `sudoPassword`, `privateKey`, `passphrase`, `token`, `secret`, `auth` 等）的值一律遮蔽为 `[REDACTED]`；
   - 对命令行字符串进行模式过滤，遮蔽常见内联明文凭据（如 `--password <val>`, `-p <val>`）。
5. **双模容错哲学 (Fail-Safe vs. Fail-Closed)**：
   - 默认采用柔性降级策略（Fail-Safe），当审计写入因磁盘满、无权限等异常失败时，向 `stderr` 打印告警并降级，不阻断主业务执行，保障系统连续可用；
   - 当配置 `MCP_SSH_AUDIT_STRICT=true` 时，开启金融级严格熔断（Fail-Closed），审计写入失败立即抛出致命异常并中断当前操作，杜绝无审计操作盲区。
6. **单一规范环境变量收敛 (ADR-0012 对齐)**：
   - `MCP_SSH_AUDIT_ENABLED`: 严格布尔（`"true" | "false"`，配置路径时自动推导激活）；
   - `MCP_SSH_AUDIT_LOG_PATH`: 物理存储路径；
   - `MCP_SSH_AUDIT_MAX_SIZE_MB`: 严格正整数（默认 10）；
   - `MCP_SSH_AUDIT_MAX_FILES`: 严格正整数（默认 5）；
   - `MCP_SSH_AUDIT_STRICT`: 严格布尔（默认 `"false"`）。

## 权衡考量 (Considered Options)

- **关于轮转器依赖选型**：
  - 选项 1：引入 `rotating-file-stream` 或 `winston`。功能齐全但引入额外间接依赖，增大构建体积。
  - 选项 2：基于 Node.js 原生标准库实现轻量原子轮转器（已采纳）。仅需约百行代码，完全受控且易于单测验证。
- **关于审计输出介质**：
  - 选项 1：仅支持写本地文件。容器环境下日志落盘需要额外挂载卷，不符合 12-Factor App。
  - 选项 2：支持文件滚动与纯 `stderr` 流双模（已采纳）。兼顾单机运维落盘与云原生容器化环境采集。
- **关于脱敏深度**：
  - 选项 1：白名单只保留少量字段。会导致管理员排查时丢失具体的执行上下文。
  - 选项 2：递归深度脱敏加命令行正则擦除（已采纳）。既保留完整的参数与命令上下文，又封死凭据泄露通道。

## 后果与影响 (Consequences)

- 优势：
  - 具备企业级不可篡改、时间有序的合规审计轨迹能力；
  - 生产零外部第三方依赖，包体积零膨胀；
  - 兼具云原生标准错误流采集与主机本地大小自动切分；
  - 与现有安全拦截、环境变量、CLI 探针深度互锁。
- 代价：
  - 每次工具调用增加极轻微的微秒级脱敏与 I/O 序列化开销；
  - 需严格维护测试用例，覆盖文件滚动、权限降级与各类敏感凭据遮蔽场景。
