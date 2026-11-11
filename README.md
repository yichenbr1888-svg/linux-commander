# Linux 指令器（dsh-linux-commander）

侧边停靠的轻量 Linux 指令工具：输入指令得到通俗中文解释，输入操作需求得到一条可复制的 Linux 指令。本地指令库优先，无法准确处理时自动调用 AI 兜底；绝不执行任何命令。

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

GitHub 仓库：<https://github.com/yichenbr1888-svg/linux-commander>。发布前务必确认包内不含任何 API Key（本仓库的 cordis.patch.yml 已不含密钥；Key 只走环境变量或各机 profile 覆盖）。

## 结构

```
index.js              Host 入口：注册 /linux-commander/query 本地 HTTP 路由
src/core.js           意图识别、指令解释（参数/管道/重定向/危险提醒）、自然语言匹配、本地优先流水线
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

API Key 只存在于各机的环境变量或 profile 配置，**绝不进入发布包和前端 bundle**。

配置 Key（二选一）：

- 环境变量 `DSH_LINUX_COMMANDER_API_KEY`（优先级最高）。Windows：`setx DSH_LINUX_COMMANDER_API_KEY "<你的Key>"` 后重启 DSH；macOS/Linux：写入 shell 启动文件后重启 DSH。
- 或在目标机 profile 的 `cordis.patch.yml` 中覆盖本插件行的配置：

```yaml
- id: linux-commander
  name: 'dsh-linux-commander'
  config:
    apiKey: '<你的 API Key>'
```

包内默认配置（不含密钥）：

```yaml
config:
  endpoint: 'https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions'   # OpenAI 兼容 chat 接口（裸 /v2 会 404）
  model: 'spark-x2.6'
  timeoutMs: 45000        # 3000–120000；spark-x2.6 为推理模型，实测约 20s
```

- 换用其他 AI 服务：改 `endpoint` / `model` 即可，适配器兼容 OpenAI `choices[0].message.content` 与讯飞 `payload.choices.text[0].content` 等常见响应形状。
- 未配置 Key 时本地功能完全可用，AI 兜底返回「AI 接口未配置」。
- 重复查询命中 30 分钟 LRU 缓存（最多 200 条），相同请求并发去重，减少 API 消耗。

## 扩展指令库

- 新增指令：在 `src/commands.js` 的 `COMMANDS` 中加 `{ d: '中文解释', f: { '-x': '参数说明' }, danger: '可选风险提示' }`。
- 新增危险模式：在 `DANGER_RULES` 中加 `{ re: '正则字符串', warn: '提示' }`。
- 新增自然语言规则：在 `src/nl.js` 的 `NL_RULES` 中按「具体在前、泛化在后」插入 `{ re: /…/i, cmd: '…' 或 (m)=>`…`, note: '…', warn: '…' }`。
- 数据改动只需重新启用 Host 插件；改动 `src/client/widget.js` 或语言包后运行 `node build-client.mjs` 重新生成 client.js。

## 交互

- 待机：右侧边缘窄条图标，无文字；点击展开。
- 展开：输入框自动聚焦，Enter 发送，Esc 或右上角按钮收起。
- 结果：等宽字体命令 + 一键复制（成功/失败短暂反馈）+ 一句解释 + 可选风险提醒；右下角小标签标注「本地 / AI」来源。
- 加载中为三点动画；新查询自动替换旧结果并中止旧请求；重复 Enter 不重复发请求。
- 浅色/深色跟随 Harness 主题（仅使用 --dsw-alias-* 主题令牌），适配移动端与 prefers-reduced-motion。

## 安全

- 只解释/生成文本，绝不执行命令；用户输入不会作为脚本运行。
- HTTP 路由仅绑定回环地址，不设置 CORS 头，外部站点无法读取响应。
- 请求体限制 16KB；AI 超时、鉴权失败、限流、格式异常均返回简短错误，不影响本地查询。