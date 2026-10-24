# 书中人

书中人基于 **Ch1rpy（GitHub：Ch1rpy2613）的 [Mirrai](https://github.com/Ch1rpy2613/Mirrai)** 开发。本基础版取自上游提交 [`162019895b70509f495b406b86e1cd61c08147a5`](https://github.com/Ch1rpy2613/Mirrai/commit/162019895b70509f495b406b86e1cd61c08147a5)。

**Ink & Kin** · *Where ink becomes kin.*

与书中人相识，让故事继续。

## 当前版本

这是 `0.1.0-dev.0` 基础开发快照，尚未正式发布。以核对时的上游最新源码为起点，仅整理产品署名、名称和说明，尚未移植后续扩展模块。上游最新正式发布为 `v1.2.0`，本快照比该发布多一个提交；本项目不继承上游的版本编号。

原有流式对话、角色资料与记忆、模板、角色卡、采集器、渠道和主动提醒等能力来自上述上游版本。后续模块按独立分支适配、验证后合入，以版本标签固定经过验收的源码。具体变更见 [功能与版本记录](FORK_CHANGES.md)。

## 来源与贡献

- 原作者：Ch1rpy / [Ch1rpy2613](https://github.com/Ch1rpy2613)。
- 独立产品后续开发与维护：[lium970320](https://github.com/lium970320)。
- LICENSE 保留原作者 MIT 版权声明，追加行仅覆盖后续修改与新增部分。
- 本仓库使用重新建立的 Git 历史。首个提交是上游源码快照，来源提交通过本文和变更记录保留。
- [上游中文说明](README.upstream.md)、[上游英文说明](README.en.upstream.md) 保留为来源文档；其中版本、安装包和发布链接属于上游项目。

## 源码运行

使用 Node.js 22.12 或更高版本，以及 package.json 固定的 pnpm 10.33.3。安装、构建和数据目录应放在独立本地目录。

1. `corepack pnpm install --frozen-lockfile`
2. 复制 `.env.example` 为 `.env`，配置自己的 PostgreSQL 连接、随机 JWT_SECRET 和所需模型。使用新建独立数据库。
3. 新库先执行 `corepack pnpm db:push` 建立全部表结构。
4. 执行 `node --env-file=.env scripts/migrate.mjs` 应用增量数据迁移；该命令不能替代新库建表。
5. 在 `.env` 中设置 `NODE_ENV=development`，然后开发启动：`node --env-file=.env --import tsx server/_core/index.ts`。
6. 检查：`corepack pnpm check`、`corepack pnpm test`、`corepack pnpm build`。

环境示例采用手动注册。模型、通道与采集器需要单独配置，不随源码提供账号或运行数据。部署到公网前须另行完成部署配置与实际环境验收。

## 已知验证边界

当前仅准备源码基础版。上游桌面安装包和 Docker 的资源打包存在待核对项，暂不作为本项目已验收交付物。迁移脚本的 `--dry-run` 仍可能创建迁移记录表，不能当作零写入检查。具体本地检查结果见版本记录；第三方服务联调需另行验收。
