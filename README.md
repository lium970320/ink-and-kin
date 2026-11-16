# 书中人 · Ink & Kin

书中人基于 **Ch1rpy（GitHub：Ch1rpy2613）的 [Mirrai](https://github.com/Ch1rpy2613/Mirrai)** 开发。本基础版取自上游提交 [`162019895b70509f495b406b86e1cd61c08147a5`](https://github.com/Ch1rpy2613/Mirrai/commit/162019895b70509f495b406b86e1cd61c08147a5)。

**Ink & Kin** · *Where ink becomes kin.*

与书中人相识，让故事继续。

书中人是一款可以自行托管的角色对话和故事共创应用。它支持流式聊天、可审阅的角色记忆、原文库检索、场景、多人角色频道，以及可选的 QQ 私聊接入。

公开快照以 Git 标签固定，可供下载源码。也可以使用合成数据体验 [只读界面预览](UI-SNAPSHOT.md)。 [版本标签](https://github.com/lium970320/ink-and-kin/tags) · [功能与版本记录](FORK_CHANGES.md)

## 来源与贡献

- 原作者：Ch1rpy / [Ch1rpy2613](https://github.com/Ch1rpy2613)。
- 独立产品后续开发与维护：[lium970320](https://github.com/lium970320)。
- LICENSE 保留原作者 MIT 版权声明，追加行仅覆盖后续修改与新增部分。
- 本仓库使用重新建立的 Git 历史。首个提交是上游源码快照，来源提交通过本文和变更记录保留。
- [上游中文说明](README.upstream.md)、[上游英文说明](README.en.upstream.md) 保留为来源文档；其中版本、安装包和发布链接属于上游项目。

## 源码运行

准备 Node.js 22.12 或更新版本、Corepack（用于运行项目固定的 pnpm 10.33.3）和一个独立的 PostgreSQL 数据库。请在本机目录解压或克隆源码。

1. 执行 `corepack pnpm install --frozen-lockfile`。
2. 将 `.env.example` 另存为 `.env`，填好 `DATABASE_URL` 和随机生成的 `JWT_SECRET`，并设置 `NODE_ENV=production`。生成密钥可运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`。
3. 执行 `corepack pnpm db:push` 建表或同步表结构，再运行 `node --env-file=.env scripts/migrate.mjs` 执行数据迁移。升级已有库前先备份。
4. 执行 `corepack pnpm build`，然后运行 `node --env-file=.env dist/index.js`。
5. 打开 [本机书中人](http://127.0.0.1:3000/)。空库会自动创建首个账号 `admin`，随机密码写入启动日志指向的 `first-run-credentials.txt`。登录后请修改密码并清理首次凭据文件。
6. 在「设置 → AI 设置」添加自己的模型服务并测试连接。内置提供商支持其默认 API 来源。使用自建模型或中转站时，将信任的来源加入 `LLM_ALLOWED_ORIGINS` 后重启应用，例如 `https://relay.example.com` 或 `http://127.0.0.1:11434`。设置页仍填写完整 API 地址，例如 `https://relay.example.com/v1`。

源码运行默认只监听 `127.0.0.1`，注册默认关闭。要为受信任的人创建账号，可以在本机临时设置 `ALLOW_REGISTRATION=true`，重启后完成注册，再关闭该开关并重启。单用户部署如果要使用进程环境中的模型配置，可在注册关闭时显式设置 `LLM_ALLOW_SERVER_FALLBACK=true`。

开发时可把 `.env` 中的 `NODE_ENV` 改为 `development`，再运行 `node --env-file=.env --import tsx server/_core/index.ts`。运行 `corepack pnpm check` 和 `corepack pnpm test` 可检查类型及测试。

## 隐私

对话、素材和设置保存在你部署的数据库和文件目录。使用云端模型或可选的渠道及生成服务时，相关对话、角色资料、检索片段或图片会按功能发给所选服务。详细范围见 [安全与隐私说明](SECURITY.md)。

自行导入的角色和素材由各实例的使用者管理。
