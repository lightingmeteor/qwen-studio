# Qwen Studio 0.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 0.3 conversation asset management: pinned/archived conversations, local search, export, usage summary, connection diagnostics, message edit/regenerate, and richer chat error details.

**Architecture:** Keep the current Electron main/preload/renderer split. Main owns persistence, native save dialogs, file writing, API-key access, and network diagnostics. Renderer owns local search/filter UI and calls main only through typed preload methods. Add small pure helper modules so `ipc.ts` and `chatStore.ts` do not absorb every new behavior.

**Tech Stack:** Electron, electron-vite, React, Zustand, TypeScript, Vitest, electron-store.

---

## File Structure

- `src/shared/types.ts`: extend persisted and IPC types.
- `src/shared/conversationUtils.ts`: pure local search, sort, usage summary, Markdown/JSON export serialization.
- `src/shared/diagnostics.ts`: pure diagnostic category mapping.
- `src/shared/__tests__/conversationUtils.test.ts`: shared helper tests.
- `src/shared/__tests__/diagnostics.test.ts`: diagnostic mapping tests.
- `src/shared/api.ts`: extend preload contract.
- `src/preload/index.ts`: expose new IPC methods.
- `src/main/conversationStore.ts`: preserve metadata, add pin/archive and lookup helpers.
- `src/main/conversationExport.ts`: native save-dialog and filesystem export orchestration.
- `src/main/qwenService.ts`: add non-streaming connection test and richer API error detail.
- `src/main/ipc.ts`: validate new inputs and register handlers.
- `src/main/__tests__/conversationStore.test.ts`: metadata persistence tests.
- `src/main/__tests__/qwenService.test.ts`: diagnostic connection tests.
- `src/renderer/store/chatStore.ts`: add pin/archive/export/edit actions and derived helpers.
- `src/renderer/store/chatStore.test.ts`: store behavior tests.
- `src/renderer/components/Sidebar.tsx`: search, filter, pin/archive actions.
- `src/renderer/pages/ChatPage.tsx`: usage summary and export controls.
- `src/renderer/components/MessageBubble.tsx`: edit action and error detail disclosure.
- `src/renderer/components/SettingsDialog.tsx`: connection test UI.
- `README.md`: document 0.3 features.

## Task 1: Shared Types And Pure Helpers

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/conversationUtils.ts`
- Create: `src/shared/diagnostics.ts`
- Create: `src/shared/__tests__/conversationUtils.test.ts`
- Create: `src/shared/__tests__/diagnostics.test.ts`

- [ ] **Step 1: Write failing shared helper tests**

Add tests for:

- `sortConversationsForDisplay`: pinned first, then `updatedAt` desc; archived conversations only appear when requested.
- `searchConversations`: case-insensitive title and message search.
- `summarizeUsage`: sums `promptTokens`, `completionTokens`, `totalTokens` only from messages with usage.
- `serializeConversationMarkdown`: includes title, ISO timestamps, role headings, content, and usage.
- `buildConversationExport`: returns `{ version: 1, exportedAt, conversations }`.
- `classifyDiagnosticError`: maps 401/403 to `auth`, 400/404 to `region_or_model`, timeout to `timeout`, `TypeError` network failures to `network`.

Run:

```bash
npm test src/shared/__tests__/conversationUtils.test.ts src/shared/__tests__/diagnostics.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 2: Extend shared types**

Add:

- `Conversation.pinned?: boolean`
- `Conversation.archived?: boolean`
- `ChatMessage.errorDetail?: string`
- `UsageSummary`
- `ConversationExport`
- `ExportResult`
- `DiagnosticCategory`
- `ConnectionDiagnostic`
- optional `ChatErrorEvent.detail?: string`

- [ ] **Step 3: Implement pure helper modules**

Implement helpers with no Electron imports and no filesystem access.

Rules:

- `sortConversationsForDisplay(conversations, { includeArchived })` filters archived conversations unless `includeArchived` is true.
- Pinned conversations sort before unpinned conversations.
- Conversations with the same pinned state sort by `updatedAt` descending.
- Search trims the query; blank query returns the already-filtered/sorted list.
- Markdown export must not include settings or API keys.
- JSON export must include only conversations and envelope metadata.

