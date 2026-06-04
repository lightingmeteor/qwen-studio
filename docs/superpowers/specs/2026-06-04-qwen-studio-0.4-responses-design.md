# Qwen Studio 0.4 Responses API 设计文档

日期：2026-06-04

## 目标

0.4 在 0.3 稳定基础上引入 Qwen OpenAI-compatible Responses API，并把 `web_search` 作为首个内置工具接入。目标是让用户可以在保留现有 Chat Completions 稳定路径的同时，选择 Responses 模式进行联网搜索型对话。

0.4 不接入 `web_extractor`、`code_interpreter`、文件上传、Qwen-Long、多模态、知识库搜索、自定义函数调用或云同步。这些能力需要额外的工具结果 UI、成本提示和持久化设计，留给后续版本。

## 官方能力依据

Alibaba Cloud Model Studio 文档说明：

- Responses API endpoint 为 `/responses`，地域 base URL 使用 `.../api/v2/apps/protocols/compatible-mode/v1`。
- Streaming 事件包括 `response.output_text.delta` 和 `response.completed`。
- 多轮上下文可用 `previous_response_id`，文档说明 response id 有有效期。
- 内置工具包括 `web_search`、`web_extractor`、`code_interpreter` 等。

参考：

- https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses
- https://www.alibabacloud.com/help/en/model-studio/web-search

## 用户能力

用户在 0.4 中应能做到：

- 在设置页选择 API 模式：`Chat Completions` 或 `Responses`。
- 在 Responses 模式下打开或关闭 `web_search`。
- 发送消息时，Responses 模式使用 `/responses` 流式接口。
- 回复正文仍像现有流式聊天一样逐字显示。
- 当模型产生 `response.id` 时，客户端保存到 assistant 消息上。
- 后续 Responses 轮次优先使用最近的 `providerResponseId` 作为 `previous_response_id`，减少手工拼接历史。
- 看到简洁的工具调用状态，例如“正在联网搜索”。
- Chat Completions 模式保持现有行为不退化。

## 架构

保留现有 main/preload/renderer 边界。

0.4 新增 Responses provider path，但不替换 Chat Completions。主进程根据请求中的 `apiMode` 选择 Chat Completions 或 Responses。Renderer 继续通过 `chat:stream` 发起一次用户 turn。

SSE 解析拆成两层：

1. 通用 SSE frame parser：只负责从 `ReadableStream` 读出 `data:` payload。
2. API-specific mapper：
   - Chat Completions mapper：保持现有 `choices[0].delta.content` 和 `usage` 行为。
   - Responses mapper：处理 `response.output_text.delta`、`response.completed`、`response.web_search_call.*` 等事件。

事件传回 renderer 时，保留现有 `chat:delta`、`chat:usage`、`chat:done`、`chat:error`。新增：

- `chat:response`：保存 provider response id。
- `chat:tool`：显示工具状态。

Renderer 老版本未知事件不会影响已有路径。

## Base URL 兼容

当前 0.3 设置里的 Base URL 多数是 Chat Completions 路径：

- `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
- `https://dashscope-us.aliyuncs.com/compatible-mode/v1`

Responses 文档使用：

- `https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1`
- `https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1`
- `https://dashscope-us.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1`

0.4 增加 `buildResponsesBaseUrl(baseUrl)`：

- 如果 baseUrl host 是已知 DashScope host 且 path 为 `/compatible-mode/v1`，自动转换为 `/api/v2/apps/protocols/compatible-mode/v1`。
- 如果 baseUrl 已经包含 `/api/v2/apps/protocols/compatible-mode/v1`，原样使用。
- 其它自定义 URL 只去掉末尾 `/` 后追加 `/responses`，并由连接诊断/错误提示反馈是否不可用。

不新增第二个 Base URL 输入框，避免设置页复杂度过早上升。

## 数据模型

新增 API 模式和工具设置：

```ts
export type ApiMode = 'chat_completions' | 'responses';
export type BuiltInTool = 'web_search';

interface AppSettings {
  apiMode: ApiMode;
  webSearchEnabled: boolean;
}
```

消息上保存 provider 元数据和工具状态：

```ts
interface ToolEvent {
  id: string;
  type: BuiltInTool;
  status: 'started' | 'completed' | 'failed';
  title: string;
  detail?: string;
}

interface ChatMessage {
  provider?: ApiMode;
  providerResponseId?: string;
  toolEvents?: ToolEvent[];
}
```

