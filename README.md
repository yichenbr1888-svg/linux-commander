# 译令（dsh-linux-commander）

侧边停靠的轻量指令翻译工具：输入 Linux 指令得到通俗中文解释，输入 SQL 语句由 AI 直接解释其作用，输入操作需求得到一条可复制的 Linux 指令。本地指令库优先，无法准确处理时自动调用 AI 兜底；绝不执行任何命令。

## 安装（其他电脑）

目标电脑需装有带 Web GUI 的 DSH（桌面版）。本包零依赖、无需构建（client.js 已随包发布）。

**方式一：npm（推荐）** — 在目标电脑的 DSH 会话里对代理说：

> 安装插件 bundle：dsh-linux-commander

**方式二：GitHub（无需 npm 账号）** — 对代理说：

> 安装插件 bundle：github:yichenbr1888-svg/linux-commander

**方式三：离线拷贝** — 把仓库文件夹放到目标机一个**固定位置**（本地安装是链接而非拷贝，装好后不要删除或移动），对代理说：`安装本地插件 bundle：<文件夹绝对路径>`。

安装后刷新 Web GUI，右侧边缘出现停靠图标即成功。然后配置 AI Key（见下节）；不配 Key 时本地指令库照常可用。

## 发布（维护者）

```bash
npm login          # 或 pnpm login
npm publish        # 包名无 scope，默认公开
```

GitHub 仓库：<https://github.com/yichenbr1888-svg/linux-commander>。发布前务必确认包内不含任何 API Key、接口地址或模型名（本仓库均已移除；这些值只走各机环境变量或 profile 覆盖）。

## 结构

```
index.js              Host 入口：注册 /linux-commander/query 本地 HTTP 路由
src/core.js           意图识别（指令/SQL/自然语言）、指令解释（参数/管道/重定向/危险提醒）、本地优先流水线
src/commands.js       内置 Linux 指令库（指令 + 常用参数 + 危险模式）
src/nl.js             自然语言 → 指令规则（有序，支持参数提取）
src/ai.js             AI 适配器：请求、响应解析、超时、缓存、去重、错误归一化
src/client/widget.js  浏览器组件源码（停靠按钮 + 悬浮弹窗）
build-client.mjs      将 widget + 语言包打包为 client.js
client.js             生成的浏览器 bundle（注册到 shell.overlay 插槽）
locale/zh.json|en.json  界面与插件元信息文案
```

UI、识别、本地查询、AI 请求四层分离。浏览器只负责展示与交互；所有查询经本地回环路由进入 Host，由 Host 决定本地回答还是调用 AI。

## AI 接口配置（仅 Host 端）

AI 后端的地址、模型与 Key 全部由每台机器自行配置，**发布包与前端 bundle 不含任何密钥或厂商信息**。适配器兼容 OpenAI 风格的 chat completions 接口（`choices[0].message.content`），也容忍部分厂商的扩展响应形状。

三项配置（环境变量优先于 profile 配置）：

| 环境变量 | 含义 |
|---|---|
| `DSH_LINUX_COMMANDER_ENDPOINT` | OpenAI 兼容的 chat completions 完整 URL |
| `DSH_LINUX_COMMANDER_MODEL` | 模型 ID |
| `DSH_LINUX_COMMANDER_API_KEY` | API Key |

Windows 用 `setx <变量名> "<值>"` 写入后重启 DSH；macOS/Linux 写入 shell 启动文件后重启 DSH。

或在目标机 profile 的 `cordis.patch.yml` 中覆盖本插件行的配置：

```yaml
- id: linux-commander
  name: 'dsh-linux-commander'
  config:
    endpoint: '<你的 chat completions URL>'
    model: '<模型 ID>'
    apiKey: '<你的 API Key>'
    timeoutMs: 45000   # 3000–120000；推理类模型可能需 20–30s
```

- 三项齐全才启用 AI 兜底；缺任何一项时本地功能完全可用，AI 查询返回「AI 接口未配置」。
- 重复查询命中 24 小时 LRU 缓存（最多 500 条），相同请求并发去重，减少 API 消耗。

## 速度优化

- **本地优先**：命中内置指令库的查询约 5ms 返回，完全不调 AI；指令库持续扩充以减少兜底频率。
- **固定关闭深度思考**：本工具只处理简单的指令解释/生成，不需要深度推理。请求固定携带 `thinking:{type:"disabled"}`，实测同一查询从约 10s 降到约 2.5s。
- **长缓存**：指令知识稳定，缓存 TTL 24 小时，重复查询约 50ms。
- 请求使用 `max_completion_tokens`（`max_tokens` 已被部分厂商废弃）；不发送 `temperature`（部分服务端固定为 1，传了也无效）。

## 扩展指令库

- 新增指令：在 `src/commands.js` 的 `COMMANDS` 中加 `{ d: '中文解释', f: { '-x': '参数说明' }, danger: '可选风险提示' }`。
- 新增危险模式：在 `DANGER_RULES` 中加 `{ re: '正则字符串', warn: '提示' }`。
- 新增自然语言规则：在 `src/nl.js` 的 `NL_RULES` 中按「具体在前、泛化在后」插入 `{ re: /…/i, cmd: '…' 或 (m)=>`…`, note: '…', warn: '…' }`。
- 数据改动只需重新启用 Host 插件；改动 `src/client/widget.js` 或语言包后运行 `node build-client.mjs` 重新生成 client.js。

## 交互

- 待机：右侧边缘窄条图标，无文字；点击展开。**按住图标可上下拖动**调整停靠位置（松手自动记忆，窗口缩放自适应）；键盘聚焦后 ↑/↓ 微调（Shift 加速）。
- 展开：弹窗默认对齐停靠位置并自动避开屏幕边缘；**按住标题栏可自由拖动弹窗**（位置自动记忆）；输入框自动聚焦，Enter 发送。
- 标题栏：「译令」标题后的小标签标注「本地 / AI」来源；右上角为**最小化**按钮（Esc 同效）——收起但保留输入与结果，再次点击停靠图标原样恢复。
- 输入行右侧为**清除**按钮：一键清空输入与结果，恢复刚打开的状态（同时中止进行中的查询）。
- 结果：等宽字体命令，**复制按钮位于命令行最右侧**（成功/失败短暂反馈）+ 一句解释 + 可选风险提醒。
- SQL：识别 SELECT/INSERT/UPDATE/DELETE/CREATE/DROP 等语句结构后直接交给 AI 解释，不走本地指令库。
- 加载中为三点动画；新查询自动替换旧结果并中止旧请求；重复 Enter 不重复发请求。
- 浅色/深色跟随 Harness 主题（仅使用 --dsw-alias-* 主题令牌），适配移动端与 prefers-reduced-motion。

## 安全

- 只解释/生成文本，绝不执行命令；用户输入不会作为脚本运行。
- HTTP 路由仅绑定回环地址，不设置 CORS 头，外部站点无法读取响应。
- 请求体限制 16KB；AI 超时、鉴权失败、限流、格式异常均返回简短错误，不影响本地查询。