- [ ] **Step 4: Verify shared tests**

Run:

```bash
npm test src/shared/__tests__/conversationUtils.test.ts src/shared/__tests__/diagnostics.test.ts
npm run typecheck
```

Expected: PASS.

## Task 2: Main-Process Conversation Metadata, Export, And IPC Contract

**Files:**
- Modify: `src/main/conversationStore.ts`
- Create: `src/main/conversationExport.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`
- Create: `src/main/__tests__/conversationStore.test.ts`

- [ ] **Step 1: Write failing conversation-store tests**

Add tests for:

- Old conversations without metadata remain valid.
- Malformed `pinned`/`archived` values are repaired or dropped.
- `setConversationPinned(id, pinned)` updates only that conversation and refreshes `updatedAt`.
- `setConversationArchived(id, archived)` updates only that conversation and refreshes `updatedAt`.
- `getConversation(id)` returns the repaired conversation or `undefined`.

Run:

```bash
npm test src/main/__tests__/conversationStore.test.ts
```

Expected: FAIL because APIs do not exist.

- [ ] **Step 2: Implement store metadata APIs**

Add:

- `getConversation(id: string): Conversation | undefined`
- `setConversationPinned(id: string, pinned: boolean): Conversation`
- `setConversationArchived(id: string, archived: boolean): Conversation`

Preserve metadata in `repairConversation`. Validate optional metadata as booleans only.

- [ ] **Step 3: Add export orchestration**

Create `conversationExport.ts` with injectable dependencies for tests where practical:

- `exportConversationMarkdown(conversation, dialog, fs)`
- `exportConversationsJson(conversations, dialog, fs)`

Use `serializeConversationMarkdown` and `buildConversationExport`. Return `ExportResult`.

- [ ] **Step 4: Extend API and preload contract**

Add `QwenApi` methods:

- `setConversationPinned(id, pinned)`
- `setConversationArchived(id, archived)`
- `exportConversationMarkdown(id)`
- `exportConversationsJson()`

Expose matching IPC invokes in preload.

- [ ] **Step 5: Register IPC handlers**

Add handlers:

- `convo:setPinned`
- `convo:setArchived`
- `convo:exportMarkdown`
- `convo:exportJson`

Validate `id` as non-empty string and flags as booleans. Export handlers must not accept renderer-provided paths.

- [ ] **Step 6: Verify main metadata path**

Run:

```bash
npm test src/main/__tests__/conversationStore.test.ts
npm test
npm run typecheck
```

Expected: PASS.

## Task 3: Qwen Connection Diagnostics And Error Details

**Files:**
- Modify: `src/main/qwenService.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/store/chatStore.ts`
- Modify: `src/renderer/components/MessageBubble.tsx`
- Modify: `src/main/__tests__/qwenService.test.ts`

- [ ] **Step 1: Write failing qwenService diagnostic tests**

Add tests for:

- `buildConnectionTestBody(model)` creates a non-streaming minimal Chat Completions body.
- `testQwenConnection` returns ok for an ok response.
- 401/403 returns `auth`.
- 400/404 returns `region_or_model`.
- `TypeError` returns `network`.
- idle timeout returns `timeout`.

Run:

```bash
npm test src/main/__tests__/qwenService.test.ts
```

Expected: FAIL because diagnostic APIs do not exist.

- [ ] **Step 2: Implement diagnostic service**

Add:

- `buildConnectionTestBody`
- `testQwenConnection`

Reuse `buildEndpoint`. Use current settings and API key from main only.

- [ ] **Step 3: Add diagnostic IPC bridge**

Add `testConnection(patch?: Partial<AppSettings> & { apiKey?: string })` to `QwenApi`.

Main behavior:

- If renderer supplies non-empty `apiKey`, use it for the test but do not save it.
- Otherwise use saved API key.
- If no usable key exists, return `missing_key`.
- Reject unresolved base URL templates as `config`.

- [ ] **Step 4: Preserve chat error detail**

Extend chat error event payloads with optional `detail`. Store `detail` on assistant message `errorDetail`. `MessageBubble` displays a `<details>` block only when detail exists.

