# Qwen Studio Desktop

一个面向日常使用的 Qwen 桌面聊天客户端。你可以把它理解成一个本地版的 Qwen Studio：在电脑上配置自己的 DashScope / 阿里云百炼 API Key，然后用 Qwen 模型进行流式对话、保存本地会话历史、阅读 Markdown 回复和管理多个聊天。

## 直接安装使用

如果你只是想使用产品，不需要自己运行生产构建。拿到发布包后，直接安装并启动应用即可。

当前本地已生成的 macOS Apple Silicon 发布包：

- `release/Qwen Studio Desktop-0.1.0-arm64.dmg`
- `release/mac-arm64/Qwen Studio Desktop.app`

Windows 使用方式：

1. 下载 Windows 安装包 `Qwen Studio Desktop Setup 0.1.0.exe`。
2. 双击运行安装包。
3. 按安装向导完成安装，然后从开始菜单或桌面快捷方式打开 `Qwen Studio Desktop`。
4. 如果 Windows Defender SmartScreen 提示应用发布者未知，确认安装包来源可信后，点击「更多信息」->「仍要运行」。
5. 首次启动后，在设置窗口填写 DashScope / 阿里云百炼 API Key，选择 Key 对应的地域 / Base URL，并保存。

> 注意：当前仓库本地只生成了 macOS Apple Silicon 发布包。如果要给 Windows 用户提供同样的可安装方式，需要发布方先在 Windows 机器或 CI 中执行打包，生成 `.exe` 安装包后再分发给用户。

发布方生成 Windows 安装包：

```powershell
npm install
npm run dist
```

打包完成后，Windows 安装包通常会生成在 `release/` 目录，例如 `release/Qwen Studio Desktop Setup 0.1.0.exe`；免安装目录通常是 `release/win-unpacked/`。建议在 Windows 机器上执行打包命令。

Windows 开发者从源码运行：

```powershell
git clone <repo-url>
cd qwen-studio
npm install
npm run dev
```

macOS 使用方式：

1. 双击打开 `release/Qwen Studio Desktop-0.1.0-arm64.dmg`。
2. 将 `Qwen Studio Desktop.app` 拖到「应用程序」目录。
3. 打开「应用程序」中的 `Qwen Studio Desktop`。
4. 如果 macOS 提示应用来自未认证开发者，右键应用选择「打开」，或到「系统设置」->「隐私与安全性」中允许打开。

本地调试时，也可以直接打开已生成的 `.app`：

```bash
open "release/mac-arm64/Qwen Studio Desktop.app"
```

## 已实现功能

- 多会话聊天：左侧会话列表支持新建、切换、重命名和删除。
- 流式输出：模型回复会边生成边显示，不用等完整答案返回。
- 停止生成：回复过程中可以随时停止，已生成的内容会保留。
- 本地历史：会话和消息保存在本机，关闭应用后再打开仍能看到历史。
- 设置面板：支持配置 API Key、地域 / Base URL、默认模型、Temperature 和 System Prompt。
- 地域预设：内置 China Beijing、Singapore、US Virginia、Hong Kong China 的 OpenAI 兼容接口地址，也支持手动输入自定义 Base URL。
- Markdown 渲染：支持列表、表格、代码块和代码高亮，代码块可以一键复制。
- 消息操作：支持复制、重新生成 / 重试、删除单条消息。
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

API Key 必须和 Base URL 地域匹配。如果 Key 明明正确但请求报 401 / 403，优先检查地域是否选错。

## 如何使用

1. 启动应用后，如果还没有配置 API Key，会自动打开设置窗口。
2. 在 `API Key` 中填入你的 DashScope / 百炼 Key。
3. 在 `地域 / Base URL` 里选择 Key 对应的地域；如果你使用的是其它兼容服务，也可以选择 `Custom` 后手动输入 Base URL。
4. 选择或填写默认模型，例如 `qwen-plus`、`qwen-turbo`、`qwen-max`。
5. 按需调整 `Temperature` 和 `System Prompt`，然后保存。
6. 回到聊天页，在底部输入问题，使用 `Cmd/Ctrl + Enter` 发送。
7. 生成过程中可以按 `Esc` 或点击 `停止` 中断回复。

## 日常操作

- 新建聊天：点击左侧 `新建聊天`。
- 重命名会话：鼠标移到会话上，点击编辑图标。
- 删除会话：鼠标移到会话上，点击删除图标。
- 复制消息：鼠标移到消息上，点击 `复制`。
- 重新生成：鼠标移到 Qwen 回复上，点击 `重新生成`；错误消息会显示 `重试`。
- 复制代码块：鼠标移到代码块右上角，点击 `复制`。
- 修改模型：聊天页右上角可以快速切换模型；设置页可以修改默认模型和自定义模型名。

## 常见问题

### 为什么提示 API Key 无效？

先确认 Key 本身是否可用，再检查 Base URL 地域是否和 Key 所属地域一致。比如新加坡地域的 Key 需要使用 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`。

### 为什么没有返回内容或网络失败？

可能是网络无法访问对应的 DashScope 服务、Base URL 填错、模型名不可用，或者账号额度不足。可以先在设置里确认 Base URL 和模型名，再尝试切换到 `qwen-plus`。

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

## 当前范围

这个版本聚焦桌面端文本聊天 MVP。暂不包含账号登录、云同步、联网搜索、文件知识库、多模态输入、自动更新和后端代理服务。
