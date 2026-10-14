# 0012. 严格环境变量治理与宽松兼容废弃

## 背景与决策 (Context & Decision)

在早期版本中，为了方便开发者从通用脚手架迁移，服务在 [`src/config/env.ts`](../../src/config/env.ts) 中引入了大量宽松回退与模糊兼容机制：
1. **多重前缀别名回退**：`getEnvValue` 支持从 `MCP_SSH_*` 静默降级到历史别名（如 `SSH_HOST`, `HOST`, `PORT`, `SSH_USER`, `SSH_PASSWORD` 等）；
2. **模糊布尔类型解析**：`parseBoolean` 宽容匹配 `"1"`, `"yes"`, `"on"`, `"t"`，造成非确定性的隐式类型转换；
3. **键名碎片化**：私钥路径同时存在 `KEY_PATH` 与 `PRIVATE_KEY_PATH` 两种别名；
4. **服务跨层直读环境变量**：`ExecService` 存在绕过集中配置中枢直接读取 `process.env.SSH_ALLOW_DANGEROUS_COMMANDS` 的逻辑。

这种“宽松兼容”在生产环境暴露出了严重的负面效应：通用环境变量（如容器编排中泛滥的 `HOST`、`PORT`）极易与 SSH 目标主机/端口发生命名冲突与污染；模糊的布尔容错导致拼写错误（如 `"treu"`）被静默视为 `false`；多套兼容键名导致运维排错心智负担倍增。

为此，我们做出如下架构决策：**全面废除宽松兼容机制，实施严格单命名空间环境变量治理 (Strict Configuration Guard)**：
1. **强力单命名空间与零别名降级**：100% 专有配置必须严格且仅遵循 `MCP_SSH_*` 官方命名空间，彻底删除所有 `fallbackKeys` 别名（`SSH_*`, `PORT`, `HOST`, `MCP_TRANSPORT`）；
2. **严格布尔类型守卫**：布尔值仅严格识别 `"true"` 与 `"false"`（忽略大小写与首尾空格），若传入非标值（如 `"1"`, `"yes"`, `"on"`）立即作为配置异常抛出并阻断启动，拒绝模糊猜测；
3. **静默忽略非标外部变量**：非 `MCP_SSH_*` 前缀的无关环境变量一律静默忽略，不进行任何隐式映射；
4. **POSIX / OpenSSH 原生变量穿透**：除 OpenSSH 协议标准原生变量（`SSH_AUTH_SOCK` 用于 SSH Agent，`USER`/`USERNAME` 用于获取本地登录名）允许在凭据探测层穿透继承外，服务专属配置 100% 遵守 `MCP_SSH_*` 约束；
5. **私钥路径唯一对齐**：私钥文件路径统一锁定为 `MCP_SSH_PRIVATE_KEY_PATH` 与 `MCP_SSH_PROXY_PRIVATE_KEY_PATH`，彻底剔除 `KEY_PATH` 冗余别名；
6. **配置依赖注入与单向流**：`ExecService` 等核心服务禁止在内部直接触碰 `process.env`，危险命令放行标志等全局参数由 `parseEnv` 统一解析并注入 `AppConfig`，再单向分发至各服务。

## 规范环境变量唯一权威矩阵 (Canonical Env Matrix)