- [ ] **Step 5: Verify diagnostic path**

Run:

```bash
npm test src/main/__tests__/qwenService.test.ts
npm test
npm run typecheck
```

Expected: PASS.

## Task 4: Renderer Store Behaviors

**Files:**
- Modify: `src/renderer/store/chatStore.ts`
- Modify: `src/renderer/store/chatStore.test.ts`

- [ ] **Step 1: Extend fake preload API in tests**

Add test doubles for all new `QwenApi` methods.

- [ ] **Step 2: Write failing store tests**

Add tests for:

- Pinning a conversation calls bridge and updates local state.
- Archiving an inactive conversation calls bridge and updates local state.
- Archiving the active conversation selects the next non-archived conversation.
- Archiving a streaming conversation aborts that conversation first.
- Export actions call the bridge and return the bridge result.
- Editing a user message removes that message and all following messages, then sends the edited text.
- Editing is ignored while the active conversation is streaming.

Run:

```bash
npm test src/renderer/store/chatStore.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement chatStore APIs**

Add methods:

- `setConversationPinned(id, pinned)`
- `setConversationArchived(id, archived)`
- `exportActiveConversationMarkdown()`
- `exportAllConversationsJson()`
- `editAndResend(messageId, text)`

Rules:

- Archiving active conversation moves `activeId` to the first visible non-archived conversation, or `null`.
- Archiving a streaming conversation aborts and removes its route.
- Export methods surface bridge results to the caller.
- Edit-and-resend follows the existing regenerate pattern but uses edited text.

- [ ] **Step 4: Verify renderer store**

Run:

```bash
npm test src/renderer/store/chatStore.test.ts
npm test
npm run typecheck
```

Expected: PASS.

## Task 5: Renderer UI Integration

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/pages/ChatPage.tsx`
- Modify: `src/renderer/components/MessageBubble.tsx`
- Modify: `src/renderer/components/SettingsDialog.tsx`
- Modify: `src/renderer/index.css` if needed for compact controls.

- [ ] **Step 1: Sidebar search and filters**

Implement local state:

- `query`
- `filter: 'all' | 'pinned' | 'archived'`

Use shared helper functions to derive visible conversations. Empty states must depend on the filtered list, not raw conversation count.

- [ ] **Step 2: Sidebar actions**

Add compact icon/text controls for:

- pin/unpin
- archive when not archived
- restore when archived
- rename
- delete

Keep existing click-to-select behavior and `stopPropagation` inside action buttons.

- [ ] **Step 3: Chat header export and usage**

Add:

- current conversation usage summary
- export current conversation Markdown
- export all JSON

Display export success or failure as a small transient status near the header controls.

- [ ] **Step 4: Message editing and error details**

Add edit action for user messages. Use an inline textarea or prompt-style compact editor, but do not allow editing while streaming. Add error detail disclosure for assistant error messages.

- [ ] **Step 5: Settings connection test UI**

Add button and status area. The test should use currently typed form values, including unsaved API key if present. Reuse unresolved template validation before calling main.

- [ ] **Step 6: Verify UI buildability**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: PASS.

## Task 6: Documentation And 0.3 Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/next-improvement-directions.md` if needed to mark 0.3 as implemented.

- [ ] **Step 1: Update README**

Document:

- pinned and archived conversations
- local search
- Markdown/JSON export
- usage summary
- connection test
- message edit and resend

- [ ] **Step 2: Run full verification**

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
- only intentional files changed

- [ ] **Step 3: 0.3 completion commit**

Commit all 0.3 changes:

```bash
git add docs README.md src
git commit -m "feat: add qwen studio 0.3 conversation management"
```

## Self-Review

- Spec coverage: every 0.3 design requirement maps to at least one task.
- Placeholder scan: no unresolved TODO/TBD items are intentionally left.
- Type consistency: method names use `setConversationPinned`, `setConversationArchived`, `exportConversationMarkdown`, `exportConversationsJson`, and `testConnection` consistently.
- Scope check: 0.4 Responses API work is excluded from this plan and will receive its own design and plan after 0.3 passes verification.

