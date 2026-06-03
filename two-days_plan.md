下面给出一个**两天内可落地的 Electron 桌面端 Qwen Studio 功能等价 MVP 方案**。边界要收紧：不做官方闭源客户端逐字节复刻，不复制官方商标/素材，不做完整语音、图片、视频、云同步、账号体系；两天内重点做出“像 Qwen Studio 的桌面聊天客户端”：会话列表、模型选择、流式输出、Markdown/代码渲染、本地历史、设置页、远程 Qwen API 接入。你上传的分析稿也支持这个取舍：更现实的是通过官方公开接口做“功能等价复现”，而不是高保真复刻闭源客户端；远程 API + 桌面前端/代理是低风险路径。 

## 1. 两天交付目标

**最终交付物：**

一个可运行、可打包的 Electron 桌面应用，包含：

| 模块          | 两天内做到什么程度                                                |
| ----------- | -------------------------------------------------------- |
| 首页/聊天页      | 左侧会话列表，中间消息流，底部输入框，右上模型选择                                |
| 会话管理        | 新建、重命名、删除、切换会话；历史本地持久化                                   |
| Qwen API 接入 | OpenAI-compatible Chat Completions，支持 `stream=true` 流式输出 |
| 设置页         | 填写 API Key、Base URL、默认模型、temperature、system prompt       |
| Markdown 渲染 | 支持标题、列表、表格、代码块、代码复制                                      |
| 停止生成        | 生成中可 Abort                                               |
| 错误处理        | API Key 错误、网络错误、模型名错误、超时提示                               |
| 打包          | 至少打出 macOS/Windows 开发包；正式签名和自动更新可后置                      |

**两天内不做：**

账号登录、官方云同步、完整联网搜索、语音通话、图片/视频生成、多模态实时对话、复杂文件知识库、MCP、自动更新、应用商店上架。这些放到第二阶段。Qwen Studio 当前官方页面本身是完整产品入口，页面上能看到 Qwen Studio、模型选择和 App 入口；两天 MVP 应只复现核心桌面聊天体验，而不是全部官方产品能力。([chat.qwen.ai][1])

---

## 2. 推荐架构

采用 **Electron 主进程代理调用 Qwen API + Renderer 只负责 UI**。

```text
Electron Renderer（React UI）
  ├─ ChatPage：聊天窗口、消息流、输入框
  ├─ Sidebar：会话列表
  ├─ SettingsModal：API Key / Base URL / Model
  └─ MarkdownRenderer：Markdown + 代码高亮

Preload
  └─ 暴露安全 IPC：window.qwen.chatStream / settings / conversations

Electron Main
  ├─ qwenService.ts：调用 Qwen OpenAI-compatible API
  ├─ settingsStore.ts：保存配置，API Key 放 keytar/系统钥匙串
  ├─ conversationStore.ts：SQLite 或 electron-store 保存历史
  └─ streamController.ts：AbortController 停止生成

Remote API
  └─ Alibaba Cloud Model Studio / DashScope Qwen API
```

官方文档确认 Qwen 模型在 Alibaba Cloud Model Studio 支持 OpenAI-compatible 接口，迁移时主要调整 API key、`BASE_URL` 和模型名；中国北京区域的兼容接口 Base URL 是 `https://dashscope.aliyuncs.com/compatible-mode/v1`，对应完整 Chat Completions endpoint 为 `/chat/completions`。([阿里云][2])

**两种密钥策略：**

| 场景             | 做法                                                                      |
| -------------- | ----------------------------------------------------------------------- |
| 内部 Demo / 自用版  | 用户在设置页填写自己的 `DASHSCOPE_API_KEY`，Electron 主进程保存到系统钥匙串，Renderer 不接触明文 Key |
| 对外发布 / 平台方统一付费 | 不把平台 API Key 打进 Electron 包；改为 Electron → 你的后端 BFF → Qwen API            |

原因很简单：桌面包也是客户端，硬编码密钥会被逆向。官方文档也明确提醒客户端环境暴露 API Key 有风险，并提供短期 token 方案；API Key 推荐使用环境变量，避免写死在代码中。([阿里云][3])

---

## 3. 技术栈

