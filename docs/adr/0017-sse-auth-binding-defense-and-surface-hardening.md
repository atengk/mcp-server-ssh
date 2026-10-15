# 0017. SSE 传输模式身份鉴权、暴露熔断与网络边界安全收敛

## 背景与决策 (Context & Decision)

在开源缺陷报告（[Issue #12](https://github.com/atengk/mcp-server-ssh/issues/12)，CWE-306）中指出，服务在 `MCP_SSH_TRANSPORT=sse` 网络传输模式下存在严重安全暴露面：
1. **无认证暴露**：`/sse` 与 `/message` 端点未进行任何身份鉴权，且 CORS 默认开放通配符 `*`，任何网络对端或恶意网页脚本均可直连并调用全量 SSH/SFTP/PTY 工具；
2. **默认全网绑定**：`MCP_SSH_SERVER_HOST` 默认绑定 `0.0.0.0`，在缺乏鉴权时直接将本地全功能运维控制权暴露于局域网或公网；
3. **出站中继跳板**：`ssh_connect` 允许客户端动态传入任意 IP/端口与凭据，导致未鉴权服务可被攻击者利用为内网横向渗透与出站中继代理（Outbound SSH Pivot）。

为彻底消除 CWE-306 缺陷并践行深度防御原则，我们做出如下架构决策：
1. **强制常数时间 SSE 身份鉴权 (SSE Auth Token)**：
   - 引入规范环境变量 `MCP_SSH_AUTH_TOKEN`，在 `/sse` 握手与 `/message` 请求中同时支持 `Authorization: Bearer <token>` 标头及 `?token=<token>` 查询参数（兼容轻量 EventSource 客户端）；
   - 采用双重 SHA-256 摘要比对（`crypto.timingSafeEqual`），恒定执行 32 字节常数时间校验，彻底防御时序侧信道攻击；未通过校验直接响应 401 Unauthorized。
2. **回环地址绑定默认与外部暴露强制熔断 (Fail-Closed Binding)**：
   - 将 `MCP_SSH_SERVER_HOST` 默认值收敛为 `127.0.0.1`（仅宿主机本地可达）；
   - 当显式配置为非回环地址（如 `0.0.0.0` 或具体网卡 IP）时，**强制要求必须配置 `MCP_SSH_AUTH_TOKEN`**；若未提供则启动时立即抛出致命异常并终止进程（Fail-Closed）；仅绑定 `127.0.0.1` 且未提供 Token 时允许本地调试启动但输出安全告警。
3. **CORS 跨域安全收敛 (Origin Whitelist)**：
   - 废除通配符 `*`，默认不返回任何允许跨域标头；
   - 引入 `MCP_SSH_ALLOWED_ORIGINS` 白名单配置，仅当请求的 `Origin` 严格命中时才回显跨域凭据许可标头。
4. **复合目标白名单与禁用动态建连 (Target Allowlist)**：
   - 引入 `MCP_SSH_ALLOWED_TARGETS`，支持 IP、端口、CIDR 网段（如 `10.0.0.0/8`）与域名通配符（如 `*.internal.corp`），对 `ssh_connect` 目标及 ProxyJump 跳板机实行双重白名单校验；
   - 引入 `MCP_SSH_DISABLE_DYNAMIC_CONNECT=true` 开关，直接禁用动态建连，仅允许使用预建连主机或本地 `~/.ssh/config` 既有别名。
5. **健康检查探针脱敏**：
   - `/health` 与 `/ping` 保持免密以兼容容器探针，但剔除内部连接数与具体版本指纹，仅返回 `{ "status": "healthy" }`；废除根路径 `/` 免密响应。

## 权衡考量 (Considered Options)

- **关于 Token 传递方式**：
  - 仅 Header 模式 vs Header + Query 双模式（已采纳）。因浏览器原生 EventSource API 无法设置自定义 Header，提供 Query 兜底支持能保障现代 Web 客户端无缝接入，同时在服务端文档建议生产优先 Header。
- **关于默认绑定与熔断边界**：
  - 维持 `0.0.0.0` 打印警告 vs 回环绑定 + 非回环强制熔断（已采纳）。警告在容器与非交互日志中极易被忽视，只有在暴露时强制拒绝启动（Fail-Closed）才能从根本上扼杀未授权暴露事故。
- **关于防跳板机制**：
  - 仅依赖 Token 鉴权 vs 引入目标白名单（已采纳）。深度防御要求即使攻击者获取了 Token 或通过 Prompt 注入操纵模型，白名单依然能将其限制在合规网段内，杜绝横向漫游。

## 后果与影响 (Consequences)

- 优势：
  - 彻底封堵 CWE-306 高危网络暴露面，达到企业级生产准入标准；
  - 遵循安全默认原则（Secure by Default），单机调试平滑无感，网络暴露具备强约束硬熔断；
  - 兼顾云原生健康探测、浏览器跨域防御与内网跳板收敛。
- 代价：
  - 既有使用 `docker-compose.yaml` 且未配置 Token 的环境在升级时将触发熔断，需显式声明 `MCP_SSH_AUTH_TOKEN`。
