# Proposal: add-conversation-forking

## Why

当前"编辑后重发"和"重新生成"都是破坏性操作（`slice(0, idx)` 直接丢弃该消息之后的全部内容），用户没有任何方式在保留原对话的前提下从中间某个好状态重新出发。长对话一旦跑偏，模型会被自己之前的错误回答持续带偏，用户只能在被污染的上下文上继续纠正。会话分叉让用户从任意消息处复制出一条干净的新对话——在 Chat Completions 模式下每轮本来就全量重发历史，分叉零额外成本；在 Responses 模式下已存的 `providerResponseId` 天生就是分叉指针。该改动优先级排在 0.5（文件/多模态）之前。

## What Changes

- 消息悬停操作菜单新增"从这里分叉"：从该消息处（含该消息）复制出一个新会话，原会话原样保留。
- `Conversation` 增加可选 `forkedFrom: { conversationId, messageId }` 元数据。
- 分叉出的新会话顶部显示来源横幅"分叉自 <原会话标题> 第 N 条"，点击跳回原会话并定位到分叉点消息；原会话被删除时横幅降级为不可点击的纯文本。
- "编辑后重发"保留两个选项：原地编辑（现状，截断后续）和"分叉后编辑"（在新会话中编辑重发，原会话不动）。
- Responses 模式下，分叉出的会话沿用复制消息上的 `providerResponseId` 作为 `previous_response_id` 续聊；id 失效时回退为全量重发消息历史。
- 导出 JSON 包含 `forkedFrom` 字段（envelope version 保持 1，新增字段为可选，不破坏旧数据读取）。

## Capabilities

### New Capabilities

- `conversation-forking`: 从任意消息处分叉出新会话、分叉来源的展示与跳转、编辑重发的分叉选项、Responses 模式分叉续聊与降级。

### Modified Capabilities

<!-- openspec/specs/ 目前为空，无既有 spec 需要修改 -->

## Impact

- `src/shared/types.ts`：`Conversation` 增加 `forkedFrom` 可选字段。
- `src/renderer/store/chatStore.ts`：新增 fork action；`editAndResend` 增加分叉变体。
- `src/main/conversationStore.ts` / `src/main/ipc.ts` / `src/preload/index.ts`：新增创建分叉会话的 IPC 通道（或扩展现有 createConversation），持久化 `forkedFrom`。
- `src/renderer/components/MessageBubble.tsx`：悬停菜单新增"从这里分叉"；编辑态新增"分叉后重发"。
- `src/renderer/pages/ChatPage.tsx`：会话顶部分叉来源横幅与跳转。
- `src/main/conversationExport.ts`：JSON 导出携带 `forkedFrom`。
- `src/main/qwenService.ts`：Responses 模式 `previous_response_id` 失效错误的识别与回退（仅识别错误类别，回退逻辑在 renderer 发起）。
- 测试：chatStore、conversationStore、ipc、conversationExport 相应用例。