| 层        | 选型                                                           |
| -------- | ------------------------------------------------------------ |
| 桌面壳      | Electron                                                     |
| 构建       | Vite + TypeScript                                            |
| 前端       | React + Zustand                                              |
| UI       | Tailwind CSS / shadcn-ui 风格组件                                |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` 或 Shiki |
| 本地配置     | `electron-store`                                             |
| API Key  | `keytar`，两天赶工可先用 `electron-store` 加明文警告，正式版必须换 keytar        |
| 本地历史     | 两天 MVP 用 `electron-store`；后续换 SQLite                         |
| API 调用   | Node `fetch` / `undici`，不用把 OpenAI SDK 放 Renderer            |
| 打包       | `electron-builder`                                           |

推荐默认模型配置：

```json
{
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen-plus",
  "temperature": 0.7,
  "stream": true
}
```

官方示例中使用 `qwen-plus`，并说明模型名可按需要替换；Chat Completions 支持 `stream=True`，流式返回以 `data:` 事件块输出，最后返回 `[DONE]`。([阿里云][2])

---

## 4. 项目结构

```text
qwen-studio-electron/
  package.json
  electron.vite.config.ts
  src/
    main/
      index.ts
      qwenService.ts
      settingsStore.ts
      conversationStore.ts
    preload/
      index.ts
    renderer/
      main.tsx
      App.tsx
      pages/
        ChatPage.tsx
      components/
        Sidebar.tsx
        ChatInput.tsx
        MessageBubble.tsx
        MarkdownMessage.tsx
        SettingsDialog.tsx
      store/
        chatStore.ts
        settingsStore.ts
      types/
        chat.ts
```

---

## 5. 核心接口设计

### Renderer 调用的 IPC

```ts
window.qwen = {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: Partial<AppSettings>): Promise<void>

  listConversations(): Promise<Conversation[]>
  createConversation(title?: string): Promise<Conversation>
  deleteConversation(id: string): Promise<void>
  saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void>

  chatStream(payload: ChatStreamRequest): Promise<void>
  abortChat(requestId: string): Promise<void>

  onChatDelta(callback: (event: ChatDeltaEvent) => void): () => void
  onChatDone(callback: (event: ChatDoneEvent) => void): () => void
  onChatError(callback: (event: ChatErrorEvent) => void): () => void
}
```

### 数据模型

```ts
export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status?: 'pending' | 'streaming' | 'done' | 'error';
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  apiKey?: string;
  baseUrl: string;
  model: string;
  temperature: number;
  systemPrompt: string;
}
```

---

## 6. Qwen 流式调用核心代码

`src/main/qwenService.ts`

```ts
export interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: QwenMessage[];
  temperature?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onUsage?: (usage: unknown) => void;
}

export async function streamQwenChat(options: StreamChatOptions) {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    temperature = 0.7,
    signal,
    onDelta,
    onUsage,
  } = options;

  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const resp = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    }),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Qwen API error: ${resp.status} ${text}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const line = event
        .split('\n')
        .find((item) => item.startsWith('data:'));

      if (!line) continue;

      const data = line.replace(/^data:\s*/, '').trim();

      if (data === '[DONE]') return;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;

        if (typeof delta === 'string' && delta.length > 0) {
          onDelta(delta);
        }

        if (json.usage && onUsage) {
          onUsage(json.usage);
        }
      } catch {
        // 避免单个异常 chunk 导致整段生成中断
      }
    }
  }
}
```

`src/main/index.ts` 里注册 IPC：

```ts
import { ipcMain } from 'electron';
import { streamQwenChat } from './qwenService';
import { getSettings } from './settingsStore';

const controllers = new Map<string, AbortController>();

ipcMain.handle('chat:stream', async (event, payload) => {
  const settings = await getSettings();
  const controller = new AbortController();

  controllers.set(payload.requestId, controller);

  try {
    await streamQwenChat({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: payload.model || settings.model,
      temperature: payload.temperature ?? settings.temperature,
      messages: payload.messages,
      signal: controller.signal,
      onDelta: (text) => {
        event.sender.send('chat:delta', {
          requestId: payload.requestId,
          text,
        });
      },
      onUsage: (usage) => {
        event.sender.send('chat:usage', {
          requestId: payload.requestId,
          usage,
        });
      },
    });

    event.sender.send('chat:done', {
      requestId: payload.requestId,
    });
  } catch (err: any) {
    if (controller.signal.aborted) {
      event.sender.send('chat:done', {
        requestId: payload.requestId,
        aborted: true,
      });
      return;
    }

    event.sender.send('chat:error', {
      requestId: payload.requestId,
      message: err?.message || 'Unknown error',
    });
  } finally {
    controllers.delete(payload.requestId);
  }
});

