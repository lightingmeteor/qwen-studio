# Qwen Studio 0.4 Responses API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Qwen Responses API streaming support with `previous_response_id` context and `web_search` as the first built-in tool, while preserving Chat Completions as the stable default path.

**Architecture:** Split SSE parsing into generic frames and API-specific mappers. Add a Responses service path beside the existing Chat Completions path, then thread typed response/tool events through IPC and the renderer store. Settings control API mode and web search; Chat Completions remains backward compatible.

**Tech Stack:** Electron, electron-vite, React, Zustand, TypeScript, Vitest, Model Studio OpenAI-compatible Chat Completions and Responses APIs.

---

## File Structure

- `src/shared/types.ts`: add API mode, built-in tool, response/tool event and provider metadata types.
- `src/shared/api.ts`: add response/tool bridge subscriptions.
- `src/preload/index.ts`: expose response/tool subscriptions.
- `src/main/sse.ts`: split generic SSE frame parsing from Chat Completions mapping, add Responses mapping.
- `src/main/qwenService.ts`: add Responses endpoint/body/streaming functions.
- `src/main/llmProvider.ts`: evolve provider contract while keeping `streamChat` compatibility.
- `src/main/ipc.ts`: validate 0.4 request fields and send new response/tool events.
- `src/main/settingsStore.ts`: persist new default settings.
- `src/main/conversationStore.ts`: validate/repair new message metadata.
- `src/renderer/store/settingsStore.ts`: load/save new settings fields through existing settings contract.
- `src/renderer/store/chatStore.ts`: choose API mode, include tools, persist response id/tool events.
- `src/renderer/components/SettingsDialog.tsx`: API mode selector and web search toggle.
- `src/renderer/components/MessageBubble.tsx`: display tool event status.
- Tests under existing `src/main/__tests__`, `src/shared/__tests__`, and `src/renderer/store`.
- `README.md` and `docs/next-improvement-directions.md`: document 0.4.

## Task 1: Shared Types And SSE Mapping

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/sse.ts`
- Modify: `src/main/__tests__/sse.test.ts`

- [ ] **Step 1: Write failing SSE/type tests**

Add tests for:

- Generic SSE frame parsing handles multiple `data:` lines in one event by joining them with newlines.
- `[DONE]` ends parsing.
- Malformed JSON is skipped for API mappers.
- Existing Chat Completions delta/usage behavior remains.
- Responses mapper emits text delta for `response.output_text.delta`.
- Responses mapper emits response id and usage for `response.completed`.
- Responses mapper emits a `web_search` tool event for `response.web_search_call.in_progress` and/or a `web_search_call` output item.

Run:

```bash
npm test src/main/__tests__/sse.test.ts
```

Expected: FAIL for missing Responses mapper/generic parser exports.

- [ ] **Step 2: Extend shared types**

Add:

- `ApiMode = 'chat_completions' | 'responses'`
- `BuiltInTool = 'web_search'`
- `ToolEvent`
- `ChatResponseEvent`
- `ChatToolEvent`
- `ChatMessage.provider?: ApiMode`
- `ChatMessage.providerResponseId?: string`
- `ChatMessage.toolEvents?: ToolEvent[]`
- `AppSettings.apiMode`
- `AppSettings.webSearchEnabled`
- `ChatStreamRequest.apiMode?: ApiMode`
- `ChatStreamRequest.tools?: BuiltInTool[]`
- `ChatStreamRequest.previousResponseId?: string`

- [ ] **Step 3: Implement SSE frame parser and mappers**

Keep `parseSSEStream` behavior-compatible for current callers.

Add internal or exported helpers:

- `parseSSEDataStream(stream, handlers)`
- `parseChatCompletionsStream(stream, handlers)`
- `parseResponsesStream(stream, handlers)`

Rules:

- `parseSSEStream` may delegate to `parseChatCompletionsStream`.
- Unknown Responses events are ignored but call `onActivity`.
- usage maps `input_tokens/output_tokens/total_tokens` to existing `Usage`.

- [ ] **Step 4: Verify Task 1**

Run:

```bash
npm test src/main/__tests__/sse.test.ts
npm test
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/shared/types.ts src/main/sse.ts src/main/__tests__/sse.test.ts
git commit -m "feat: add responses sse event mapping"
```

## Task 2: Responses Service And Provider

**Files:**
- Modify: `src/main/qwenService.ts`
- Modify: `src/main/llmProvider.ts`
- Modify: `src/main/__tests__/qwenService.test.ts`

- [ ] **Step 1: Write failing qwenService tests**

Add tests for:

- `buildResponsesBaseUrl` converts known DashScope `/compatible-mode/v1` chat URLs to `/api/v2/apps/protocols/compatible-mode/v1`.
- `buildResponsesEndpoint` appends `/responses`.
- `buildResponsesRequestBody` includes `model`, `input`, `stream: true`, optional `previous_response_id`, and optional `tools`.
- Responses streaming calls fetch with Authorization and Content-Type.
- Responses streaming forwards delta/usage/response/tool events from `parseResponsesStream`.
- Chat Completions tests still pass.

Run:

```bash
npm test src/main/__tests__/qwenService.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement Responses service**

Add:

- `buildResponsesBaseUrl`
- `buildResponsesEndpoint`
- `buildResponsesRequestBody`
- `streamQwenResponses`

Use the same timeout, abort, redaction, and friendly error conventions as `streamQwenChat`.

- [ ] **Step 3: Evolve provider contract**

Add a turn-level provider input that can represent both modes:

- `apiMode`
- `tools`
- `previousResponseId`
- callbacks: `onDelta`, `onUsage`, `onResponseId`, `onToolEvent`

