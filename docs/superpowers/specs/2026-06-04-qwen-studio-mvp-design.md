# Qwen Studio 桌面端 MVP 设计文档

- 日期：2026-06-04
- 状态：已通过用户评审（待用户复核本文档）
- 来源：基于仓库根目录 `two-days_plan.md` 收敛而成

## 1. 目标

做一个**像 Qwen Studio 的桌面聊天客户端**：左侧会话列表、中间消息流、底部输入框、右上模型选择；接入 Qwen 的 OpenAI 兼容接口，支持流式输出、本地历史、设置页、Markdown 渲染、停止生成、错误提示，并提供打包配置。

不做：账号登录、云同步、联网搜索、图片/语音/视频、文件知识库、自动更新——留到第二阶段。

## 2. 架构

界面与后台分离，密钥只留在后台主进程。

```text
Renderer（React UI，只管显示与交互，碰不到密钥）
  ├─ ChatPage：消息流 + 输入框 + 顶栏（模型选择/设置入口）
  ├─ Sidebar：会话列表（新建/重命名/删除/切换）
  ├─ SettingsDialog：API Key / Base URL / Model / Temperature / System Prompt
  ├─ WelcomeState：未选会话或空会话时的欢迎态 + 推荐 prompt 卡片
  └─ MarkdownMessage：Markdown + 代码高亮 + 代码块复制

Preload（安全桥，contextBridge 暴露白名单 IPC）
  └─ window.qwen.{ settings / conversations / chatStream / abortChat / on* }

Main（主进程）
  ├─ qwenService.ts：调用 OpenAI 兼容 Chat Completions，解析 SSE 流
  ├─ llmProvider.ts：LLMProvider 抽象接口（首版仅 QwenChatProvider）
  ├─ settingsStore.ts：electron-store 存配置；API Key 用 safeStorage 加密
  ├─ conversationStore.ts：electron-store 存会话历史
  └─ chat 控制：用 Map<requestId, AbortController> 管理“停止生成”

Remote
  └─ Alibaba Cloud Model Studio / DashScope（OpenAI 兼容）
     Base URL 默认 https://dashscope.aliyuncs.com/compatible-mode/v1
```

Electron 安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，preload 只暴露白名单方法。

## 3. 技术选型

| 层 | 选型 | 说明 |
|----|------|------|
| 壳子 + 构建 | Electron + electron-vite + TypeScript | 一套配置同时管主进程/preload/renderer |
| 界面 | React + Zustand | Zustand 管会话与设置的界面状态 |
| 样式 | Tailwind CSS | |
| Markdown | react-markdown + remark-gfm + rehype-highlight | 表格/列表/代码高亮，代码块一键复制 |
| 本地存储 | electron-store | 配置与会话历史各一份 JSON |
| 密钥加密 | Electron safeStorage | OS 级加密，无需编译原生模块（不使用 keytar） |
| 网络请求 | 主进程内 `fetch`（undici） | 不在 renderer 直接发请求，密钥不出主进程 |
| 打包 | electron-builder | mac=dmg / win=nsis |
| 测试 | Vitest | 单测 SSE 解析、abort、错误路径；用假流验证 |

### 相对 `two-days_plan.md` 的三处调整
1. **密钥存储用 safeStorage**（而非计划里的“先明文、后 keytar”）：存盘即加密，免编译原生模块。
2. **直接搭在仓库根目录**（而非新建 `qwen-studio-electron/` 子目录）：本仓库即 qwen-studio 且基本为空。
3. **LLM 接口做一层抽象**：首版只接 Chat Completions，后续可加 Responses API 而不动 UI。

## 4. 目录结构

```text
qwen-studio/
  package.json
  electron.vite.config.ts
  tailwind.config.js  postcss.config.js
  index.html
  src/
    main/
      index.ts              # 创建窗口、注册 IPC
      qwenService.ts        # SSE 流式调用 + 解析
      llmProvider.ts        # LLMProvider 接口 + QwenChatProvider
      settingsStore.ts      # 配置存取 + safeStorage 加解密
      conversationStore.ts  # 会话历史存取
    preload/
      index.ts              # contextBridge 暴露 window.qwen
    renderer/
      main.tsx  App.tsx
      pages/ChatPage.tsx
      components/
        Sidebar.tsx  ChatInput.tsx  MessageBubble.tsx
        MarkdownMessage.tsx  SettingsDialog.tsx
        ModelSelect.tsx  WelcomeState.tsx
      store/chatStore.ts  settingsStore.ts
      types/chat.ts
  src/main/__tests__/qwenService.test.ts
```

