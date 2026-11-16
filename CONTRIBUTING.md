# 贡献指南

欢迎为书中人贡献代码、文档和问题反馈。

## 开始之前

- 从 [项目介绍](README.md) 了解功能，并在 [Issues](https://github.com/lium970320/ink-and-kin/issues) 查看书中人现有的问题与建议。
- 引入第三方代码或素材时，请附上来源与许可，并保留原有版权声明。 [版权与第三方许可](docs/attribution.md)

## 开发环境搭建

按项目说明安装依赖、配置本机数据库和启动应用。开发模式及测试命令位于 README 的开发小节。 [源码运行](README.md#源码运行) · [开发与版本](README.md#开发与版本)

## 提交 Pull Request

1. 从自己的派生仓库的 `main` 创建工作分支。
2. 确保以下命令通过：
   ```bash
   pnpm check   # TypeScript 类型检查
   pnpm test    # 单元测试
   ```
3. 向书中人的 `main` 提交 PR，并说明改动内容、原因及验证方式。

### 代码约定

- TypeScript 全覆盖，不引入 `any`（类型定义文件除外）
- 新增 LLM 提供商优先复用 `OpenAIProvider`（OpenAI 兼容协议）
- 涉及情感状态的改动请同步更新 `computeEmotionalState()` 和前端 UI 配置

### 提交信息

- **不要添加 `Co-Authored-By` trailer。** 本仓库的每个提交只署名提交人本人，不把 AI 助手列为共同作者。仓库内置了 `commit-msg` 钩子来强制这条规则，带该 trailer 的提交会被拒绝。

  克隆后启用钩子：

  ```bash
  git config core.hooksPath .githooks
  ```

- **Squash 合并时记得关掉 "Include contributors"。** GitHub 的 "Squash and merge" 默认勾选该选项，会自动在提交信息末尾追加 `Co-authored-by: <用户名>` 行，和上面的规则冲突。合并前取消勾选，或合并后手动删掉那一行。


## 提交 Issue

- 🐛 Bug 报告请使用 [Bug 模板](.github/ISSUE_TEMPLATE/bug_report.md)，附上复现步骤和日志
- 💡 功能建议请使用 [功能模板](.github/ISSUE_TEMPLATE/feature_request.md)
- 🔒 安全漏洞**不要**开公开 issue，请按 [SECURITY.md](SECURITY.md) 私下报告

## 行为准则

友善、尊重。这里处理的是感情话题，请对所有人的故事保持善意。