Keep `streamChat(input)` compatibility by routing it to Chat Completions.

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm test src/main/__tests__/qwenService.test.ts
npm test
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/main/qwenService.ts src/main/llmProvider.ts src/main/__tests__/qwenService.test.ts
git commit -m "feat: add qwen responses provider path"
```

## Task 3: IPC And Renderer Store Responses State

**Files:**
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/conversationStore.ts`
- Modify: `src/renderer/store/chatStore.ts`
- Modify: `src/renderer/store/chatStore.test.ts`
- Modify: `src/main/__tests__/ipc.test.ts`
- Modify: `src/main/__tests__/conversationStore.test.ts`

- [ ] **Step 1: Write failing IPC/store tests**

Add tests for:

- IPC validator accepts `apiMode: 'responses'`, `tools: ['web_search']`, and `previousResponseId`.
- IPC validator rejects unknown api mode and unknown tool.
- `chat:response` bridge event saves provider response id on the routed assistant message.
- `chat:tool` bridge event appends tool event to the routed assistant message.
- Responses mode send uses latest assistant `providerResponseId` as `previousResponseId`.
- Chat Completions mode does not send Responses-only fields.
- conversationStore preserves/repairs `provider`, `providerResponseId`, and `toolEvents`.

Run:

```bash
npm test src/main/__tests__/ipc.test.ts src/main/__tests__/conversationStore.test.ts src/renderer/store/chatStore.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Extend bridge contract**

Add `onChatResponse` and `onChatTool` to `QwenApi` and preload.

- [ ] **Step 3: Extend IPC**

Validate optional request fields. In `chat:stream`, call provider with:

- `apiMode: payload.apiMode ?? 'chat_completions'`
- `tools`
- `previousResponseId`
- send `chat:response` and `chat:tool` from provider callbacks.

- [ ] **Step 4: Extend renderer store**

`sendMessage` should read settings:

- Chat Completions: current behavior.
- Responses: set `apiMode`, include `tools: ['web_search']` when enabled, find latest assistant `providerResponseId`.

Add internal mutations:

- `setProviderResponseId(requestId, conversationId, messageId, responseId)`
- `appendToolEvent(requestId, conversationId, messageId, event)`

Persist after response id/tool events so context survives reload.

- [ ] **Step 5: Verify Task 3**

Run:

```bash
npm test src/main/__tests__/ipc.test.ts src/main/__tests__/conversationStore.test.ts src/renderer/store/chatStore.test.ts
npm test
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/shared/api.ts src/preload/index.ts src/main/ipc.ts src/main/conversationStore.ts src/renderer/store/chatStore.ts src/renderer/store/chatStore.test.ts src/main/__tests__/ipc.test.ts src/main/__tests__/conversationStore.test.ts
git commit -m "feat: route responses events through ipc and store"
```

## Task 4: Settings And Message UI

**Files:**
- Modify: `src/main/settingsStore.ts`
- Modify: `src/main/__tests__/settingsStore.test.ts`
- Modify: `src/renderer/components/SettingsDialog.tsx`
- Modify: `src/renderer/components/MessageBubble.tsx`
- Modify: `src/renderer/store/settingsStore.ts` only if needed.

- [ ] **Step 1: Write failing settings tests**

Add tests for:

- default settings include `apiMode: 'chat_completions'` and `webSearchEnabled: false`.
- saving settings persists `apiMode` and `webSearchEnabled`.
- invalid persisted values fall back to defaults if existing repair patterns support this.

Run:

```bash
npm test src/main/__tests__/settingsStore.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Persist 0.4 settings**

Update defaults and settings validation as needed.

- [ ] **Step 3: Add settings UI**

SettingsDialog:

- segmented/select control for API mode.
- checkbox/toggle for `web_search`, disabled unless Responses mode is selected.
- concise warning text that web search sends requests to online search and may affect cost.

- [ ] **Step 4: Add tool event UI**

MessageBubble:

- If assistant message has `toolEvents`, render a compact collapsible status row.
- Do not render raw tool result content.

- [ ] **Step 5: Verify Task 4**

Run:

```bash
npm test src/main/__tests__/settingsStore.test.ts
npm test
npm run typecheck
npm run build
```

Expected: PASS.

Commit:

```bash
git add src/main/settingsStore.ts src/main/__tests__/settingsStore.test.ts src/renderer/components/SettingsDialog.tsx src/renderer/components/MessageBubble.tsx src/renderer/store/settingsStore.ts
git commit -m "feat: add responses settings and tool status ui"
```

## Task 5: Documentation And 0.4 Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/next-improvement-directions.md`

- [ ] **Step 1: Update docs**

Document:

- Responses API mode.
- web_search toggle.
- Chat Completions remains default.
- Responses base URL compatibility note.
- 0.4 does not include web_extractor/code_interpreter/files.

- [ ] **Step 2: Full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
git status --short
```

Expected:

- tests pass
- typecheck passes
- build passes
- only intentional docs files changed before final commit

- [ ] **Step 3: Commit docs**

```bash
git add README.md docs/next-improvement-directions.md
git commit -m "docs: document qwen studio 0.4 responses mode"
```

## Self-Review

- Spec coverage: every 0.4 design requirement maps to a task.
- Placeholder scan: no planned work is left as TBD/TODO.
- Type consistency: `apiMode`, `webSearchEnabled`, `providerResponseId`, `ToolEvent`, `ChatResponseEvent`, and `ChatToolEvent` names are used consistently.
- Scope check: `web_extractor`, `code_interpreter`, file upload, Qwen-Long, custom function calling, and cloud sync are excluded from 0.4.