ipcMain.handle('chat:abort', async (_event, requestId: string) => {
  controllers.get(requestId)?.abort();
  controllers.delete(requestId);
});
```

`src/preload/index.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('qwen', {
  chatStream: (payload: unknown) => ipcRenderer.invoke('chat:stream', payload),
  abortChat: (requestId: string) => ipcRenderer.invoke('chat:abort', requestId),

  onChatDelta: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('chat:delta', listener);
    return () => ipcRenderer.off('chat:delta', listener);
  },

  onChatDone: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('chat:done', listener);
    return () => ipcRenderer.off('chat:done', listener);
  },

  onChatError: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('chat:error', listener);
    return () => ipcRenderer.off('chat:error', listener);
  },
});
```

Electron 安全配置：

```ts
const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
```

---

## 7. 两天排期

### 第一天上午：项目初始化 + API 跑通

**目标：先证明 Electron 能稳定连 Qwen API。**

1. 初始化项目：

```bash
npm create electron-vite@latest qwen-studio-electron
cd qwen-studio-electron
npm install
npm install zustand react-markdown remark-gfm rehype-highlight uuid electron-store
npm install -D tailwindcss postcss autoprefixer
```

2. 配置默认参数：

```ts
baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
model = 'qwen-plus'
```

3. 做设置页字段：

```text
API Key
Base URL
Model
Temperature
System Prompt
```

4. 完成 `qwenService.ts`，用一条消息验证流式输出。

**验收标准：**

输入“你好，请用一句话介绍你自己”，界面能够逐字/逐段输出；断网、Key 错误能弹出错误提示。

---

### 第一天下午：聊天主界面 + 会话持久化

**目标：做出 Qwen Studio 类聊天体验。**

页面布局：

```text
┌────────────────────────────────────────────┐
│ 左侧 Sidebar       │ 顶部模型选择 / 设置   │
│ 新建聊天           ├───────────────────────┤
│ 会话 1             │ assistant message     │
│ 会话 2             │ user message          │
│ 会话 3             │ assistant streaming   │
│                    ├───────────────────────┤
│                    │ 输入框 + 发送按钮      │
└────────────────────────────────────────────┘
```

需要完成：

1. 新建会话。
2. 删除会话。
3. 发送消息。
4. Assistant 消息流式追加。
5. 本地保存会话。
6. Markdown 渲染。
7. 代码块复制。
8. 停止生成。

本地存储结构：

```json
{
  "conversations": [
    {
      "id": "c_001",
      "title": "新会话",
      "createdAt": 1710000000000,
      "updatedAt": 1710000000000,
      "messages": [
        {
          "id": "m_001",
          "role": "user",
          "content": "你好",
          "createdAt": 1710000000000
        }
      ]
    }
  ]
}
```

**验收标准：**

关闭应用再打开，会话仍在；切换会话不丢消息；生成中点击“停止”后不会继续追加文本。

---

### 第二天上午：拟 Qwen Studio 体验补齐

**目标：让 Demo 看起来像完整桌面产品。**

重点做这些交互：

| 功能       | 具体实现                                          |
| -------- | --------------------------------------------- |
| 首页欢迎态    | 中间显示欢迎语、推荐 prompt 卡片                          |
| 模型选择     | 下拉：`qwen-plus`、`qwen-turbo`、`qwen-max`、自定义模型名 |
| 快捷键      | `Cmd/Ctrl + Enter` 发送，`Esc` 停止生成              |
| 输入框      | 自动增高、粘贴文本、清空按钮                                |
| 消息操作     | 复制、重新生成、删除单条消息                                |
| 会话标题     | 第一条用户消息自动截取为标题                                |
| Token/用量 | 如果返回 usage，则在消息详情中展示                          |
| 空状态      | 未配置 API Key 时，引导打开设置页                         |

Qwen OpenAI-compatible Chat 接口文档中明确包含 `usage` 字段，用于返回 prompt、completion 和 total token 计量信息；流式调用也可以通过 `stream_options.include_usage` 在末尾返回 usage。([阿里云][2])

---

### 第二天下午：打包、测试、交付

**目标：形成可演示版本。**

1. 增加构建脚本：

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "dist": "electron-builder"
  }
}
```

2. `electron-builder` 基础配置：

```json
{
  "build": {
    "appId": "com.example.qwenstudio.desktop",
    "productName": "Qwen Desktop Demo",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**",
      "dist-electron/**"
    ],
    "mac": {
      "target": ["dmg"]
    },
    "win": {
      "target": ["nsis"]
    }
  }
}
```

3. 测试用例：

| 测试项         | 通过标准                  |
| ----------- | --------------------- |
| API Key 未填写 | 点击发送时提示“请先配置 API Key” |
| API Key 错误  | 返回清晰错误，不白屏            |
| 普通问题        | 能完整返回                 |
| 长回答         | 流式输出不卡死               |
| 停止生成        | 立即停止，不再追加             |
| 会话切换        | 当前生成不会串到其他会话          |
| 关闭重开        | 历史记录仍在                |
| Markdown    | 代码块、表格、列表能正常显示        |
| 网络断开        | 弹出重试提示                |
| 模型切换        | 当前会话记录不丢失             |