## 5. 接口与数据模型

### Preload 暴露的 IPC（renderer 调用）
```ts
window.qwen = {
  getSettings(): Promise<AppSettings>;
  saveSettings(s: Partial<AppSettings>): Promise<void>;
  hasApiKey(): Promise<boolean>;            // 不回传明文 Key

  listConversations(): Promise<Conversation[]>;
  createConversation(title?: string): Promise<Conversation>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;

  chatStream(payload: ChatStreamRequest): Promise<void>;
  abortChat(requestId: string): Promise<void>;

  onChatDelta(cb: (e: ChatDeltaEvent) => void): () => void;
  onChatUsage(cb: (e: ChatUsageEvent) => void): () => void;
  onChatDone(cb: (e: ChatDoneEvent) => void): () => void;
  onChatError(cb: (e: ChatErrorEvent) => void): () => void;
};
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
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  baseUrl: string;     // 默认 https://dashscope.aliyuncs.com/compatible-mode/v1
  model: string;       // 默认 qwen-plus
  temperature: number; // 默认 0.7
  systemPrompt: string;// 默认 "You are Qwen, a helpful assistant."
  // apiKey 不放这里；单独经 safeStorage 加密存储
}

export interface ChatStreamRequest {
  requestId: string;
  conversationId: string;
  model?: string;
  temperature?: number;
  messages: { role: ChatRole; content: string }[];
}
```

### 默认配置
```json
{
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen-plus",
  "temperature": 0.7,
  "systemPrompt": "You are Qwen, a helpful assistant."
}
```

## 6. 数据流（发一条消息）

1. 用户在输入框发送 → renderer 把当前会话历史（含 systemPrompt）组装成 `ChatStreamRequest`，生成 `requestId`。
2. 经 `window.qwen.chatStream` 进主进程；主进程从 safeStorage 取出 Key，调 `${baseUrl}/chat/completions`，`stream: true`、`stream_options.include_usage: true`。
3. 主进程逐块读取 SSE，按 `\n\n` 切事件、取 `data:` 行；`[DONE]` 即结束；逐段 `onDelta` 推回 renderer；末尾 `usage` 经 `onChatUsage` 推回。
4. renderer 把 delta 追加到 streaming 状态的 assistant 消息；收到 `chat:done` 后把消息标 done 并落盘保存。
5. 点“停止”→ `abortChat(requestId)` → 主进程 `AbortController.abort()`；已显示文字保留，消息标 done(aborted)。

## 7. 功能清单（本版 P0+P1 全做）

P0：API Key 设置（safeStorage）、Chat Completions 调用、流式渲染、会话历史本地持久化、停止生成、错误提示（无 Key/Key 错/模型错/网络断/超时）。

P1：Markdown 渲染、代码块复制、模型下拉（qwen-plus / qwen-turbo / qwen-max / 自定义）、首页欢迎态 + 推荐 prompt、单条消息操作（复制/重答/删除）、会话标题自动取首条用户消息、usage 展示、快捷键（Cmd/Ctrl+Enter 发送、Esc 停止）、输入框自动增高、electron-builder 打包配置。

## 8. 错误处理

| 场景 | 表现 |
|------|------|
| 未配置 Key | 发送时提示“请先配置 API Key”，并引导打开设置页 |
| Key 错（401/403） | 弹出清晰错误文案，不白屏 |
| 模型名错（400/404） | 提示模型不可用 |
| 网络断 / 超时 | 提示并提供重试 |
| 流中途异常 chunk | 单块解析失败时跳过，不中断整段生成 |
| 会话隔离 | 用 requestId 绑定会话，正在生成的回复不串到其它会话 |

## 9. 测试与验收

**自动测试（不花钱，Vitest）：** SSE 解析（含跨 chunk 边界）、`[DONE]` 终止、abort 行为、`onUsage` 解析、HTTP 错误抛出。用内存里的假 ReadableStream 喂数据。

**端到端（用用户提供的真实 Key）：** 发“你好，请用一句话介绍你自己”能逐字输出；填错 Key 弹清晰报错；关闭重开历史还在；切换会话不丢消息；生成中点停止立即停。

**计划验收清单（来自 two-days_plan.md 第 7 节）逐条对照：** Key 未填 / Key 错 / 普通问题 / 长回答 / 停止生成 / 会话切换 / 关闭重开 / Markdown / 网络断 / 模型切换。

## 10. 二阶段（不在本版）

后端 BFF 代理（避免平台 Key 下发）、Responses API（联网搜索/代码解释器/知识库）、SQLite 替换 electron-store、文件上传问答、自动更新与签名、多模态。
