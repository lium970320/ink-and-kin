# 书中人直连 · Android

这是书中人自托管服务器的 Android 客户端，基于 Kotlin 2.0、Jetpack Compose 与 Material 3。应用 ID 为 `com.inkandkin.lanchat`，支持 Android 8.0 及以上。客户端代码源自 Mirrai，书中人使用独立的应用包和发现协议。

## 连接电脑

1. 在书中人服务器上显式开启手机直连，并按「设置 → 手机直连」提供的地址连接。手机和电脑使用同一受信网络。
2. 在手机上选择发现列表里的服务器，也可以填写设置页显示的地址。扫描设置页的 `ink-and-kin://pair` 二维码会预填地址及六位配对码，确认服务器后点按配对。也可手动输入配对码或使用服务器账号登录。
3. 切换到另一服务器后需重新认证。测试连通只测量延迟。书中人的探测协议使用 UDP 30003、`INK_AND_KIN_DISCOVER` 请求，以及 `service: "ink-and-kin"`、`protocolVersion: 1` 响应。无法通过 Wi-Fi 互相发现时可手动输入服务端地址。

受信局域网上可使用明文 HTTP，配对、账号和聊天数据通过该连接发送。跨网连接请使用经过认证的 HTTPS 地址。应用退出登录后清除本地会话与聊天缓存。设备仍可由同一用户在服务器设置中管理。

应用支持文字、图片、语音、场景及实时增量消息。客户端仅在读取当前实例的 `/uploads/` 路径时为媒体请求附带登录令牌，浏览外部媒体不发送令牌。后台接收受通知权限、设备策略及 Android 前台服务时限约束。应用回到前台后可重新连接并补齐遗漏消息。服务器提供其自行构建的安装包时，客户端可以检查版本并打开同一服务器上的下载地址。

## 从源码构建

使用 JDK 17、Gradle 8.10.2、Android SDK API 35 和 Build Tools 35.0.0。先把本目录复制到非同步工作区。设置 `JAVA_HOME`、`ANDROID_HOME`、`ANDROID_USER_HOME` 和 `GRADLE_USER_HOME`，把 SDK、缓存、Gradle 与构建产物放在非同步目录。从副本根目录运行：

```sh
gradle assembleDebug --no-daemon
```

调试版使用本机生成的调试签名，APK 位于副本的 `app/build/outputs/apk/debug/`。执行 `gradle assembleRelease --no-daemon` 生成未签名的发行构建。正式发行由发布者使用自己的密钥单独签名。保管签名密钥、SDK 本机路径和安装包于工作区之外。