你上传的报告也建议测试不应只停留在“能答一句话”，而应覆盖基础对话、流式输出、多模型切换、断线恢复、权限认证和本地持久化等关键路径。

---

## 8. 接入 Chat API 还是 Responses API

两天内建议这样取舍：

| 接口                                 | 是否放进两天 MVP | 原因                               |
| ---------------------------------- | ---------: | -------------------------------- |
| OpenAI-compatible Chat Completions |         必做 | 简单、稳定、流式输出容易实现                   |
| Responses API                      |   可留一个实验开关 | 更接近官方工具增强体验，但两天内会增加上下文管理和 UI 复杂度 |
| DashScope 原生接口                     |     不建议首版做 | 参数更厂商化，迁移成本高                     |
| WebSocket 实时多模态                    |         不做 | 语音/实时多模态超出两天范围                   |

Responses API 的优势是内置 web search、web scraping、code interpreter、知识库检索等工具，并支持更简化的上下文管理；但它与 Chat Completions 的路径和参数有差异，两天 MVP 可以先留接口抽象，第二阶段再切换。([阿里云][4])

建议代码里抽象成：

```ts
interface LLMProvider {
  streamChat(input: StreamChatInput): Promise<void>;
}
```

第一版实现：

```ts
class QwenChatProvider implements LLMProvider {}
```

第二阶段再加：

```ts
class QwenResponsesProvider implements LLMProvider {}
```

这样后续不会大改 UI。

---

## 9. 两天版功能清单

### 必须完成

| 优先级 | 功能                  | 说明                               |
| --- | ------------------- | -------------------------------- |
| P0  | API Key 设置          | 没有它无法调用                          |
| P0  | Chat Completions 调用 | 远程 API 主链路                       |
| P0  | 流式渲染                | 这是类 Studio 体验的核心                 |
| P0  | 会话历史                | 本地保存即可                           |
| P0  | 停止生成                | 必须支持 Abort                       |
| P0  | 错误提示                | Key 错、网络错、模型错                    |
| P1  | Markdown            | 大模型回复必须可读                        |
| P1  | 代码块复制               | 编程类回复常用                          |
| P1  | 模型选择                | `qwen-plus` / `qwen-turbo` / 自定义 |
| P1  | 应用打包                | 至少能生成安装包或可执行文件                   |

### 明确砍掉

| 功能          | 为什么不进两天版                |
| ----------- | ----------------------- |
| 登录/账号体系     | 会占用大量时间，且与远程 API MVP 无关 |
| 云同步         | 需要服务端和用户体系              |
| 官方 UI 高保真复刻 | 有商标/版权风险，且不影响技术验证       |
| 图片/视频/语音    | 多模态链路和 UI 成本高           |
| 联网搜索        | 可用 Responses API 后置     |
| 文件知识库       | 需要上传、解析、切片、索引、检索        |
| MCP/插件市场    | 超出两天范围                  |

---

## 10. 最终推荐版本

**两天内最稳的版本是：**

```text
Electron + React + TypeScript
  ↓
Electron Main Process 调 Qwen OpenAI-compatible Chat API
  ↓
stream=true 实现流式输出
  ↓
electron-store 保存会话和配置
  ↓
设置页让用户填写 API Key / Base URL / Model
  ↓
electron-builder 打包
```

**默认配置：**

```json
{
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen-plus",
  "temperature": 0.7,
  "systemPrompt": "You are Qwen, a helpful assistant."
}
```

**第二阶段再补：**

1. 后端 BFF，避免平台 API Key 下发到桌面端。
2. Responses API，补联网搜索、代码解释器、知识库检索。
3. SQLite，替换 `electron-store`。
4. 文件上传与文档问答。
5. 自动更新、签名、公测分发。
6. 多模态模型接入。

这个方案在两天内可实现、可演示、可打包，且后续能自然升级到更接近 Qwen Studio 的产品形态。

[1]: https://chat.qwen.ai/ "Qwen Studio"
[2]: https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope "
 Call Qwen via OpenAI-Compatible API with No Code Changes - Model Studio - Alibaba Cloud

"
[3]: https://www.alibabacloud.com/help/en/model-studio/application-obtain-temporary-authentication-token "
 Secure API Access with Temporary Authentication Tokens - Alibaba Cloud Model Studio - Alibaba Cloud

"
[4]: https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses "
 Call Qwen via OpenAI Responses API with Built-in Web Search - Model Studio - Alibaba Cloud

"
