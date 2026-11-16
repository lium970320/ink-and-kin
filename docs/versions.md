# 版本与快照

`main` 是书中人的开发主线。快照用 Git 附注标签固定在对应提交，下文记录已公开的标签及其用途。 [GitHub 标签列表](https://github.com/lium970320/ink-and-kin/tags)

## 2026-11-16 Mirrai 界面与手机直连快照

`snapshot/mirrai-lan-20261116` 同步台式机 Mirrai 的「手机直连」设置、聊天档案分区和 Android 客户端。新增局域网发现、配对、设备撤销与实时消息。聊天档案按日常和场景浏览，并沿用书中人的记忆审核流程。 [浏览快照](https://github.com/lium970320/ink-and-kin/tree/snapshot/mirrai-lan-20261116) · [下载 ZIP](https://github.com/lium970320/ink-and-kin/archive/refs/tags/snapshot/mirrai-lan-20261116.zip) · [安装与配对](mobile-lan.md)

## 2026-11-16 灯下书房设计快照

`snapshot/ui-design-20261116` 收录「灯下书房」界面方案和交互原型。下载 ZIP 并解压后，用浏览器打开 `docs/ui-redesign/preview.html`，可体验两套色板、明暗切换和聊天排版。设计处于提案阶段，原型使用虚构示例。 [浏览快照](https://github.com/lium970320/ink-and-kin/tree/snapshot/ui-design-20261116) · [下载 ZIP](https://github.com/lium970320/ink-and-kin/archive/refs/tags/snapshot/ui-design-20261116.zip) · [设计方案](ui-redesign/UI重构方案.md)

本地 Chrome 验证覆盖明暗与色板切换、聊天排版和模拟回复。360 px 宽的视口中，书页插画存在横向溢出。

## 2026-11-16 公开源码快照

`snapshot/public-20261116-r2` 包含从 Mirrai 同步的界面、检索、模型工具和 QQ 私聊改进，以及书中人自托管和数据流向说明。相比初版，`r1` 修订了 GitHub CI 的数据库结构检查，`r2` 恢复了原有的私聊提示词和角色频道行为。 [浏览源码](https://github.com/lium970320/ink-and-kin/tree/snapshot/public-20261116-r2) · [下载 ZIP](https://github.com/lium970320/ink-and-kin/archive/refs/tags/snapshot/public-20261116-r2.zip) · [运行说明](../README.md#源码运行)

`r2` 本机通过 1173 项测试，另有 56 项条件测试跳过。类型检查、生产构建和 GitHub CI 通过。此前 `r1` 的启动验收覆盖独立数据库、首次登录和模型探测，采用隔离环境与模拟服务。 [r2 CI](https://github.com/lium970320/ink-and-kin/actions/runs/43839189470) · [公开快照的开发记录](history/FORK_CHANGES.md#2026-11-16-公开源码快照)

## 已公开标签

| 标签 | 提交 | 主要内容 |
| --- | --- | --- |
| [`snapshot/public-20261116-r2`](https://github.com/lium970320/ink-and-kin/tree/snapshot/public-20261116-r2) | `54d251a` | 恢复原有私聊提示词与角色频道行为，修订相关文档。 |
| [`snapshot/public-20261116-r1`](https://github.com/lium970320/ink-and-kin/tree/snapshot/public-20261116-r1) | `91fa4cb` | CI 直接比较重复建表前后的 PostgreSQL 结构。 |
| [`snapshot/public-20261116`](https://github.com/lium970320/ink-and-kin/tree/snapshot/public-20261116) | `f8134e2` | 11 月 16 日同步初版，合入界面诊断、原文和记忆检索、模型工具及 QQ 改进。 |
| [`snapshot/ui-refresh-20261112`](https://github.com/lium970320/ink-and-kin/tree/snapshot/ui-refresh-20261112) | `4f5216c` | 界面色板、布局和动效更新，包含第 8B 批场景配图。 |
| [`snapshot/batch8a-20261106`](https://github.com/lium970320/ink-and-kin/tree/snapshot/batch8a-20261106) | `1da1217` | 录音转写、受控音频转码、可选朗读及 QQ 入站语音。 |
| [`snapshot/batch7-20261106`](https://github.com/lium970320/ink-and-kin/tree/snapshot/batch7-20261106) | `ee14206` | 主动消息、回访、临时角色状态及提醒投递记录。 |
| [`snapshot/batch6b-20261106`](https://github.com/lium970320/ink-and-kin/tree/snapshot/batch6b-20261106) | `66f629d` | QQ 角色频道逐拍投递、原文重发和发送已有图片。 |
| [`snapshot/batch6a-20261106`](https://github.com/lium970320/ink-and-kin/tree/snapshot/batch6a-20261106) | `ccbbbb4` | QQ 私聊文字、加密配置、消息去重及交付状态。 |
| [`snapshot/batch5-20261105`](https://github.com/lium970320/ink-and-kin/tree/snapshot/batch5-20261105) | `ca72578` | 场景独立上下文与角色频道并发控制、重复操作保护和原子保存。 |
| [`snapshot/batch3-20261025`](https://github.com/lium970320/ink-and-kin/tree/snapshot/batch3-20261025) | `1c79158` | 作品原文库、人工记忆审阅和聊天上下文边界。 |
| [`snapshot/batch2-20261025`](https://github.com/lium970320/ink-and-kin/tree/snapshot/batch2-20261025) | `27e18b9` | 模型配置、调用用量、错误分类和多站备用路由。 |
| [`snapshot/ui-20261025`](https://github.com/lium970320/ink-and-kin/tree/snapshot/ui-20261025) | `ae88b6e` | 早期 11 个界面区域的合成数据只读预览。 |
| [`v0.1.0`](https://github.com/lium970320/ink-and-kin/tree/v0.1.0) | `0a69655` | 首个源码版本，完成基础运行和跨平台修复，该版本记录 590 项测试通过。 |

克隆仓库后，可以用 `git tag --list -n5 snapshot/public-20261116-r2` 查看标签自带的说明。后续公开快照在 `main` 的对应提交上加附注标签，并在这里补充主要改动和验证结果。