请求和事件扩展：

```ts
interface ChatStreamRequest {
  apiMode?: ApiMode;
  tools?: BuiltInTool[];
  previousResponseId?: string;
}

interface ChatResponseEvent {
  requestId: string;
  responseId: string;
}

interface ChatToolEvent {
  requestId: string;
  event: ToolEvent;
}
```

旧会话缺少这些字段时保持兼容。

## Responses 请求

Responses request body：

```ts
{
  model: string;
  input: string | Array<{ role: string; content: string }>;
  stream: true;
  previous_response_id?: string;
  tools?: Array<{ type: 'web_search' }>;
}
```

0.4 规则：

- 首轮 Responses 请求使用现有 messages 数组作为 `input`，保留 system prompt。
- 若当前会话存在最近的 assistant `providerResponseId`，下一轮请求带 `previous_response_id`，并只把当前用户输入作为 `input`。
- 如果没有 `previous_response_id`，使用消息数组兼容历史。
- `web_search` 只在 `apiMode === 'responses' && webSearchEnabled` 时发送。
- Chat Completions 请求体不带 Responses 字段。

## Responses 事件映射

Responses SSE mapper 处理：

- `response.output_text.delta`：发送 `chat:delta`。
- `response.completed`：提取 `response.id`，发送 `chat:response`；提取 `response.usage`，发送 `chat:usage`；随后主流程发送 `chat:done`。
- `response.web_search_call.in_progress` 或 output item `web_search_call`：发送工具 started/completed 状态。
- 其它未知事件忽略，但保留 activity reset，避免长工具调用被误判 idle timeout。

usage 字段映射到现有 `Usage`：

- `input_tokens` -> `promptTokens`
- `output_tokens` -> `completionTokens`
- `total_tokens` -> `totalTokens`

## Renderer 交互

设置页：

- 增加 API 模式选择。
- 增加 `web_search` 开关，仅 Responses 模式下可用。
- 保留测试连接。0.4 连接测试仍使用轻量 Chat Completions ping，不在本阶段强制测试 Responses，因为 Responses 模式可由首次请求反馈错误。

消息展示：

- Assistant 消息若有 `toolEvents`，在正文上方或下方显示折叠的工具状态。
- 工具状态不显示原始搜索结果正文，只显示简短状态，避免 UI 被复杂工具输出撑开。

发送逻辑：

- Chat Completions 模式保持现有全历史 messages。
- Responses 模式从当前会话找最近的 `providerResponseId`。
- 若找到，则 request 带 `previousResponseId` 并只发送当前用户输入加必要 system prompt策略。
- 若找不到，则 request 带当前兼容 messages 数组。

## 错误处理与安全

- Responses API 错误沿用 0.3 的 sanitized detail 机制。
- `web_search` 开关旁提示会联网，并可能增加模型调用成本。
- 不保存工具原始结果，只保存简短工具状态。
- `providerResponseId` 只用于同一会话后续请求，不跨会话复用。
- 如果 Responses base URL 不可用，错误提示用户检查地域/API 模式。

## 测试计划

0.4 使用 TDD 实施。

主进程测试：

- SSE 通用 parser 能处理多行 `data:`、`[DONE]`、malformed JSON 跳过策略。
- Chat Completions mapper 维持现有 delta/usage 行为。
- Responses endpoint/base URL 构造符合已知 DashScope host 转换规则。
- Responses request body 支持 `input`、`stream`、`previous_response_id`、`tools`。
- Responses SSE mapper 将 output_text delta、completed id/usage、web_search status 映射为 typed events。
- Chat Completions 现有测试不退化。

IPC/store 测试：

- `ChatStreamRequest` validator 接受合法 `apiMode`、`tools`、`previousResponseId`，拒绝非法 tool。
- Responses 模式发送时带最近 assistant `providerResponseId`。
- `chat:response` 事件保存到对应 assistant 消息。
- `chat:tool` 事件追加到对应 assistant 消息。
- Chat Completions 模式不带 Responses 字段。

Renderer 测试/验证：

- 设置页保存 API 模式和 web search 开关。
- MessageBubble 展示工具状态。
- `npm test`
- `npm run typecheck`
- `npm run build`

## 0.4 交付边界

0.4 完成时，应具备 Responses 模式和 web_search 开关，但默认仍可保持 Chat Completions。若用户不启用 Responses，0.3 的聊天体验、会话整理、导出和诊断保持不变。

