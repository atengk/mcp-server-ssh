# 0004. 作用域包命名与三位一体 MCP 生态分发矩阵

## 背景与决策 (Context & Decision)

为了使全球开发者和各类 AI 宿主客户端（Claude Desktop、Cursor、Antigravity、Cline 等）能够无缝发现、一键免安装运行并安全接入 `mcp-server-ssh`，我们需要确立生产发布渠道与包分发标准。
经全局注册表排查，未经 Scope 的旧名 `mcp-server-ssh` 已在 NPM 上被第三方抢注；同时，单一代码仓库难以让外部用户即开即用。

我们决定采纳以下核心发布决策：
1. **统一作用域包命名**：在 NPM 上采用组织命名空间包名 `@atengk/mcp-server-ssh`，与 GitHub 官方仓库 `atengk/mcp-server-ssh` 强一致绑定；
2. **三位一体分发矩阵**：
   - **底座运行层**：发布至 NPM 公共注册表，支持 `npx -y @atengk/mcp-server-ssh` 零依赖即开即用；
   - **源码与交付层**：GitHub 主干管理，配合语义化版本发布 GitHub Releases；
   - **生态收录层**：主动接入 Model Context Protocol 官方生态目录与权威 MCP Catalog（PulseMCP、Glama、Awesome MCP Servers）；
3. **自动化发布流水线与 Provenance 来源防伪**：配置 GitHub Actions 工作流，在版本打 Tag 时自动执行全量测试、类型检查、单文件 Bundle 编译，并利用 GitHub OIDC 签名以 `npm publish --access public --provenance` 形式发布 NPM，确立最高级别的软件供应链溯源可信度。

## 权衡考量 (Considered Options)

- **NPM 包名命名策略**：
  - 纯无前缀名（如更名为 `mcp-openssh` 等）：破坏了与 GitHub 仓库名的一致性，且未来仍有在不同注册表重名冲突的风险；
  - 组织作用域包名（已采纳 `@atengk/mcp-server-ssh`）：天然拥有专属命名空间所有权，品牌一致性最高，彻底阻断包名抢注与供应链投毒攻击。
- **分发与交付途径**：
  - 仅代码开源（由用户自行 clone 本地编译）：门槛极高，非专业开发者无法接入 MCP 客户端；
  - NPM 独立 Bundle + 生态 Catalog 索引（已采纳）：用户只需在客户端 JSON 配置两行命令即可秒级唤醒服务，接入成本降至最低。

## 后果与影响 (Consequences)

- 优势：
  - 确立了清晰的品牌标识与供应链安全；
  - 全球任何支持 MCP 的客户端均可通过 `npx` 极速集成；
  - 自动 CI/CD 保证发布的每个版本均通过 100% 单元测试与真机验收。
- 代价：
  - 在 NPM 发布 scoped 包首次发布需声明 `--access public`（已在 `publishConfig` 中固化配置）；
  - 需要维护 GitHub Actions 的 NPM 发布密钥凭据（`NPM_TOKEN`）。
