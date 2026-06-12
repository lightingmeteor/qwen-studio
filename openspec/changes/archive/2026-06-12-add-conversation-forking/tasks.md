# Tasks: add-conversation-forking

## 1. 数据模型与持久化

- [x] 1.1 `src/shared/types.ts`：新增 `ForkOrigin` 接口，`Conversation` 增加可选 `forkedFrom` 字段；`ChatErrorEvent` 增加可选 `code` 字段
- [x] 1.2 `src/main/conversationStore.ts`：`isConversation` / `repairConversation` 增加 `forkedFrom` 校验（不合法时丢字段、标记 repaired、保留会话）
- [x] 1.3 `src/main/conversationStore.ts`：新增 `forkConversation(sourceId, messageId)` —— 校验分叉点为 `done` 状态的 user/assistant 消息，深拷贝前缀（含分叉点），生成标题 `<原标题>（分叉）`、写入 `forkedFrom`（含标题快照与 1-based 可见序号快照），插入会话列表头部并持久化
- [x] 1.4 `src/main/conversationStore.ts` 测试：fork 正常路径、源会话不变、分叉点非法（不存在 / 非 done / system 消息）报错、forkedFrom 损坏修复、旧数据兼容

## 2. IPC 与 preload

- [x] 2.1 `src/main/ipc.ts`：新增 `convo:fork` handler（入参校验 sourceId / messageId 为非空字符串）
- [x] 2.2 `src/preload/index.ts` 与 `src/renderer/global.d.ts`：暴露 `forkConversation(sourceId, messageId)`
- [x] 2.3 `src/main/ipc.ts` 测试：convo:fork 参数校验与成功路径

## 3. Renderer store

- [x] 3.1 `src/renderer/store/chatStore.ts`：新增 `fork(messageId)` action —— 调 `convo:fork`，将新会话插入列表并切换 activeId
- [x] 3.2 `src/renderer/store/chatStore.ts`：新增 `forkAndResend(messageId, text)` action —— fork 出不含被编辑消息的前缀（分叉点为其前一条消息；被编辑消息是首条时走"空前缀的新会话 + forkedFrom"路径），切换后用现有 send 流程发送编辑后文本
- [x] 3.3 `src/renderer/store/chatStore.ts`：send 错误处理识别 `code: 'previous_response_invalid'` —— 若本次请求带过 `previousResponseId` 则自动重试一次（全量历史、不带 id），同一消息最多重试一次
- [x] 3.4 `src/renderer/store/chatStore.test.ts`：fork / forkAndResend / 失效回退（含回退后再失败不循环）用例

## 4. Responses 失效识别

- [x] 4.1 `src/main/qwenService.ts`：Responses 路径识别 4xx 错误体中的 `previous_response_id` 失效类标识，错误事件携带 `code: 'previous_response_invalid'`
- [x] 4.2 `src/main/__tests__/qwenService.test.ts`：失效错误识别用例（命中与不命中各一）

## 5. UI

- [x] 5.1 `src/renderer/components/MessageBubble.tsx`：悬停菜单新增"从这里分叉"（仅 `done` 状态的 user/assistant 消息显示）；编辑态新增"分叉后发送"按钮，与"重新发送"并列
- [x] 5.2 `src/renderer/pages/ChatPage.tsx`：分叉来源横幅 —— 原会话存在时显示实时标题、可点击（切换会话 + 滚动定位到分叉点消息，消息已删则只切换）；原会话不存在时用快照纯文本展示
- [x] 5.3 滚动定位：消息列表支持按 messageId 滚动到指定消息（横幅跳回使用）

## 6. 导出

- [x] 6.1 `src/main/conversationExport.ts`：单会话 Markdown 导出头部增加分叉来源注记（实现位于 `serializeConversationMarkdown`，`src/shared/conversationUtils.ts`）；JSON 导出经确认自然携带 `forkedFrom`，无需改码
- [x] 6.2 `src/main/__tests__/conversationExport.test.ts`：分叉会话的 Markdown 注记与 JSON 字段用例

## 7. 验证

- [x] 7.1 `npm test`、`npm run typecheck`、`npm run build` 全部通过（165 tests / 13 files，typecheck 与 build 干净）
- [x] 7.2 手动冒烟：分叉、横幅跳回与定位、原会话删除后降级、编辑后两种发送方式、Chat Completions 与 Responses 两种模式下分叉续聊（用户于 2026-06-12 在本机验证通过）
