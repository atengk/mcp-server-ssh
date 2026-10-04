# 贡献指南 (Contributing Guide)

感谢你关注并愿意为 `@atengk/mcp-server-ssh` 贡献力量！为了保持高效协作与高质量的代码维护，请在提交代码前阅读以下规范。

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
3. **在本地完成开发与验证**：
   ```bash
   # 安装依赖
   pnpm install

   # 静态类型检查
   pnpm run typecheck

   # 运行全量单元与集成测试
   pnpm test

   # 构建单文件产物
   pnpm run build
   ```
4. **提交更改并推送到你的远程分支**：
   ```bash
   git push origin feat/your-feature-name
   ```
5. 在 GitHub 上向本仓库的 `main` 分支发起 **Pull Request**。

---

## 2. Commit 提交信息规范

本项目严格遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范，格式如下：

```text
<type>(<scope>): <subject>
```

### 常用类型说明

| 类型 | 说明 | 示例 |
| :--- | :--- | :--- |
| `feat` | 新增功能或特性 | `feat(transport): 支持轻量 HTTP SSE 远程通信协议` |
| `fix` | 缺陷与 Bug 修复 | `fix(sftp): 修复软链接递归遍历循环引用问题` |
| `docs` | 仅文档更新或修改 | `docs: 完善 12-Factor 环境变量速查矩阵` |
| `style` | 代码格式调整（不影响业务逻辑） | `style: 优化代码排版与导入顺序` |
| `refactor` | 代码重构（非新功能、非修复） | `refactor(server): 引入 Server 工厂模式隔离客户端会话` |
| `perf` | 性能优化 | `perf(exec): 优化登录 Shell 执行流转耗时` |
| `test` | 增加或重构单元测试与集成测试 | `test(credentials): 补充 Base64 编码私钥解析测试用例` |
| `build` | 构建系统、外部依赖或脚手架调整 | `build: 升级 TypeScript 与 tsup 打包配置` |
| `ci` | CI/CD 流水线与 GitHub Actions 脚本修改 | `ci: 集成 PR 标题校验与 GHCR Docker 镜像自动发布` |
| `chore` | 其他琐碎杂项（不改动源码与测试） | `chore: 更新 .editorconfig 与代码规范` |
| `revert` | 恢复或回滚此前的某次历史提交 | `revert: feat(transport): 回退 SSE 端口改动` |

---

## 3. Pull Request 流程

- 发起 PR 时，请按模版完整填写变更背景、解决的问题以及关联的 Issue（如 `close #12`）；
- 确保 CI 流水线测试全部处于通过（绿灯）状态；
- PR 标题必须同样遵循 Conventional Commits 规范，自动化流水线将自动执行校验；
- 代码审查（Code Review）提出修改意见后，在原分支继续提交即可自动同步至 PR；
- PR 合并后，特性分支将被安全删除。

---

## 4. 版本发版机制与发布说明

本项目通过 GitHub Actions 实现了全自动化的 CI/CD 发版体系：

1. **日常质量守护**：推送到 `main` 分支或发起的 PR 会自动触发 `.github/workflows/ci.yml` 运行静态类型检查、测试套件与打包构建；
2. **触发正式发版**：当需要发布新版本时，仅需打上符合语义化版本规范的 Git Tag 并推送：
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
3. **自动化发布流水线**：
   - 自动运行全量类型检查、测试与生产构建；
   - 自动发布至 NPM 官方注册表，并由 GitHub Actions 原生 OIDC 签发不可篡改的 **Provenance 供应链来源证明**；
   - 自动构建 `linux/amd64` 与 `linux/arm64` 多架构 Docker 镜像并推送至 GitHub Container Registry (`ghcr.io/atengk/mcp-server-ssh`)；
   - 由 `git-cliff` 基于 Conventional Commits 自动提取变更日志，创建 GitHub Release 并挂载生产产物附件。

> 💡 **更新日志免维护说明**：
> 本项目**完全无需手动维护 `CHANGELOG.md`**，所有版本的详细变更记录均由 `git-cliff` 依据提交信息自动归纳并发布至 [GitHub Releases](https://github.com/atengk/mcp-server-ssh/releases)。请规范书写提交信息（如 `feat(...)`, `fix(...)`），系统发版时会自动记录并致谢！
