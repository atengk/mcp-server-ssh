# 问题跟踪器规范：GitHub Issues

本项目的所有需求、Issue、Spec 与任务卡片均统一托管于 GitHub Issues。所有 Agent 工具链一律通过系统 `gh` CLI 进行操作。

## 常用操作契约

- **创建 Issue**：`gh issue create --title "..." --body "..."`（多行正文请使用多行字符串或 Heredoc 格式）。
- **读取 Issue 详情与评论**：`gh issue view <编号> --comments`（配合 `jq` 解析并抓取标签）。
- **列表检索**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`（配合适当的 `--label` 与 `--state` 过滤）。
- **追加评论**：`gh issue comment <编号> --body "..."`
- **编辑标签**：`gh issue edit <编号> --add-label "..."` / `--remove-label "..."`
- **关闭 Issue**：`gh issue close <编号> --comment "..."`

仓库地址由本地克隆工作区通过 `git remote -v` 自动推断，无需硬编码所有者与仓库名。

## PR 作为分流需求面

**外部 PR 作为需求收集面：否 (no)**。（若未来开启外部 PR 分流，可置为 `yes`，`/triage` 技能将自动拉取外部 PR 进入分流队列）。

当设置为 `yes` 时，PR 遵循与 Issue 相同的标签流转与状态规范，采用等价的 `gh pr` 命令族：
- **查看 PR**：`gh pr view <编号> --comments` 与 `gh pr diff <编号>` 获取变更对比。
- **列出待分流外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的条目。
- **评论 / 标签 / 关闭**：对应 `gh pr comment`、`gh pr edit` 与 `gh pr close`。

注意：GitHub 在 Issue 与 PR 之间共享统一编号空间（例如 `#42` 可能为 Issue 亦可能为 PR），解析时可优先尝试 `gh pr view 42`，失败后回退至 `gh issue view 42`。

## 技能约定

- 当技能指明“发布到问题跟踪器”时：执行创建 GitHub Issue。
- 当技能指明“提取对应工单/Ticket”时：执行 `gh issue view <编号> --comments`。

## 路径规划与依赖链路 (Wayfinder)

用于 `/wayfinder` 技能联动。**路线图 (Map)** 为带有 `wayfinder:map` 标签的全局父级 Issue，各分支子任务作为关联 Ticket。

- **路线图 (Map)**：独立全局 Issue，标记标签 `wayfinder:map`，正文包含背景备忘（Notes）、既定决策（Decisions-so-far）与迷雾区（Fog）。执行命令：`gh issue create --label wayfinder:map`。
- **子任务卡片 (Child ticket)**：通过 GitHub 原生 Sub-issue 或关联任务列表挂载到 Map 上的子 Issue，顶部注明 `Part of #<map编号>`，标签形如 `wayfinder:<类型>`（`research` / `prototype` / `grilling` / `task`）。被认领后指派给当前开发者。
- **阻塞依赖关系 (Blocking)**：使用 GitHub 原生 Issue 依赖机制。通过 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 建立依赖关系。若依赖 API 不可用，则在子 Issue 顶部回退使用文本行 `Blocked by: #<n>, #<m>` 标注。
- **前沿就绪查询 (Frontier query)**：列举当前 Map 下所有处于 open 状态的子任务，过滤剔除存在未关闭阻塞项或已被指派的条目，首个条目即为当前前沿任务。
- **任务认领 (Claim)**：执行 `gh issue edit <编号> --add-assignee @me` 标志认领开始。
- **任务闭环 (Resolve)**：执行 `gh issue comment <编号> --body "<解答/交付摘要>"`，然后 `gh issue close <编号>`，最后将决策指针同步追加至 Map Issue 的既定决策记录中。
