# 0006. 开源工程化规范与全自动流水线基建

## 背景与决策 (Context & Decision)

随着 `@atengk/mcp-server-ssh` 从单机实验型项目演进为具备生产级容器化能力（v1.2.0）的开源服务，跨平台协作、开源社区贡献与持续集成的工程基建面临以下挑战：
1. **跨平台换行符与格式不一致**：在 Windows 开发环境中执行 Git 操作时易出现 CRLF/LF 换行冲突与告警；
2. **缺乏日常 CI 守护**：此前仅在发布 Git Tag 时触发发版流水线，日常 Push 与外部 PR 缺乏自动化编译、测试与规范检查防护；
3. **缺少标准社区协作模板**：未配置统一的 Issue 缺陷模板、特性建议模板与带自检清单的 PR 审查模板；
4. **容器镜像分发未自动化**：虽然支持 Docker 与 Docker Compose，但尚未构建官方托管镜像，用户需本地编译。

为全面对标 `atengk/oss-template` 标准开源工程基座，我们决定引入以下系统性工程方案：
1. **代码与 Git 规范基建**：引入 `.editorconfig` 锁定编码与缩进规范，引入 `.gitattributes` 强制文本文件 LF 换行归一化；
2. **社区协作契约与模板体系**：引入 `CONTRIBUTING.md` 规范 GitHub Flow 与 Conventional Commits 提交规范；预置 `.github/ISSUE_TEMPLATE/`（Bug 报告、特性建议）与 `.github/PULL_REQUEST_TEMPLATE.md`；
3. **日常持续集成自动化流水线 (`.github/workflows/ci.yml`)**：
   - 启用 `amannn/action-semantic-pull-request` 自动校验 PR 标题规范；
   - 自动运行 `typecheck`、单元与集成测试套件及 `tsup` 生产打包，验证产物完整性；
4. **GHCR 多架构 Docker 镜像自动发布**：在 `.github/workflows/release.yml` 引入 `publish-docker` Job，在打 Tag 时基于 QEMU + Buildx 自动构建 `linux/amd64` 与 `linux/arm64` 双架构镜像并推送至 GitHub Container Registry (`ghcr.io/atengk/mcp-server-ssh`)；
5. **双轨更新日志演进机制**：引入 `.cliff.toml` 作为本地与日常 Conventional Commits 日志提取配置，与人工审核的 `CHANGELOG.md` 协同。

## 权衡考量 (Considered Options)

- **容器镜像仓库选型**：
  - Docker Hub：需要维护专属密钥 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN`，且存在匿名拉取频次限制；
  - GitHub Container Registry (ghcr.io)（已采纳）：直接复用 GitHub Actions 内置的 `GITHUB_TOKEN`，零 Secret 门槛，且与 GitHub 仓库版本原生深度打通。
- **PR 标题与提交规范约束**：
  - 纯人工 Code Review 审查：容易漏网且沟通成本高；
  - 自动化 GitHub Action 拦截（已采纳）：在 PR 发起时即刻校验标题是否符合 Conventional Commits，阻断不合规合并。

## 后果与影响 (Consequences)

- 优势：
  - 彻底杜绝 Windows 与 Linux/macOS 之间的换行符冲突；
  - 为开源贡献者提供了清晰的流程指引与交互模板；
  - 真正实现“一次 Tag 推送，NPM + GitHub Release + 多架构 Docker 镜像全渠道同步交付”；
  - 日常代码合入有严格的自动化测试与类型检查把关。
- 代价：
  - 增加两个 GitHub Actions 工作流配置文件与社区模板，需要长期保持维护；
  - 外部 PR 提交必须遵循严格的 Semantic PR 命名规范。
