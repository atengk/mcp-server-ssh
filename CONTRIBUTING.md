# 贡献指南 (Contributing Guide)

感谢你关注并愿意为本项目贡献力量！为了保持高效协作与高质量的代码维护，请在提交代码前阅读以下规范。

---

## 1. 协作与分支模型

本项目遵循标准的 **GitHub Flow** 工作流：

1. **Fork 本仓库** 到你个人的 GitHub 账号；
2. **基于 `main` 分支拉取新的特性分支**：
   ```bash
   git checkout -b feat/your-feature-name
   # 或者缺陷修复分支
   git checkout -b fix/issue-description
   ```
3. 在本地完成修改，确保自测通过并补充相应测试用例；
4. 提交更改并推送到你的远程分支：
   ```bash
   git push origin feat/your-feature-name
   ```
5. 在 GitHub 上向本仓库的 `main` 分支发起 **Pull Request**。

---

## 2. Commit 提交信息规范

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范，统一采用以下格式：

```text
<type>(<scope>): <subject>
```

### 常用类型说明

| 类型 | 说明 | 示例 |
| :--- | :--- | :--- |
| `feat` | 新增功能或特性 | `feat(auth): 支持 OAuth2 登录授权` |
| `fix` | 缺陷与 Bug 修复 | `fix(parser): 修复空字符串解析导致空指针的问题` |
| `docs` | 仅文档更新或修改 | `docs: 完善快速开始与环境配置文档` |
| `style` | 代码格式调整（空格、分号等，不影响逻辑） | `style: 优化代码排版与换行` |
| `refactor` | 代码重构（既非新增特性也非修复缺陷） | `refactor(core): 抽取公共工具类` |
| `perf` | 性能优化 | `perf(cache): 引入本地二级缓存提升吞吐量` |
| `test` | 增加或重构单元测试与集成测试 | `test: 补充用户服务边界条件测试用例` |
| `build` | 构建系统、外部依赖或脚手架调整 | `build: 升级依赖版本至最新稳定版` |
| `ci` | CI/CD 流水线与 GitHub Actions 脚本修改 | `ci: 优化 release 自动化发版流程` |
| `chore` | 其他琐碎杂项（不改动源码与测试） | `chore: 更新 .gitignore 忽略规则` |
| `revert` | 恢复或回滚此前的某次历史提交 | `revert: feat(auth): 回退登录授权变动` |

### 🛡️ 本地 Git 提交钩子守门 (Git Hooks)

本项目通过 Git 原生钩子 [`.githooks/commit-msg`](./.githooks/commit-msg) 在本地提交阶段实时校验信息格式，零额外运行时依赖：
- **一键激活**：运行 `npm run setup`（或 `bash scripts/setup.sh`）即可自动激活；亦可在根目录手动执行：
  ```bash
  git config core.hooksPath .githooks
  ```
- **智能放行**：自动放行分支合并 (`Merge branch...`)、代码回退 (`Revert "..."`) 以及变基临时提交 (`fixup!` / `squash!`)；
- **错误引导**：若提交信息不符合规范，钩子将中断提交、高亮输出格式诊断，并引导使用规范化提交工具。

### 💡 推荐：使用规范化提交助手

本项目内置了 POSIX Bash 编写的提交助手 [scripts/commit.sh](./scripts/commit.sh)，同时支持**人工交互式向导**与 **AI / 自动化非交互式调用**：

#### 方式 A：交互式向导模式（适合日常开发）
通过编号菜单引导选择类型、输入范围与描述，自动组装符合规范的提交信息并支持一键推送（输入 `0` 或 `q` 可随时退出）：
```bash
# 推荐使用 npm 快捷命令（跨平台统一）
npm run commit

# 或在 Linux / macOS / Windows Git Bash 中直接运行
bash scripts/commit.sh
```

#### 方式 B：非交互式命令行模式（适合 AI Agent / 自动化脚本）
支持通过标准命令行参数一键组装 Conventional Commit 并推送到远端，无需任何键盘等待交互（推荐先使用 `git add <file>` 显式安全暂存目标文件）：
```bash
# 标准规范化提交并自动推送 (推荐先显式精准暂存)
git add <file-path>
bash scripts/commit.sh -t feat -s core -m "新增用户认证能力" -p -y

# 修复 Bug 且不自动推送
git add <file-path>
bash scripts/commit.sh -t fix -s parser -m "修复空指针异常" -y

# 标记破坏性更新 (Breaking Changes)
git add <file-path>
bash scripts/commit.sh -t feat -s api -m "重构对外接口协议" -b -p -y
```

