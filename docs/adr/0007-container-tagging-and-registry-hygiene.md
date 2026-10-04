# 0007. 容器镜像标签分层体系与 GHCR 制品纯净化治理

## 背景与决策 (Context & Decision)

随着 `@atengk/mcp-server-ssh` 官方多架构 Docker 镜像接入 GitHub Container Registry (`ghcr.io/atengk/mcp-server-ssh`) 进行自动化发版，在实际镜像分发与云原生拉取场景中暴露出以下关键问题：

1. **`latest` 标签推导失效**：原发布流水线中配置了 `type=raw,value=latest,enable={{is_default_branch}}`。由于发版流水线是由 Git Tag 推送（`refs/tags/v*`）触发，上下文环境变量并非默认分支（`refs/heads/main`），导致 `{{is_default_branch}}` 恒为 `false`，从而在打正式 Tag 时未正确赋予 `latest` 浮动标签；
2. **缺乏全量历史导致版本比对不可靠**：`publish-docker` 任务中的 `actions/checkout` 默认仅执行深度为 1 的浅克隆（shallow clone），缺失 Git 历史导致 `docker/metadata-action` 无法进行 SemVer 大小比对与智能回退防护；
3. **幽灵架构与 Attestation 产物污染**：Docker Buildx 默认推送了 SLSA Provenance 与 SBOM Attestation 附属层清单，导致在 GitHub Packages 镜像详情页面中出现包含 `unknown/unknown` 平台的幽灵条目，对开发者造成混淆，且增加了老旧 Docker 守护进程与部分轻量容器运行时的拉取解析兼容性隐患；
4. **缺失大版本浮动标签**：原标签规则仅生成了全版本号（如 `1.2.4`）与次版本号（如 `1.2`），缺失主版本标签（如 `1`），无法支持用户通过主版本锁定自动享受安全补丁更新。

为彻底解决上述问题并全面对标 `atengk/oss-template` 最佳实践，我们决定实施以下治理方案：

1. **引入全量源码检出与原生 SemVer 标签引擎**：
   - 为 `publish-docker` 中的 `actions/checkout` 显式声明 `fetch-depth: 0`，确保拉取完整提交与标签历史；
   - 移除脆弱且语义冲突的 `type=raw,value=latest,enable=...`，改用官方标准的 `flavor: latest=auto`。只要发布的是当前最新的非 Pre-release 正式版本，即自动生成 `latest` 标签，且在历史补丁分支发版时具备版本防倒退保护；
2. **补齐四级容器标签流动体系 (Container Tag Hierarchy)**：
   - 规则覆盖 `{{version}}`（Patch 级别，如 `1.2.4`）、`{{major}}.{{minor}}`（Minor 级别，如 `1.2`）、`{{major}}`（Major 级别，如 `1`）以及 `latest` 默认标签；
3. **强制启用制品纯净化治理 (Registry Hygiene)**：
   - 在 `docker/build-push-action` 中显式设置 `provenance: false` 与 `sbom: false`，彻底消除 GHCR 上的 `unknown/unknown` 幽灵架构层，保持 OCI 镜像 Manifest 纯粹透明。

## 权衡考量 (Considered Options)

- **`latest` 标签生成机制**：
  - 静态强行绑定 Tag（`type=raw,value=latest`）：无法防止历史补丁分支发布（如维护旧分支 `v1.1.9`）时错误将 `latest` 标签回退覆盖；
  - 依赖默认分支推导（`enable={{is_default_branch}}`）：在纯 Tag 触发的发布工作流中恒为失效；
  - 基于完整 Git 历史的 SemVer 智能推导（`fetch-depth: 0` + `flavor: latest=auto`，已采纳）：兼具准确性与健壮性，自动防御历史回退覆盖。
- **Provenance 与 SBOM 构建出处凭证**：
  - 保持默认开启：虽然具备 SLSA 供应链凭证，但在 GHCR 界面生成 `unknown/unknown` 伪架构，且部分边缘嵌入式 Docker 客户端拉取多架构清单时会发生解析异常；
  - 显式禁用并保持产物纯净（已采纳）：符合当前轻量化 MCP 服务的部署定位，最大化保障客户端拉取兼容性与界面直观度。

## 后果与影响 (Consequences)

- **优势**：
  - 用户执行 `docker pull ghcr.io/atengk/mcp-server-ssh:latest`、`:1`、`:1.2` 与 `:1.2.4` 均能稳定获取到正确架构的容器镜像；
  - GHCR Packages 页面仅展示标准的 `linux/amd64` 与 `linux/arm64` 平台条目，不再出现 `unknown/unknown` 幽灵层；
  - 完美契合 `docker-compose.yaml` 中免源码单文件以 `latest` 镜像拉起服务的开箱即用体验。
- **代价**：
  - 镜像缺少内嵌的 SLSA Provenance 与 SBOM 附件层；如未来有严格的金融/军工级供应链溯源合规需求，可单独引入 Cosign 外部签名流程。
