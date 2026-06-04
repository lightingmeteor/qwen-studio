# Qwen Studio Desktop

一个面向日常使用的 Qwen 桌面聊天客户端。你可以把它理解成一个本地版的 Qwen Studio：在电脑上配置自己的 DashScope / 阿里云百炼 API Key，然后用 Qwen 模型进行流式对话、保存本地会话历史、阅读 Markdown 回复和管理多个聊天。

## 直接安装使用

如果你只是想使用产品，不需要安装 Node.js，也不需要从源码构建。下载对应系统的安装包后，直接安装并启动应用即可。

Windows 使用方式：

1. 打开 [Releases](https://github.com/lightingmeteor/qwen-studio/releases/latest)。
2. 下载 Windows 安装包 `Qwen.Studio.Desktop.Setup.0.2.0.exe`。
3. 双击运行 `.exe` 安装包。
4. 按安装向导完成安装，然后从开始菜单或桌面快捷方式打开 `Qwen Studio Desktop`。
5. 如果 Windows Defender SmartScreen 提示应用发布者未知，确认下载来源是本项目 Releases 后，点击「更多信息」->「仍要运行」。
6. 首次启动后，在设置窗口填写 DashScope / 阿里云百炼 API Key，选择 Key 对应的地域 / Base URL，并保存。

macOS 使用方式：

1. 打开 [Releases](https://github.com/lightingmeteor/qwen-studio/releases/latest)。
2. 下载 macOS 安装包 `.dmg`。
3. 双击打开 `.dmg`，将 `Qwen Studio Desktop.app` 拖到「应用程序」目录。
4. 打开「应用程序」中的 `Qwen Studio Desktop`。
5. 如果 macOS 提示应用来自未认证开发者，右键应用选择「打开」，或到「系统设置」->「隐私与安全性」中允许打开。

开发者从源码运行：

```bash
git clone <repo-url>
cd qwen-studio
npm install
npm run dev
```

## 已实现功能

- 多会话聊天：左侧会话列表支持新建、切换、重命名和删除。
- 流式输出：模型回复会边生成边显示，不用等完整答案返回；不同会话可以各自生成和停止。
- 停止生成：回复过程中可以随时停止，已生成的内容会保留。
- 本地历史：会话和消息保存在本机，关闭应用后再打开仍能看到历史。
- 会话整理：支持搜索会话标题和消息内容、置顶重要会话、归档不常用会话。
- 设置面板：支持配置 API Key、地域 / Base URL、默认模型、Temperature 和 System Prompt。
- API 模式：支持在 Chat Completions（默认、稳定路径）和 Responses API 之间切换；Responses 模式会使用 `previous_response_id` 传递上下文。
- 联网搜索：Responses 模式下可开启 `web_search` 内置工具，并在回复中显示工具调用状态。
- 连接诊断：设置页可以测试当前 API Key、Base URL 和模型是否可用，并提示认证、地域、模型、网络或超时问题。
- 地域预设：内置 China Beijing、Singapore、US Virginia、Hong Kong China、Germany Frankfurt 的 OpenAI 兼容接口地址，也支持手动输入自定义 Base URL。
- Markdown 渲染：支持列表、表格、代码块和代码高亮，代码块可以一键复制。
- 消息操作：支持复制、编辑后重新发送、重新生成 / 重试、删除单条消息。
- 导出备份：支持导出当前会话为 Markdown，或导出全部会话为版本化 JSON。
- Usage 汇总：会话顶部显示当前会话的 tokens 使用汇总，单条回复也会保留 usage 信息。
- 安全边界：API Key 只在 Electron 主进程中使用，并通过 `safeStorage` 加密保存；前端页面不会拿到明文 Key。

## 使用前准备

你需要先准备一个 DashScope / 阿里云百炼 API Key，并确认它所属的服务地域。

常见地域对应的 Base URL：

| 地域 | Base URL |
| --- | --- |
| China Beijing | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Singapore | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| US Virginia | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` |
| Hong Kong China | `https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1` |
| Germany Frankfurt | `https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1` |

API Key 必须和 Base URL 地域匹配。如果 Key 明明正确但请求报 401 / 403，优先检查地域是否选错。
Germany Frankfurt 的地址里需要把 `{WorkspaceId}` 替换成你自己的工作空间 ID。

Chat Completions 是默认 API 模式，也是当前最稳定的日常聊天路径。切换到 Responses API 时，应用会把已知的 Model Studio Chat Completions 兼容地址从 `/compatible-mode/v1` 转换为 Responses 兼容地址 `/api/v2/apps/protocols/compatible-mode/v1`，覆盖北京、新加坡、美国、香港和德国工作空间地址模式；自定义地址仍建议确认服务端是否支持 Responses 协议。

## 如何使用

1. 启动应用后，如果还没有配置 API Key，会自动打开设置窗口。
2. 在 `API Key` 中填入你的 DashScope / 百炼 Key。
3. 在 `地域 / Base URL` 里选择 Key 对应的地域；如果你使用的是其它兼容服务，也可以选择 `Custom` 后手动输入 Base URL。
4. 选择 API 模式。建议日常使用保持 `Chat Completions`；需要 Responses API 上下文或内置工具时再切换到 `Responses`。
5. 如果使用 Responses 模式，可以按需开启 `web_search`。
6. 选择或填写默认模型，例如 `qwen-plus`、`qwen3.5-plus`、`qwen-flash`、`qwen-max`、`qwen-coder`。
7. 按需调整 `Temperature` 和 `System Prompt`，然后保存。
8. 回到聊天页，在底部输入问题，使用 `Cmd/Ctrl + Enter` 发送。
9. 生成过程中可以按 `Esc` 或点击 `停止` 中断回复。
10. 如果配置不确定，可以回到设置页点击 `测试连接`，先确认 Key、地域和模型可用。

## 日常操作

- 新建聊天：点击左侧 `新建聊天`。
- 搜索会话：在左侧搜索框输入标题或消息关键词。
- 筛选会话：左侧可以切换 `全部`、`置顶`、`归档`。
- 置顶 / 归档：鼠标移到会话上，点击对应操作；归档会话可以在 `归档` 里恢复。
- 重命名会话：鼠标移到会话上，点击编辑图标。
- 删除会话：鼠标移到会话上，点击删除图标。
- 复制消息：鼠标移到消息上，点击 `复制`。
- 编辑消息：鼠标移到自己的消息上，点击 `编辑`，修改后会从这一轮重新发送。
- 重新生成：鼠标移到 Qwen 回复上，点击 `重新生成`；错误消息会显示 `重试`。
- 复制代码块：鼠标移到代码块右上角，点击 `复制`。
- 导出当前会话：聊天页右上角点击 `MD`。
- 导出全部会话：聊天页右上角点击 `JSON`。
- 修改模型：聊天页右上角可以快速切换模型；设置页可以修改默认模型和自定义模型名。
- 切换 API 模式和联网搜索：在设置页选择 `Chat Completions` 或 `Responses`；`web_search` 只在 Responses 模式下生效。

## 常见问题

### 为什么提示 API Key 无效？

先确认 Key 本身是否可用，再检查 Base URL 地域是否和 Key 所属地域一致。比如新加坡地域的 Key 需要使用 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`。

### 为什么没有返回内容或网络失败？

可能是网络无法访问对应的 DashScope 服务、Base URL 填错、模型名不可用，或者账号额度不足。可以先在设置里点击 `测试连接`，再确认 Base URL 和模型名，或尝试切换到 `qwen-plus`。

### Responses 模式为什么要转换 Base URL？

Model Studio 的 Chat Completions 兼容地址通常以 `/compatible-mode/v1` 结尾，而 Responses API 使用 `/api/v2/apps/protocols/compatible-mode/v1`。应用会自动转换内置地域预设和德国工作空间地址模式；如果你使用自定义 Base URL，需要确认它是否支持 Responses API。

### Responses 模式支持哪些内置工具？

当前 0.4 只接入 `web_search`。暂不包含 `web_extractor`、`code_interpreter`、文件 / Qwen-Long、多模态输入、知识库搜索或自定义函数。

### API Key 会不会暴露给页面？

不会。应用通过 Electron preload 暴露白名单 IPC，前端只会调用发送消息、保存设置等接口；真正的 API 请求和 Key 解密都在主进程完成。

### 历史记录保存在哪里？

历史记录和设置使用 `electron-store` 保存在本机应用数据目录。当前版本不做云同步，也不会上传历史到除模型接口以外的服务。

## 开发运行

安装依赖：

```bash
npm install
```

启动开发模式：

```bash
npm run dev
```

运行测试：

```bash
npm test
```

类型检查：

```bash
npm run typecheck
```

生产构建：

```bash
npm run build
```

打包桌面应用：

```bash
npm run dist
```

按平台打包：

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

## 当前范围

这个版本聚焦桌面端文本聊天、本地会话资产管理和 Responses API 的基础接入。Chat Completions 仍是默认稳定路径；联网能力仅限 Responses 模式下的 `web_search` 内置工具。暂不包含账号登录、云同步、`web_extractor`、`code_interpreter`、文件 / Qwen-Long、文件知识库、多模态输入、知识库搜索、自定义函数、自动更新和后端代理服务。