| 环境变量名 | 类型 | 默认值 | 职责描述 |
| :--- | :--- | :--- | :--- |
| `MCP_SSH_TRANSPORT` | `"stdio" \| "sse"` | `"stdio"` | MCP 协议传输承载模式 |
| `MCP_SSH_SERVER_HOST` | string | `"0.0.0.0"` | SSE 模式下的 HTTP 监听地址 |
| `MCP_SSH_SERVER_PORT` | number (1~65535) | `8000` | SSE 模式下的 HTTP 监听端口 |
| `MCP_SSH_TIMEOUT` | number (>0) | `30000` | SSH 建连与就绪超时毫秒数 |
| `MCP_SSH_KEEP_ALIVE_INTERVAL` | number (>0) | `10000` | SSH 心跳 KeepAlive 探测间隔毫秒数 |
| `MCP_SSH_ALLOW_DANGEROUS_COMMANDS` | boolean (`"true" \| "false"`) | `false` | 是否授权放行高危毁灭性 Shell 指令 |
| `MCP_SSH_HOST` | string | - | 默认预建连目标主机名或 IP |
| `MCP_SSH_PORT` | number (1~65535) | `22` | 默认预建连目标 SSH 端口 |
| `MCP_SSH_USER` | string | - | 默认预建连目标登录用户名 |
| `MCP_SSH_PASSWORD` | string | - | 默认预建连目标明文认证密码 |
| `MCP_SSH_PRIVATE_KEY` | string | - | 默认预建连 PEM 私钥多行文本 |
| `MCP_SSH_PRIVATE_KEY_BASE64` | string | - | 默认预建连 Base64 编码私钥 |
| `MCP_SSH_PRIVATE_KEY_PATH` | string | - | 默认预建连本地私钥文件路径 |
| `MCP_SSH_KEY_PASSPHRASE` | string | - | 默认预建连私钥解密口令 |
| `MCP_SSH_CONFIG_ALIAS` | string | - | 默认预建连匹配的 `~/.ssh/config` 别名 |
| `MCP_SSH_PROXY_HOST` | string | - | 跳板机 (ProxyJump) 主机名或 IP |
| `MCP_SSH_PROXY_PORT` | number (1~65535) | `22` | 跳板机 (ProxyJump) SSH 端口 |
| `MCP_SSH_PROXY_USER` | string | - | 跳板机 (ProxyJump) 登录用户名 |
| `MCP_SSH_PROXY_PASSWORD` | string | - | 跳板机 (ProxyJump) 明文认证密码 |
| `MCP_SSH_PROXY_PRIVATE_KEY` | string | - | 跳板机 (ProxyJump) PEM 私钥多行文本 |
| `MCP_SSH_PROXY_PRIVATE_KEY_BASE64` | string | - | 跳板机 (ProxyJump) Base64 编码私钥 |
| `MCP_SSH_PROXY_PRIVATE_KEY_PATH` | string | - | 跳板机 (ProxyJump) 本地私钥文件路径 |
| `MCP_SSH_PROXY_KEY_PASSPHRASE` | string | - | 跳板机 (ProxyJump) 私钥解密口令 |

## 权衡考量 (Considered Options)

- **关于是否保留别名提示期**：
  - 选项 1：启动时检测旧版 `SSH_*` 并打印警告。
  - 选项 2：静默忽略非标变量，严格专注标准键（已采纳）。
  - 考量：在现代容器化与无状态 AI 工具场景下，过多的警告日志会污染 stdio 协议传输，且阻碍 12-Factor 的纯净化治理。坚决拒绝宽松兼容，保持代码最简且杜绝暗坑。
- **关于布尔值解析严苛度**：
  - 选项 1：继续支持 `"1"`, `"yes"`, `"on"` 等模糊值。
  - 选项 2：严格校验非标布尔输入，非法值直接抛出异常（已采纳）。
  - 考量：配置应当遵循 Explicit is better than implicit。如果运维人员写成了 `MCP_SSH_ALLOW_DANGEROUS_COMMANDS=tru`，模糊解析容易因默认 fallback 产生非预期行为；前置严格报错能第一时间暴露问题。

## 后果与影响 (Consequences)

- 优势：
  - 彻底终结了环境变量与其他工具/基础镜像变量发生命名冲突的顽疾；
  - 消除隐式模糊解析带来的行为不确定性，配置行为 100% 可预测；
  - 简化 `src/config/env.ts` 逻辑，减少死代码与分支复杂度；
  - 架构分层更加纯粹，服务间依赖关系完全通过显式参数与 `AppConfig` 传递。
- 代价：
  - 任何依然依赖历史 `SSH_*` 变量的旧部署环境必须显式重命名为 `MCP_SSH_*` 才能生效。
