# 书中人 · Ink & Kin

> 与书中人相识，让故事继续。

书中人是一款可以自行托管的 AI 角色对话和故事共创应用。你可以为喜欢的作品创建角色，录入角色设定、上传作品原文，再用自己配置的模型和角色聊日常、演一段情节，或让多个角色在同一个频道里接续故事。

[English](README.en.md) · [界面预览](#界面预览) · [源码运行](#源码运行) · [版本标签](https://github.com/lium970320/ink-and-kin/tags)

## 能做什么

- **创建角色并持续聊天。** 可以编辑角色资料和说话风格，也可以导入 PNG 角色卡。对话支持流式回复、按日期回看和按天生成日记。提取的候选记忆可以先审阅，再决定哪些保留给后续对话。
- **对照原文聊作品。** 原文库支持 TXT、Markdown 和 EPUB。你可以搜索情节、人物或关键词，查看命中的片段和出处。对话也能参考相关原文，检索默认在本机完成。
- **在场景和角色频道里写故事。** 情境剧场可用独立上下文来演绎一段设定或情节。多人角色频道让多个角色围绕同一个故事轮流发言。
- **按需接入模型和消息渠道。** 在设置页可配置模型和中转站、测试连接、查看调用记录。绑定自备的 OneBot 服务后，可以在指定的 QQ 私聊使用角色。还可以按需配置场景配图、录音转写或定时回访。

## 界面预览

准备 Node.js 22.12 或更新版本和 Corepack。克隆仓库后，在项目目录执行以下命令。Corepack 会使用项目固定的 pnpm 10.33.3。

```sh
git clone https://github.com/lium970320/ink-and-kin.git
cd ink-and-kin
corepack pnpm install --frozen-lockfile
corepack pnpm preview:ui:build
corepack pnpm preview:ui
```

打开 [本机界面预览](http://127.0.0.1:4173/)，可以用合成数据查看大厅、聊天、情境剧场和角色频道。预览为只读，使用示例数据代替数据库和模型服务。可通过 `UI_PREVIEW_PORT` 更换预览端口。

## 源码运行

1. 将源码克隆或解压到本机目录，使用 Node.js 22.12 或更新版本和 Corepack 执行 `corepack pnpm install --frozen-lockfile`。 [源码快照](https://github.com/lium970320/ink-and-kin/tags)
2. 创建一个独立的 PostgreSQL 数据库，将 `.env.example` 另存为 `.env`。填好 `DATABASE_URL` 和随机生成的 `JWT_SECRET`，并设置 `NODE_ENV=production`。生成密钥可运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`。 [配置示例](.env.example)
3. 在项目目录建表、迁移并启动。升级已有数据库前请先备份。

   ```sh
   corepack pnpm db:push
   node --env-file=.env scripts/migrate.mjs
   corepack pnpm build
   node --env-file=.env dist/index.js
   ```

4. 打开 [本机书中人](http://127.0.0.1:3000/)。空库首次启动会创建账号 `admin`，随机密码写入启动日志指向的 `first-run-credentials.txt`。登录后请修改密码并清理首次凭据文件。
5. 在「用户中心 → AI 设置」添加模型并测试连接，再到大厅创建角色。支持 OpenAI 兼容服务、Claude 和 Ollama 等。自建模型或中转站的来源需加入 `LLM_ALLOWED_ORIGINS` 后重启应用。例如在变量中加入 `https://relay.example.com`，再在设置页填完整地址 `https://relay.example.com/v1`。

默认仅监听 `127.0.0.1`，注册默认关闭。需要为受信任的用户创建账号时，可在本机临时设置 `ALLOW_REGISTRATION=true` 并重启，注册完成后改回 `false` 并再次重启。单用户实例可以在注册关闭时显式设置 `LLM_ALLOW_SERVER_FALLBACK=true`，使用进程环境中的模型配置。

### 可选配置

| 功能 | 从哪里配置 |
| --- | --- |
| QQ 私聊 | 在「用户中心 → QQ」填写已登录的 OneBot HTTP 服务地址、机器人 QQ 号和事件签名密钥。将保存后生成的事件上报地址填到 OneBot，随后绑定目标私聊与角色。 |
| 场景配图和录音转写 | 在 AI 设置中分别配置所需服务。场景配图由用户手动触发。 [场景配图配置](BATCH8B.md#配置) |
| 定时问候和回访 | 在角色编辑页的「行为」中启用主动消息，并设置问候或回访的时间和内容。 |
| 原文库向量检索与重排 | 在 `.env` 中配置可选服务，用于用户主动搜索原文。 [配置项](.env.example) |

## 隐私

对话、设置和素材保存在你部署的数据库与文件目录。使用云端模型或可选渠道时，相关消息、角色资料、原文片段或媒体会按功能发送给你选用的服务。自行导入的角色和素材由各实例的使用者管理。 [安全与隐私说明](SECURITY.md)

## 开发与版本

前端使用 React 和 Vite，位于 `client/`。服务端使用 Express 和 tRPC，位于 `server/`。PostgreSQL 表结构及 SQL 迁移在 `drizzle/`，合成演示数据和预览入口在 `preview/`。

开发时将 `.env` 中的 `NODE_ENV` 设为 `development`，用 `node --env-file=.env --import tsx server/_core/index.ts` 启动开发服务。运行以下命令检查类型和执行测试。

```sh
corepack pnpm check
corepack pnpm test
```

最新源码发布在 `main`，源码快照用 Git 标签固定。 [功能与版本记录](FORK_CHANGES.md) · [公开快照标签](https://github.com/lium970320/ink-and-kin/tags) · [问题反馈](https://github.com/lium970320/ink-and-kin/issues)

## 来源与许可证

书中人基于 Ch1rpy（GitHub 用户名 Ch1rpy2613）的 Mirrai 开发，由 lium970320 继续维护。书中人的 Git 历史从上游提交 `162019895b70509f495b406b86e1cd61c08147a5` 的源码快照建立。 [Mirrai](https://github.com/Ch1rpy2613/Mirrai) · [上游基线提交](https://github.com/Ch1rpy2613/Mirrai/commit/162019895b70509f495b406b86e1cd61c08147a5)

项目采用 MIT 许可证，保留原作者版权声明，并标记后续修改与新增部分。上游版本和安装包信息保留在上游说明中。 [MIT 许可证](LICENSE) · [上游中文说明](README.upstream.md) · [上游英文说明](README.en.upstream.md)