| 参数选项 | 说明 |
| :--- | :--- |
| `-t, --type <type>` | 提交类型 (`feat\|fix\|docs\|style\|refactor\|perf\|test\|build\|ci\|chore\|revert`) |
| `-s, --scope <scope>` | 可选影响范围（如 `core`、`cli`、`api` 等） |
| `-m, --message <msg>` | 提交主体描述（必填，简明扼要） |
| `-b, --breaking` | 标记为破坏性更新（自动追加 `!` 标识） |
| `-a, --all` | 自动暂存全部已修改及未跟踪文件（相当于 `git add -A`，请谨慎使用） |
| `-p, --push` | 提交成功后自动推送至当前分支远程仓库 |
| `-y, --yes` | 跳过确认提示直接执行提交 |
| `-h, --help` | 查看详细帮助说明 |

> 💡 **Windows 终端提示**：无论使用 PowerShell 还是 CMD，只要系统安装了 Git，运行 `npm run commit` 或 `bash scripts/commit.sh` 均可顺畅执行。

---

## 3. Pull Request 流程

- **PR 标题规范**：PR 标题必须同样遵循 [Conventional Commits](#2-commit-提交信息规范) 格式（如 `feat: 新增能力` 或 `fix: 修复缺陷`），CI 会对其进行自动化合规校验；
- **模版填写**：发起 PR 时，请按模版完整填写变更背景、解决的问题以及关联的 Issue（如 `close #12`）；
- **CI 绿灯**：确保 CI 流水线测试全部处于通过状态；
- **审查与合并**：代码审查（Code Review）提出修改意见后，在原分支继续提交即可自动同步至 PR；合并后特性分支将被删除；
- **推荐合并方式**：仓库推荐采用 **Squash and merge（压缩合并）**，合入时自动采用合规的 PR 标题作为主干提交信息，保证 Release 变更日志 100% 精确。

---

## 4. 版本发版机制与流水线说明

本项目基于现代化的 **Node.js 二元流水线** 实现了全自动化质量门禁与发版分发：
- **通道一（推荐首选，零本地脚本依赖）**：在 GitHub 仓库 Actions 界面通过 `workflow_dispatch` 手动输入目标版本号一键触发发版；
- **通道二（进阶发版向导）**：在本地使用 `npm run release`（或 `bash scripts/release.sh`），完成 5 重防呆自检并自动递增 `package.json` 版本；
- **通道三（纯原生 Git）**：在本地通过原生 `git tag` & `git push` 命令触发发版流水线。

---

### 🌐 方式一：GitHub Actions 网页端云端调度发版 (推荐首选)

若维护者未在本地配置终端发版环境，可直接在 GitHub 网页端一键触发：
1. 前往 GitHub 仓库页面，点击顶部 **Actions** 标签页；
2. 在左侧选择 **Release & Publish** 流水线；
3. 点击右侧蓝色的 **Run workflow** 下拉按钮；
4. 在 **发布版本号** 输入框中填入目标版本号（如 `v1.2.6`）；
5. 点击绿色 **Run workflow** 按钮启动流水线。

GitHub Actions 将自动执行语义化版本格式校验、触发分支保护检查（阻断非 main 分支误触），在当前主干提交创建并推送附注 Git Tag，随后自动触发全套构建、测试与发布流程。

---

### 🛠️ 方式二：使用本地发版防呆向导 (推荐日常使用)

面向终端用户，项目提供了具备 5 重前置防呆自检的 POSIX Bash 发版向导 [scripts/release.sh](./scripts/release.sh)。它能够自动校验当前是否处于 `main` 分支、工作区是否干净无未提交代码、本地与远端提交是否一致、目标 Tag 是否重名冲突，并在确认后自动执行 `npm version <new_version> --no-git-tag-version` 同步更新 `package.json` 中的版本字段：

```bash
# 1. 安全演练模式（强烈推荐在正式发版前演练，只检查并打印拟执行动作，零污染 Git 历史）
npm run release -- --dry-run
# 或直接运行脚本
bash scripts/release.sh --dry-run
bash scripts/release.sh v1.2.6 --dry-run

# 2. 交互式向导发版（自动提取最新 Tag，引导选择 Patch / Minor / Major，输入 0 可随时退出）
npm run release

# 3. 指定版本号快速发版（可追加 -y 跳过交互确认，适合 AI Agent / CI 流水线静默执行）
bash scripts/release.sh v1.2.6
bash scripts/release.sh v1.2.6 -y
```

> 💡 **Windows 终端提示**：无论使用 PowerShell 还是 CMD，只要系统安装了 Git，运行 `npm run release` 或 `bash scripts/release.sh` 均可顺畅执行。

---

### 🏷️ 方式三：原生 Git 命令行手动打标触发 (纯原生)

若偏好纯手动操作，可按照标准步骤在本地打标并推送：

```bash
# 步骤 A：确保本地最新代码已推送到 main 分支且工作区干净
git checkout main
git pull origin main
git push origin main

# 步骤 B：打附注版本标签并推送到 GitHub (支持 v1.2.6, v1.3.0 等)
git tag -a v1.2.6 -m "Release v1.2.6"
git push origin v1.2.6
```

---

### ⚙️ 二元流水线自动化运行机制

#### 1. 持续集成流水线 ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml))
- **触发时机**：主干 Push 与针对 `main` 的 Pull Request；
- **Path Fast-Pass 短路加速**：当且仅当修改纯文档（`*.md`、`docs/**`）时，自动跳过冗长编译与容器测试，实现秒级放行；
- **Node.js 兼容性矩阵**：在 PR 阶段使用 Node 20 快速验证；在主干合并阶段启动 Node.js 18、20、22 跨版本矩阵全面测试；
- **全绿终审门禁**：通过统一汇总 Job `all-checks-passed` 作为分支合并保护规则的唯一必选检查点。

#### 2. 发版与分发流水线 ([`.github/workflows/release.yml`](./.github/workflows/release.yml))
- **触发时机**：推送符合 `v*.*.*` 格式的 Git Tag，或通过 `workflow_dispatch` 手动触发；
- **不可变单次构建**：严格在独立构建任务中编译 Bundle，跨任务传递不可变制品，严禁二次构建引入状态漂移；
- **自动签名校验**：自动生成 `checksums.txt`（包含打包产物的 SHA-256 签名）；
- **git-cliff 变更日志**：基于 Conventional Commits 自动提取版本间提交，智能归类特性、缺陷修复与破坏性变更，关联 PR 链接与新贡献者致谢；
- **自动 npm 发布**：当配置了 `NPM_TOKEN`（或 OIDC Trusted Publishing）且环境变量 `ENABLE_NPM_PUBLISH` 为 true 时，自动发布至 npm 官方注册表；
- **多架构容器镜像**：自动构建 `linux/amd64` 与 `linux/arm64` 双架构 Docker 镜像，并推送至 GitHub Container Registry (`ghcr.io/atengk/mcp-server-ssh`)；
- **GitHub Step Summary 直出**：在 Actions 运行页面直出版本发版看板与校验和摘要。

> 💡 **安全校验和 (SHA-256 Checksums) 验证指引**：
> 下游用户下载 Release 附件产物与 `checksums.txt` 后，可在终端通过原生命令一键验证完整性：
> - **Linux**：`sha256sum -c checksums.txt --ignore-missing`
> - **macOS**：`shasum -a 256 -c checksums.txt`
> - **Windows (PowerShell)**：`Get-FileHash .\dist-assets.tar.gz -Algorithm SHA256`

---

### 🔐 中心仓库发布凭据 (Secrets) 参考

如需发布至 npm 或外部容器仓库，请在仓库的 **Settings -> Secrets and variables -> Actions** 中配置对应凭据与变量：

- **npm 官方注册表**:
  - **推荐方式**：配置 [npm Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers)，实现零静态 Token 密钥安全发布；
  - **经典方式**：在 Secrets 中配置 `NPM_TOKEN`；
  - **开关变量**：在 Variables 中配置 `ENABLE_NPM_PUBLISH: "true"`（未配置时默认跳过 npm 发布，仅生成 GitHub Release 附件与容器镜像）；
- **GitHub Container Registry (GHCR 镜像)**:
  - 默认直接使用流水线内置的 `GITHUB_TOKEN`，自动发布至 `ghcr.io/<owner>/mcp-server-ssh`，**零外部 Secret 配置**；
- **Docker Hub (可选扩展)**:
  - 若需同步发布至 Docker Hub，可在 Secrets 中配置 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN`。

