# 0016. 全面集成 oss-template 工业级开源工程基建与 Apache-2.0 协议切换架构

## 背景与决策 (Context & Decision)

随着 `@atengk/mcp-server-ssh` 演进为涵盖 29 项原子工具的大型复杂 MCP 服务基础设施，其原有的简易 CI/CD 流水线与单一开源治理配置已无法满足现代化开源社区的高标准需求。同时，维护团队在标准化开源模版仓库 [`atengk/oss-template`](https://github.com/atengk/oss-template) 中已沉淀出工业级的全自动流水线、不可变制品发版机制与社区治理规范。

为此，我们做出如下架构决策：**全面智能集成 `oss-template` 标准开源工程基建体系，并将开源许可协议正式切换为 Apache License 2.0**：

1. **开源许可证全链路迁移至 Apache-2.0**：
   - 将根目录 `LICENSE` 替换为标准的 Apache License Version 2.0 完整文本，明确专利授权条款与责任限制；
   - 同步将 `package.json` 的 SPDX 声明由 `"license": "MIT"` 升级为 `"license": "Apache-2.0"`；
   - 更新 `README.md` 顶部徽章与文末许可证声明，实现版权元数据 100% 自洽。
2. **落地生产级二元 CI/CD 流水线 (Binary CI/CD Workflow)**：
   - **持续集成门禁 (`.github/workflows/ci.yml`)**：
     - **动态并发控制 (Concurrency)**：PR 推送自动取消陈旧构建以节约算力，主干提交顺序排队；
     - **路径短路直通网关 (Path Fast-Pass)**：纯文档（`*.md`、`docs/**`）与配置文件变动秒级自动通过，彻底规避 GitHub 分支保护规则死锁；
     - **分层跨版本矩阵测试**：PR 阶段针对 Node.js 20 LTS 极速验证，主干阶段全量运行 Node.js 18/20/22 兼容性矩阵；
     - **质量终审看板 (All Checks Passed)**：集中汇总 PR 语义标题校验、语法类型检查与单元测试，通过 `$GITHUB_STEP_SUMMARY` 直出结构化报表。
   - **统合发版编排流水线 (`.github/workflows/release.yml`)**：
     - **质量门禁前置拦截 (Gate Test)**：打标或云端调度发版前必须全量回归测试通过方可流转；
     - **单次编译打包不可变制品 (Build Once)**：一次性构建产物并生成 `dist/*.tgz` 与 `checksums.txt`（SHA-256 哈希清单）；
     - **多路并行安全分发**：GitHub Release 发版（基于 `git-cliff` 自动提取结构化更新日志）、npm 官方源安全发布（支持 OIDC 与 Token 双模式分流）及 Docker 多架构（linux/amd64 与 linux/arm64）镜像构建并推至 GHCR。
3. **社区治理矩阵与辅助工程脚本无损缝合**：
   - 引入 `CODE_OF_CONDUCT.md`（行为准则）与 `SECURITY.md`（漏洞协同披露政策）；
   - 升级 `.github/dependabot.yml`，对 npm 依赖与 GitHub Actions 版本实施双生态月度自动化安全巡检；
   - 引入 `.github/CODEOWNERS`，实现关键代码路径审阅者自动指派；
   - 引入 `.github/ISSUE_TEMPLATE/` 结构化表单（`bug_report.yml`, `feature_request.yml`, `config.yml`）与规范的 `PULL_REQUEST_TEMPLATE.md`；
   - 引入原生 Git 提交守门钩子 `.githooks/commit-msg`（零外部依赖），并在 `scripts/release.sh` 中解除 Node.js 版本号递增命令；
   - 对齐 `.cliff.toml`，支持破坏性更新独立分组与可选标签正则。

## 权衡考量 (Considered Options)

- **关于开源许可证选型 (MIT vs. Apache-2.0)**：
  - 选项 1：保持 MIT License。简单轻量，但缺乏明确的专利交叉授权保护与商标保护条款，与团队开源规范不一致。
  - 选项 2：全链路切换为 Apache License 2.0（已采纳）。与 `oss-template` 模板基线完全统一，明确授予专利使用权并包含防御性专利诉讼终止条款，为企业与个人使用者提供更高的法律确定性与合规保障。
- **关于工作流引入方式**：
  - 选项 1：直接复制 `oss-template` 根目录工作流。根目录工作流仅为脚手架自测 Shell 脚本，缺少 Node.js 项目所需的依赖安装、类型检查与包发布逻辑（反模式）。
  - 选项 2：按需从 `.github/workflow-templates/languages/node/` 提取专属流水线（已采纳）。完全适配 Node.js / pnpm / TypeScript 构建流程，针对性定制 npm 与 Docker GHCR 自动化发布。

## 后果与影响 (Consequences)

- 优势：
  - 项目具备世界级顶级开源项目的工程化底座，PR 审查与发版流程高度自动化且零人工手工疏漏风险；
  - 路径短路直通极大缩减纯文档修改时的 CI 等待时长与算力消耗；
  - 法律合规声明更加严谨健全，社区参与者拥有明确的行为准则、安全披露通道与 Issue 提交引导。
- 代价：
  - 引入了 `scripts/` 与 `.githooks/` 目录，需维护额外的 Bash 脚本资产（均已配备语法自检与跨平台兼容）。
