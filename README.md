# B 站视频分享 · dsh-bili-share

仓库：[Xuanminggod/Xuanminggod-s-repository](https://github.com/Xuanminggod/Xuanminggod-s-repository)

按「视频类型」从 B 站挑公开视频，在**不固定的时间点**发到**白名单 QQ 群 / 好友**。标题 + 链接（可选封面、可选 AI 一句推荐语），去重、安静时段、每日上限都内置。

—— 一个 DeepSeek Harness（DSH）Host 插件，零第三方运行时依赖。

## 它做什么

- **挑**：只读 B 站匿名公开接口（排行榜 / 综合热门），按分区、时效、时长、播放量、关键词过滤，再随机抽一条。
- **发**：走你自己的 **OneBot v11 HTTP**（`/send_group_msg`、`/send_private_msg`），群和私聊都支持。
- **记住**：同一个群不会收到同一个视频两次；不同群各自判断；重启后状态还在。
- **克制**：间隔 4–10 小时随机、每天最多 3 条、23:00–08:00 不发；连续失败 3 次自动暂停，不刷屏。

## 安装

```
dsh plugin --profile desktop add /绝对路径/dsh-bili-share
```

或把目录拖进插件市场 / 用插件管理器安装。装好后它有两半：Host 半边管调度和发送，Client 半边在**设置 → 插件 → dsh-bili-share** 里给一个配置页。

## 配置

有三种改法，改哪一层随你：

**1）设置面板**（推荐给「想看着改」的时候）

设置 → 插件 → 找到 `dsh-bili-share` → 它的页面上就是表单：状态（下次何时发、今天发了几条、暂停/恢复、只看不发的试发）、接收方、分区与过滤、节奏、文案、OneBot 连接。点「保存」写进 `~/.dsh/bili-share/config.json` 并**立刻热生效**，不用重启。

> 面板是插件的 Client 半边，装完或升级后需要**刷新一次页面**才会出现。

**2）跟 agent 说**（推荐给「懒得点」的时候）

```
分享游戏区的视频到群 123456789，每 3~6 小时一次
```

对应工具 `bili_share_config`，只传要改的字段（注意 `targets` 在**顶层**，不在 `qq` 里）：

```json
{ "targets": [ { "kind": "group", "id": "123456789" } ] }
```

**3）直接改文件**：`~/.dsh/bili-share/config.json`（`DSH_HOME` 存在则在其下），格式同上，改完重载插件生效。它覆盖 `cordis.patch.yml` 里的 `config:`。

### 常用字段

```jsonc
{
  "enabled": true,
  "sources": [{ "type": "ranking", "rid": 4, "limit": 50 }],   // rid: 4=游戏 36=知识 188=科技 0=全站
  "filters": {
    "maxAgeDays": 7,        // 太旧不要
    "minSeconds": 60,       // 0 = 关掉这条
    "maxSeconds": 3600,
    "minViews": 10000,      // 0 = 关掉
    "includeKeywords": [],  // 空 = 不限；命中任一即留
    "excludeKeywords": [],
    "sameUpCooldown": 2     // 最近 N 条内不重复同一个 UP 主
  },
  "qq": {
    "baseUrl": "http://127.0.0.1:3000",
    "accessToken": ""
  },
  "targets": [
    { "kind": "group", "id": "123456789", "at": [], "persona": "" },
    { "kind": "private", "id": "10001" }
  ],
  "schedule": {
    "intervalMinMinutes": 240,   // 4 小时
    "intervalMaxMinutes": 600,   // 10 小时
    "dailyMax": 3,
    "quietHours": "23:00-08:00", // 留空 = 不静音
    "startupDelayMinutes": 2,
    "catchUpMinutes": 180,
    "tickSeconds": 60
  },
  "message": {
    "template": "【B站·{tname}】{title}\n{url}",  // {title} {url} {up} {tname} {duration} {views}
    "withCover": false,
    "summaryMode": "ai",       // off | desc（简介首句） | ai（模型写一句）
    "summaryMaxChars": 60,
    "tone": "",
    "withViews": false,
    "tag": ""                  // 消息末尾追加一行，例如 "（试验）"
  },
  "ai": {
    "maxTokens": 800,          // 推理模型会把预算烧在思考上；不够会自动放大四倍重试一次
    "timeoutMs": 30000
  }
}
```

`at` 是群里要 @ 的 QQ 号数组（或 `["all"]`）；`persona` 是这位收件人的口味，AI 写推荐语时会参考它（例如「喜欢硬核肝游，讨厌剧透」）。

`message.tag` 是你要求的「试验标记」：填什么就原样追加在消息最后一行，留空则没有。测试期填 `（试验）`，正式用的时候清空即可（面板里清掉、保存）。

## 工具

| 工具 | 用途 |
|---|---|
| `bili_share_now` | 立刻挑一条发；`dryRun:true` 只看不发，`bvid` 指定视频，`target` 只发一个 |
| `bili_share_pick` | 只挑不发：按当前过滤规则随机给 1–10 条候选，看完再决定 |
| `bili_share_send` | 发你点名的那条；`note` 是你的推荐语，传了就不再让模型写 |
| `bili_share_status` | 下次时间、今天发了几条、最近发送、最后一次错误 |
| `bili_share_set_paused` | 暂停 / 恢复自动分享（手动发不受影响） |
| `bili_share_config` | 改配置并立刻生效 |

失败统一返回 `{ ok:false, code, error, hint }`，`hint` 会写下一步该干什么。

### 先看一眼再发（推荐用法）

`bili_share_pick` / `bili_share_send` 让 agent 能在发送前真正「看过」视频：

1. `bili_share_pick(4)` —— 挑 4 条候选，看标题和简介；
2. 对有兴趣的那条用故事板 `video_storyboard(url)` 看一眼（约 242 个视觉 token，不下载全文）；
3. 写一句**真的看过才写得出来**的推荐语；
4. `bili_share_send({ bvid, note })` —— 只发这一条，`note` 原样作为推荐语。

不装视频故事板插件也能用：跳过第 2 步，`note` 由你或模型按简介写。

## OneBot 要求

任何实现了 OneBot v11 HTTP 的后端都行（NapCat、Lagrange、go-cqhttp 兼容实现…）。插件只用两个端点：

```
POST {baseUrl}/send_group_msg     { group_id, message, auto_escape: false }
POST {baseUrl}/send_private_msg   { user_id, message, auto_escape: false }
```

老式端点名 `sendgroupmsg` / `sendprivatemsg` 会自动回退。`accessToken` 非空时带 `Authorization: Bearer <token>`。

## 状态与文件

都放在 `$DSH_HOME/bili-share/`（默认 `~/.dsh/bili-share/`）：

- `state.json` —— 去重记录、下次时间、每日计数、失败计数（原子写；损坏会先备份成 `state.json.corrupt-<时间>` 再重建）
- `config.json` —— 你保存的配置
- `apply-report.json` —— 每次加载的自检结果（注册了哪些工具、有没有失败、有没有被忽略的配置项）

## 不做什么（v1）

- 不登录 B 站、不抓评论弹幕、不点赞投币
- 不做 B 站小程序卡片（B 站已下架该能力）
- 不做搜索 / UP 主订阅 / 收藏夹同步（要 wbi 签名，留给 v2）
- 不替你管理 QQ 机器人本体（你自备 OneBot）

## 已知边界

- **表单是插件自己的页面，不是宿主生成的**：DSH 的自动表单依赖宿主包 `@deepseek-ai/schemastery`，而它在 `app.asar` 里、插件侧解析不到（自检报告里 `hasConfigSchema: false` 就是这件事）。所以面板是插件自带的 Client 半边，把表单画在 `plugins.bundle.config` 这个槽位上，读写走插件自己在 host 注册的 `/bili-share/api`。装完/升级后刷新页面才出现。
- **AI 推荐语**：走宿主默认模型（`llm` + `agentDefaultModel`）；推理模型有时会把 token 预算全花在思考上，插件会自动放大预算重试一次，仍失败就退回简介首句（记为 `ai-fallback`），不会因此发不出去。
- **排行榜有缓存**：B 站排行榜约 10 分钟更新一次，短时间连发可能挑到同一批候选；去重会挡住重复视频，但可能返回 `NO_CANDIDATE`。这是正常结果，不是故障。
- **匿名接口有风控**：命中 `-352` 会返回 `BILI_RISK_CONTROL` 并提示稍后再试，不会重试刷接口。

## 开发

```
node --test test/          # 13 个用例，全部离线，不联网
```

若 `node --test` 报 `spawn EPERM`（某些沙箱环境会限制管道 stdin），直接跑：

```
node test/unit.test.mjs
node test/client-smoke.mjs   # 客户端半边：能否加载、是否注册到 plugins.bundle.config
```

```
lib/config.js      默认值、合并、归一化、安静时段
lib/bili.js        B 站匿名接口
lib/pick.js        七道过滤 + 随机抽取
lib/message.js     模板渲染与消息段拼装
lib/ai.js          一句推荐语（可降级）
lib/onebot.js      OneBot v11 HTTP 发送
lib/state.js       状态与配置文件
lib/scheduler.js   随机间隔、安静时段、每日上限、补发
lib/tools.js       bili_share_* 工具定义
lib/api.js         面板用的 /bili-share/api 路由
lib/index.js       bundle 入口
client.js          设置面板（Client 半边，纯 React.createElement）
```

## 路线

- **v1.1**（已完成）：`bili_share_pick` 只挑不发 → agent 用视频故事板「看一眼」→ 写一句推荐语 → `bili_share_send` 发出。
- **v2**（计划）：搜索与 UP 主订阅（需要 wbi 签名，可能要用户自备 Cookie）；B 站专栏/动态来源。

## 市场收录

这个包已经满足收录要求的**代码侧**条件：`package.json` 声明了 `dsh.bundle.patch`、仓库根有 `cordis.patch.yml`、keywords 含 `dsh-plugin`、README 与 LICENSE 齐。

还差**用户侧**两件事，插件本身做不了：

1. 一个公开 GitHub 仓库（把本目录推上去，加 `dsh-plugin` topic，仓库创建满 1 天）；
2. 到 `awesome-dsh-plugin/awesome-dsh-plugin` 提一个只加 `data/plugins/<owner>__<repo>.yml` 的 PR。条目模板见本目录 `market-entry.yml`。

可选：发 npm 可以显示下载量（不影响收录，但包的 `repository` 必须指回被收录的仓库）；在仓库根放 `screenshots.json` 可以让市场详情页显示截图。

## License

MIT
