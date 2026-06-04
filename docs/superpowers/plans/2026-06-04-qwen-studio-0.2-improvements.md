# Qwen Studio 0.2 Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a focused 0.2 improvement pass that makes chat generation per-conversation, refreshes Qwen presets, and improves release packaging coverage.

**Architecture:** Keep the existing Electron main/preload/renderer split. Replace the renderer's single global streaming request with a conversation-keyed map while keeping main-process request cancellation keyed by sender and requestId. Keep release changes in npm scripts and GitHub Actions.

**Tech Stack:** Electron, electron-vite, React, Zustand, TypeScript, Vitest, electron-builder, GitHub Actions.

---

## File Structure

- `src/renderer/store/chatStore.ts`: track active stream request ids by conversation.
- `src/renderer/store/chatStore.test.ts`: regression tests for concurrent per-conversation sends.
- `src/renderer/components/ChatInput.tsx`: compute streaming state for the active conversation.
- `src/renderer/components/MessageBubble.tsx`: disable message actions only while the active conversation is streaming.
- `src/shared/types.ts`: update model and base URL presets.
- `src/shared/__tests__/baseUrlPresets.test.ts`: verify preset coverage.
- `package.json`: add platform-specific dist scripts.
- `.github/workflows/macos-release.yml`: add macOS artifact build workflow.
- `README.md`: document the 0.2 behavior and release commands.

## Tasks

### Task 1: Per-Conversation Streaming

- [x] Write a failing Vitest regression showing a second conversation can send while the first is still streaming.
- [x] Replace `streamingRequestId` with `streamingByConversation`.
- [x] Update abort, regenerate, delete, finish, and fail flows to use the active conversation's request id.
- [x] Update ChatInput and MessageBubble selectors.
- [x] Run `npm test src/renderer/store/chatStore.test.ts`.

### Task 2: Presets

- [x] Add current Qwen preset names used by Model Studio examples and families.
- [x] Add Germany Frankfurt guidance as a workspace-template preset.
- [x] Update preset tests and README.
- [x] Run shared tests.

### Task 3: Release Coverage

- [x] Add `dist:mac` and `dist:linux` scripts.
- [x] Add a macOS GitHub Actions release workflow mirroring Windows artifact upload.
- [x] Document release commands.
- [x] Run `npm run typecheck`, `npm test`, and `npm run build`.

## Self-Review

- Spec coverage: covers the first recommended batch: release reliability, chat experience, and model/region presets.
- Placeholder scan: no deferred behavior; larger features such as auto-update, SQLite, Responses, and file upload remain outside this batch.
- Type consistency: renderer state changes are contained behind Zustand selectors and shared types stay unchanged except presets.
