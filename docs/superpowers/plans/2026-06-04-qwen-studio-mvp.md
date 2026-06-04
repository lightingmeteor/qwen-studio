# Qwen Studio MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron + React + TypeScript desktop chat client for Qwen's OpenAI-compatible API with streaming output, local persistence, settings, Markdown rendering, abort, and packaging.

**Architecture:** UI (renderer) and backend (main process) are separated; the API key never leaves the main process. The renderer talks to main only through a whitelisted preload bridge (`window.qwen`). Main calls Qwen's OpenAI-compatible `/chat/completions` with `stream:true`, parses the SSE stream, and pushes deltas back to the renderer over IPC. Settings/history live in `electron-store`; the API key is encrypted with Electron `safeStorage`.

**Tech Stack:** Electron, electron-vite, TypeScript, React, Zustand, Tailwind CSS, react-markdown + remark-gfm + rehype-highlight, electron-store (v8, CJS), electron-builder, Vitest.

**Testing strategy:** Pure logic (SSE parsing, request building, error mapping, title/id helpers) is built test-first with Vitest. Electron-bound modules (stores using `safeStorage`/`electron-store`) and React UI are verified with `npm run typecheck` + `npm run build`, then a final live end-to-end pass using the user's real API key. Reason: the GUI and `safeStorage` need a running Electron app, which isn't a fit for fast unit tests; the risky logic is the stream parsing, and that is fully unit-tested via injected fake streams.

**Conventions for every task:** exact file paths, complete code (no placeholders), run the listed command and confirm the expected output before moving on, commit at the end of each task. Work on branch `feat/qwen-studio-mvp` (already created).

---

## File Structure

```text
qwen-studio/
  package.json                         # scripts + deps + electron-builder config
  electron.vite.config.ts              # main/preload/renderer build config
  tsconfig.json                        # single typecheck config
  vitest.config.ts                     # test runner config
  tailwind.config.js  postcss.config.js
  index.html                           # renderer entry HTML
  .gitignore
  src/
    shared/
      types.ts                         # all shared types + defaults + model presets
      api.ts                           # QwenApi interface (preload contract)
      id.ts                            # genId(prefix) helper            [TDD]
      title.ts                         # deriveTitle(text) helper        [TDD]
    main/
      index.ts                         # BrowserWindow + load renderer
      ipc.ts                           # registerIpc(): all ipcMain handlers + abort registry
      sse.ts                           # parseSSEStream(stream, handlers) [TDD]
      qwenService.ts                   # buildEndpoint/buildRequestBody/friendlyMessage/streamQwenChat [TDD]
      llmProvider.ts                   # LLMProvider + QwenChatProvider
      settingsStore.ts                 # settings + safeStorage-encrypted API key
      conversationStore.ts             # conversation CRUD via electron-store
      __tests__/
        sse.test.ts
        qwenService.test.ts
    preload/
      index.ts                         # contextBridge.exposeInMainWorld('qwen', api)
    renderer/
      global.d.ts                      # Window.qwen typing
      main.tsx                         # React root + css imports
      App.tsx                          # layout shell + bridge init
      index.css                        # tailwind + base styles
      store/
        settingsStore.ts               # zustand: settings + hasKey
        chatStore.ts                   # zustand: conversations + streaming flow
      pages/
        ChatPage.tsx                   # message list + input + top bar
      components/
        Sidebar.tsx                    # conversation list
        ChatInput.tsx                  # autosize textarea + shortcuts
        MessageBubble.tsx              # one message + per-message actions
        MarkdownMessage.tsx            # markdown render + code copy
        ModelSelect.tsx                # model dropdown
        SettingsDialog.tsx             # settings form
        WelcomeState.tsx               # empty-state welcome + prompt cards
  src/shared/__tests__/
    id.test.ts
    title.test.ts
```

---

### Task 1: Project scaffold (configs + install + blank window)

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/index.css`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "qwen-studio",
  "version": "0.1.0",
  "description": "Qwen Studio-like desktop chat client",
  "main": "out/main/index.js",
  "author": "qwen-studio",
  "license": "MIT",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "dist": "electron-vite build && electron-builder"
  },
  "dependencies": {
    "electron-store": "^8.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "electron": "^31.4.0",
    "electron-builder": "^24.13.3",
    "electron-vite": "^2.3.0",
    "highlight.js": "^11.10.0",
    "postcss": "^8.4.45",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1",
    "rehype-highlight": "^7.0.0",
    "remark-gfm": "^4.0.0",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5",
    "zustand": "^4.5.5"
  },
  "build": {
    "appId": "com.example.qwenstudio.desktop",
    "productName": "Qwen Studio Desktop",
    "directories": { "output": "release" },
    "files": ["out/**"],
    "mac": { "target": ["dmg"], "category": "public.app-category.productivity" },
    "win": { "target": ["nsis"] },
    "linux": { "target": ["AppImage"], "category": "Utility" }
  }
}
```

- [ ] **Step 2: Create `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'index.html') } },
    },
    plugins: [react()],
  },
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src", "electron.vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create `tailwind.config.js` and `postcss.config.js`**

`tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

`postcss.config.js`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Note: these two config files use ESM `export default`. The root `package.json` has no `"type": "module"`, so Node treats `.js` as CommonJS by default — but Vite/PostCSS/Tailwind load these through their own ESM-aware loaders, and electron-vite's renderer build handles them. If `npm run build` later errors that `export` is unexpected in these files, rename them to `tailwind.config.mjs` / `postcss.config.mjs` and re-run. Do this only if the error appears.

- [ ] **Step 6: Create `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;" />
    <title>Qwen Studio Desktop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `.gitignore`**

```gitignore
node_modules/
out/
release/
dist/
*.log
.DS_Store
```

- [ ] **Step 8: Create minimal `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Qwen Studio Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

Note: `sandbox: false` is required because the preload script imports `electron` and (later) the main process uses `safeStorage`/`electron-store`; context isolation + no node integration in the renderer still keep the renderer locked down. This is the standard electron-vite default.

- [ ] **Step 9: Create minimal `src/preload/index.ts`**

```ts
import { contextBridge } from 'electron';

// Real API is wired in a later task. Expose a placeholder so the renderer loads.
contextBridge.exposeInMainWorld('qwen', {});
```

- [ ] **Step 10: Create `src/renderer/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
}

html, body, #root {
  height: 100%;
  margin: 0;
}

body {
  background: #0f1117;
  color: #e6e7ea;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
```

- [ ] **Step 11: Create `src/renderer/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import 'highlight.js/styles/github-dark.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 12: Create minimal `src/renderer/App.tsx`**

```tsx
export default function App(): JSX.Element {
  return (
    <div className="h-full flex items-center justify-center text-lg">
      Qwen Studio Desktop — scaffold OK
    </div>
  );
}
```

- [ ] **Step 13: Install dependencies**

Run: `npm install`
Expected: completes without error; `node_modules/` created. (Electron downloads a prebuilt binary; if the download is slow, allow it to finish.)

- [ ] **Step 14: Verify typecheck and build**

Run: `npm run typecheck`
Expected: no output / exit 0.

Run: `npm run build`
Expected: electron-vite builds main, preload, and renderer into `out/` with no errors.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: scaffold electron-vite + react + tailwind app shell"
```

---

### Task 2: Shared types and contract

**Files:**
- Create: `src/shared/types.ts`, `src/shared/api.ts`

- [ ] **Step 1: Create `src/shared/types.ts`**

```ts
export type ChatRole = 'system' | 'user' | 'assistant';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status?: MessageStatus;
  aborted?: boolean;
  error?: string;
  usage?: Usage;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  systemPrompt: string;
}

export interface ChatStreamRequest {
  requestId: string;
  conversationId: string;
  model?: string;
  temperature?: number;
  messages: { role: ChatRole; content: string }[];
}

export interface ChatDeltaEvent { requestId: string; text: string; }
export interface ChatUsageEvent { requestId: string; usage: Usage; }
export interface ChatDoneEvent { requestId: string; aborted?: boolean; }
export interface ChatErrorEvent { requestId: string; message: string; }

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
  temperature: 0.7,
  systemPrompt: 'You are Qwen, a helpful assistant.',
};

export const MODEL_PRESETS = ['qwen-plus', 'qwen-turbo', 'qwen-max'] as const;
```

- [ ] **Step 2: Create `src/shared/api.ts`**

```ts
import type {
  AppSettings,
  Conversation,
  ChatMessage,
  ChatStreamRequest,
  ChatDeltaEvent,
  ChatUsageEvent,
  ChatDoneEvent,
  ChatErrorEvent,
} from './types';

/** Settings patch may carry a plaintext apiKey; it is encrypted in main, never returned. */
export type SettingsPatch = Partial<AppSettings> & { apiKey?: string };

export interface QwenApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: SettingsPatch): Promise<void>;
  hasApiKey(): Promise<boolean>;

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
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add shared types and preload api contract"
```

---

### Task 3: `genId` and `deriveTitle` helpers (TDD)

**Files:**
- Create: `src/shared/id.ts`, `src/shared/title.ts`
- Test: `src/shared/__tests__/id.test.ts`, `src/shared/__tests__/title.test.ts`

- [ ] **Step 1: Write failing tests**

`src/shared/__tests__/id.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { genId } from '../id';

describe('genId', () => {
  it('prefixes the id', () => {
    expect(genId('m')).toMatch(/^m_/);
  });
  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => genId('c')));
    expect(ids.size).toBe(1000);
  });
});
```

`src/shared/__tests__/title.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveTitle } from '../title';

describe('deriveTitle', () => {
  it('returns fallback for empty text', () => {
    expect(deriveTitle('   ')).toBe('新会话');
  });
  it('collapses whitespace and trims', () => {
    expect(deriveTitle('  hello\n  world  ')).toBe('hello world');
  });
  it('truncates long text with ellipsis', () => {
    const t = deriveTitle('a'.repeat(50), 24);
    expect(t.length).toBe(25); // 24 chars + ellipsis
    expect(t.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../id` and `../title`.

- [ ] **Step 3: Create `src/shared/id.ts`**

```ts
export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}
```

- [ ] **Step 4: Create `src/shared/title.ts`**

```ts
export function deriveTitle(text: string, max = 24): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '新会话';
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add genId and deriveTitle helpers with tests"
```

---

### Task 4: SSE stream parser (TDD)

**Files:**
- Create: `src/main/sse.ts`
- Test: `src/main/__tests__/sse.test.ts`

- [ ] **Step 1: Write failing test**

`src/main/__tests__/sse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseSSEStream } from '../sse';
import type { Usage } from '../../shared/types';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
}

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

describe('parseSSEStream', () => {
  it('emits deltas in order', async () => {
    const out: string[] = [];
    await parseSSEStream(streamFromChunks([frame('Hello'), frame(' world'), 'data: [DONE]\n\n']), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('Hello world');
  });

  it('stops at [DONE] and ignores anything after', async () => {
    const out: string[] = [];
    await parseSSEStream(streamFromChunks([frame('A'), 'data: [DONE]\n\n', frame('B')]), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('A');
  });

  it('reassembles an event split across chunk boundaries', async () => {
    const f = frame('split');
    const mid = Math.floor(f.length / 2);
    const out: string[] = [];
    await parseSSEStream(streamFromChunks([f.slice(0, mid), f.slice(mid), 'data: [DONE]\n\n']), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('split');
  });

  it('ignores malformed json chunks without throwing', async () => {
    const out: string[] = [];
    await parseSSEStream(streamFromChunks(['data: {not json}\n\n', frame('ok'), 'data: [DONE]\n\n']), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('ok');
  });

  it('maps usage from snake_case to camelCase', async () => {
    let usage: Usage | undefined;
    const usageFrame = `data: ${JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    })}\n\n`;
    await parseSSEStream(streamFromChunks([usageFrame, 'data: [DONE]\n\n']), {
      onDelta: () => {},
      onUsage: (u) => { usage = u; },
    });
    expect(usage).toEqual({ promptTokens: 3, completionTokens: 5, totalTokens: 8 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../sse`.

- [ ] **Step 3: Create `src/main/sse.ts`**

```ts
import type { Usage } from '../shared/types';

export interface SSEHandlers {
  onDelta: (text: string) => void;
  onUsage?: (usage: Usage) => void;
}

function mapUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, number>;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

export async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  handlers: SSEHandlers,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const data = line.replace(/^data:\s*/, '').trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) handlers.onDelta(delta);
        const usage = mapUsage(json?.usage);
        if (usage && handlers.onUsage) handlers.onUsage(usage);
      } catch {
        // Skip a single malformed chunk rather than aborting the whole stream.
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all sse tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add SSE stream parser with tests"
```

---

### Task 5: Qwen service — endpoint/body/error mapping + streaming (TDD)

**Files:**
- Create: `src/main/qwenService.ts`
- Test: `src/main/__tests__/qwenService.test.ts`

- [ ] **Step 1: Write failing test**

`src/main/__tests__/qwenService.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  buildEndpoint,
  buildRequestBody,
  friendlyMessage,
  streamQwenChat,
  QwenApiError,
} from '../qwenService';

function sseResponse(body: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('buildEndpoint', () => {
  it('appends /chat/completions and strips trailing slashes', () => {
    expect(buildEndpoint('https://x.com/v1/')).toBe('https://x.com/v1/chat/completions');
    expect(buildEndpoint('https://x.com/v1')).toBe('https://x.com/v1/chat/completions');
  });
});

describe('buildRequestBody', () => {
  it('enables streaming and usage', () => {
    const body = buildRequestBody({ model: 'qwen-plus', messages: [], temperature: 0.5 });
    expect(body).toMatchObject({
      model: 'qwen-plus',
      temperature: 0.5,
      stream: true,
      stream_options: { include_usage: true },
    });
  });
});

describe('friendlyMessage', () => {
  it('maps auth errors', () => {
    expect(friendlyMessage(401, '')).toContain('API Key');
    expect(friendlyMessage(403, '')).toContain('API Key');
  });
  it('maps rate limit and server errors', () => {
    expect(friendlyMessage(429, '')).toContain('频繁');
    expect(friendlyMessage(500, '')).toContain('服务端');
  });
});

describe('streamQwenChat', () => {
  it('streams deltas via injected fetch', async () => {
    const out: string[] = [];
    const fetchImpl = async () =>
      sseResponse(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n` +
          'data: [DONE]\n\n',
      );
    await streamQwenChat({
      apiKey: 'k',
      baseUrl: 'https://x.com/v1',
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hello' }],
      onDelta: (t) => out.push(t),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.join('')).toBe('hi');
  });

  it('throws QwenApiError on non-ok response', async () => {
    const fetchImpl = async () => new Response('bad key', { status: 401 });
    await expect(
      streamQwenChat({
        apiKey: 'k',
        baseUrl: 'https://x.com/v1',
        model: 'qwen-plus',
        messages: [],
        onDelta: () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(QwenApiError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../qwenService`.

- [ ] **Step 3: Create `src/main/qwenService.ts`**

```ts
import type { ChatRole, Usage } from '../shared/types';
import { parseSSEStream } from './sse';

export interface QwenMessage {
  role: ChatRole;
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
  onUsage?: (usage: Usage) => void;
  fetchImpl?: typeof fetch;
}

export class QwenApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(friendlyMessage(status, body));
    this.name = 'QwenApiError';
    this.status = status;
  }
}

export function buildEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export function buildRequestBody(o: {
  model: string;
  messages: QwenMessage[];
  temperature: number;
}) {
  return {
    model: o.model,
    messages: o.messages,
    temperature: o.temperature,
    stream: true,
    stream_options: { include_usage: true },
  };
}

function truncate(s: string, n = 200): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function friendlyMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或无权限，请检查设置里的 API Key。';
  if (status === 404) return '接口或模型不存在，请检查 Base URL 和模型名。';
  if (status === 400) return `请求被拒绝（400），可能是模型名或参数有误。${truncate(body)}`;
  if (status === 429) return '请求过于频繁或额度不足（429），请稍后再试。';
  if (status >= 500) return `服务端错误（${status}），请稍后再试。`;
  return `请求失败（${status}）。${truncate(body)}`;
}

export async function streamQwenChat(options: StreamChatOptions): Promise<void> {
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
  const doFetch = options.fetchImpl ?? fetch;

  const resp = await doFetch(buildEndpoint(baseUrl), {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRequestBody({ model, messages, temperature })),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    throw new QwenApiError(resp.status, text);
  }

  await parseSSEStream(resp.body, { onDelta, onUsage });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all qwenService tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add qwen service (endpoint/body/error mapping/streaming) with tests"
```

---

### Task 6: LLM provider abstraction

**Files:**
- Create: `src/main/llmProvider.ts`

- [ ] **Step 1: Create `src/main/llmProvider.ts`**

```ts
import type { Usage } from '../shared/types';
import { streamQwenChat, type QwenMessage } from './qwenService';

export interface StreamChatInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  messages: QwenMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onUsage?: (usage: Usage) => void;
}

export interface LLMProvider {
  streamChat(input: StreamChatInput): Promise<void>;
}

export class QwenChatProvider implements LLMProvider {
  async streamChat(input: StreamChatInput): Promise<void> {
    await streamQwenChat(input);
  }
}

export const defaultProvider: LLMProvider = new QwenChatProvider();
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add LLMProvider abstraction over qwen chat"
```

---

### Task 7: Settings store (electron-store + safeStorage)

**Files:**
- Create: `src/main/settingsStore.ts`

- [ ] **Step 1: Create `src/main/settingsStore.ts`**

```ts
import Store from 'electron-store';
import { safeStorage } from 'electron';
import { type AppSettings, DEFAULT_SETTINGS } from '../shared/types';

interface Persisted {
  settings: AppSettings;
  apiKeyEnc?: string; // base64 of encrypted (or, as fallback, plain) key bytes
}

const store = new Store<Persisted>({
  name: 'qwen-studio-config',
  defaults: { settings: DEFAULT_SETTINGS },
});

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...store.get('settings') };
}

export function saveSettings(patch: Partial<AppSettings>): void {
  store.set('settings', { ...getSettings(), ...patch });
}

export function setApiKey(key: string): void {
  if (!key) {
    store.delete('apiKeyEnc');
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    store.set('apiKeyEnc', safeStorage.encryptString(key).toString('base64'));
  } else {
    // Fallback when OS encryption is unavailable; the UI warns about this.
    store.set('apiKeyEnc', Buffer.from(key, 'utf-8').toString('base64'));
  }
}

export function getApiKey(): string {
  const enc = store.get('apiKeyEnc');
  if (!enc) return '';
  const buf = Buffer.from(enc, 'base64');
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      // Data was written via the plaintext fallback; read it back as utf-8.
      return buf.toString('utf-8');
    }
  }
  return buf.toString('utf-8');
}

export function hasApiKey(): boolean {
  return !!store.get('apiKeyEnc');
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add settings store with safeStorage-encrypted api key"
```

---

### Task 8: Conversation store (electron-store CRUD)

**Files:**
- Create: `src/main/conversationStore.ts`

- [ ] **Step 1: Create `src/main/conversationStore.ts`**

```ts
import Store from 'electron-store';
import { type Conversation, type ChatMessage } from '../shared/types';
import { genId } from '../shared/id';

interface Persisted {
  conversations: Conversation[];
}

const store = new Store<Persisted>({
  name: 'qwen-studio-conversations',
  defaults: { conversations: [] },
});

export function listConversations(): Conversation[] {
  return [...store.get('conversations')].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createConversation(title = '新会话'): Conversation {
  const now = Date.now();
  const conv: Conversation = {
    id: genId('c'),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  store.set('conversations', [conv, ...store.get('conversations')]);
  return conv;
}

export function renameConversation(id: string, title: string): void {
  store.set(
    'conversations',
    store.get('conversations').map((c) =>
      c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
    ),
  );
}

export function deleteConversation(id: string): void {
  store.set(
    'conversations',
    store.get('conversations').filter((c) => c.id !== id),
  );
}

export function saveMessages(id: string, messages: ChatMessage[]): void {
  store.set(
    'conversations',
    store.get('conversations').map((c) =>
      c.id === id ? { ...c, messages, updatedAt: Date.now() } : c,
    ),
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add conversation store CRUD"
```

---

### Task 9: IPC handlers + abort registry

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts` (call `registerIpc()`)

- [ ] **Step 1: Create `src/main/ipc.ts`**

```ts
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  getSettings,
  saveSettings,
  setApiKey,
  getApiKey,
  hasApiKey,
} from './settingsStore';
import * as convo from './conversationStore';
import { defaultProvider } from './llmProvider';
import type { ChatStreamRequest, ChatMessage } from '../shared/types';
import type { SettingsPatch } from '../shared/api';

const controllers = new Map<string, AbortController>();

export function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, patch: SettingsPatch) => {
    const { apiKey, ...rest } = patch ?? {};
    if (typeof apiKey === 'string') setApiKey(apiKey);
    saveSettings(rest);
  });
  ipcMain.handle('settings:hasApiKey', () => hasApiKey());

  ipcMain.handle('convo:list', () => convo.listConversations());
  ipcMain.handle('convo:create', (_e, title?: string) => convo.createConversation(title));
  ipcMain.handle('convo:rename', (_e, id: string, title: string) =>
    convo.renameConversation(id, title),
  );
  ipcMain.handle('convo:delete', (_e, id: string) => convo.deleteConversation(id));
  ipcMain.handle('convo:saveMessages', (_e, id: string, messages: ChatMessage[]) =>
    convo.saveMessages(id, messages),
  );

  ipcMain.handle('chat:stream', async (event: IpcMainInvokeEvent, payload: ChatStreamRequest) => {
    const settings = getSettings();
    const apiKey = getApiKey();
    if (!apiKey) {
      event.sender.send('chat:error', {
        requestId: payload.requestId,
        message: '请先在设置里配置 API Key。',
      });
      return;
    }

    const controller = new AbortController();
    controllers.set(payload.requestId, controller);

    try {
      await defaultProvider.streamChat({
        apiKey,
        baseUrl: settings.baseUrl,
        model: payload.model || settings.model,
        temperature: payload.temperature ?? settings.temperature,
        messages: payload.messages,
        signal: controller.signal,
        onDelta: (text) =>
          event.sender.send('chat:delta', { requestId: payload.requestId, text }),
        onUsage: (usage) =>
          event.sender.send('chat:usage', { requestId: payload.requestId, usage }),
      });
      event.sender.send('chat:done', { requestId: payload.requestId });
    } catch (err) {
      if (controller.signal.aborted) {
        event.sender.send('chat:done', { requestId: payload.requestId, aborted: true });
      } else {
        const message = err instanceof Error ? err.message : '未知错误';
        event.sender.send('chat:error', { requestId: payload.requestId, message });
      }
    } finally {
      controllers.delete(payload.requestId);
    }
  });

  ipcMain.handle('chat:abort', (_e, requestId: string) => {
    controllers.get(requestId)?.abort();
    controllers.delete(requestId);
  });
}
```

- [ ] **Step 2: Wire `registerIpc()` into `src/main/index.ts`**

Replace the contents of `src/main/index.ts` with:
```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpc } from './ipc';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Qwen Studio Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Verify typecheck and build**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: register ipc handlers and abort registry in main"
```

---

### Task 10: Preload bridge + renderer typings

**Files:**
- Modify: `src/preload/index.ts` (full implementation)
- Create: `src/renderer/global.d.ts`

- [ ] **Step 1: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { QwenApi } from '../shared/api';

function subscribe(channel: string) {
  return (cb: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  };
}

const api: QwenApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),

  listConversations: () => ipcRenderer.invoke('convo:list'),
  createConversation: (title) => ipcRenderer.invoke('convo:create', title),
  renameConversation: (id, title) => ipcRenderer.invoke('convo:rename', id, title),
  deleteConversation: (id) => ipcRenderer.invoke('convo:delete', id),
  saveMessages: (id, messages) => ipcRenderer.invoke('convo:saveMessages', id, messages),

  chatStream: (payload) => ipcRenderer.invoke('chat:stream', payload),
  abortChat: (requestId) => ipcRenderer.invoke('chat:abort', requestId),

  onChatDelta: subscribe('chat:delta') as QwenApi['onChatDelta'],
  onChatUsage: subscribe('chat:usage') as QwenApi['onChatUsage'],
  onChatDone: subscribe('chat:done') as QwenApi['onChatDone'],
  onChatError: subscribe('chat:error') as QwenApi['onChatError'],
};

contextBridge.exposeInMainWorld('qwen', api);
```

- [ ] **Step 2: Create `src/renderer/global.d.ts`**

```ts
import type { QwenApi } from '../shared/api';

declare global {
  interface Window {
    qwen: QwenApi;
  }
}

export {};
```

- [ ] **Step 3: Verify typecheck and build**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: implement preload bridge and renderer window typings"
```

---

### Task 11: Renderer state — settings store + chat store

**Files:**
- Create: `src/renderer/store/settingsStore.ts`, `src/renderer/store/chatStore.ts`

- [ ] **Step 1: Create `src/renderer/store/settingsStore.ts`**

```ts
import { create } from 'zustand';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/types';
import type { SettingsPatch } from '../../shared/api';

interface SettingsState {
  settings: AppSettings;
  hasKey: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  save: (patch: SettingsPatch) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hasKey: false,
  loaded: false,
  load: async () => {
    const [settings, hasKey] = await Promise.all([
      window.qwen.getSettings(),
      window.qwen.hasApiKey(),
    ]);
    set({ settings, hasKey, loaded: true });
  },
  save: async (patch) => {
    await window.qwen.saveSettings(patch);
    const [settings, hasKey] = await Promise.all([
      window.qwen.getSettings(),
      window.qwen.hasApiKey(),
    ]);
    set({ settings, hasKey });
    void get();
  },
}));
```

- [ ] **Step 2: Create `src/renderer/store/chatStore.ts`**

```ts
import { create } from 'zustand';
import {
  type Conversation,
  type ChatMessage,
  type ChatRole,
  type Usage,
} from '../../shared/types';
import { genId } from '../../shared/id';
import { deriveTitle } from '../../shared/title';
import { useSettingsStore } from './settingsStore';

// Routes streaming events (keyed by requestId) to the right conversation/message.
const routing = new Map<string, { conversationId: string; messageId: string }>();

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  streamingRequestId: string | null;

  loadConversations: () => Promise<void>;
  newConversation: () => Promise<void>;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  sendMessage: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;

  // Internal mutations driven by IPC events:
  appendDelta: (conversationId: string, messageId: string, text: string) => void;
  setUsage: (conversationId: string, messageId: string, usage: Usage) => void;
  finishMessage: (conversationId: string, messageId: string, aborted?: boolean) => void;
  failMessage: (conversationId: string, messageId: string, message: string) => void;
}

function updateMessages(
  conversations: Conversation[],
  conversationId: string,
  fn: (msgs: ChatMessage[]) => ChatMessage[],
): Conversation[] {
  return conversations.map((c) =>
    c.id === conversationId ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c,
  );
}

function findConversation(conversations: Conversation[], id: string | null): Conversation | undefined {
  return conversations.find((c) => c.id === id);
}

function persist(conversationId: string, conversations: Conversation[]): void {
  const conv = findConversation(conversations, conversationId);
  if (conv) void window.qwen.saveMessages(conversationId, conv.messages);
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  streamingRequestId: null,

  loadConversations: async () => {
    const conversations = await window.qwen.listConversations();
    set({
      conversations,
      activeId: get().activeId ?? conversations[0]?.id ?? null,
    });
  },

  newConversation: async () => {
    const conv = await window.qwen.createConversation();
    set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }));
  },

  selectConversation: (id) => set({ activeId: id }),

  renameConversation: async (id, title) => {
    await window.qwen.renameConversation(id, title);
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
  },

  deleteConversation: async (id) => {
    await window.qwen.deleteConversation(id);
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const activeId = s.activeId === id ? conversations[0]?.id ?? null : s.activeId;
      return { conversations, activeId };
    });
  },

  sendMessage: async (text) => {
    const content = text.trim();
    if (!content) return;

    let conversationId = get().activeId;
    if (!conversationId) {
      const conv = await window.qwen.createConversation();
      set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }));
      conversationId = conv.id;
    }

    const { settings } = useSettingsStore.getState();
    const now = Date.now();
    const userMsg: ChatMessage = { id: genId('m'), role: 'user', content, createdAt: now, status: 'done' };
    const assistantMsg: ChatMessage = {
      id: genId('m'),
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      status: 'streaming',
    };

    // Append both messages, and auto-title the conversation from the first user message.
    set((s) => {
      const conv = findConversation(s.conversations, conversationId);
      const isFirst = !!conv && conv.messages.length === 0;
      let conversations = updateMessages(s.conversations, conversationId!, (m) => [
        ...m,
        userMsg,
        assistantMsg,
      ]);
      if (isFirst) {
        const title = deriveTitle(content);
        conversations = conversations.map((c) => (c.id === conversationId ? { ...c, title } : c));
        void window.qwen.renameConversation(conversationId!, title);
      }
      return { conversations };
    });
    persist(conversationId, get().conversations);

    const requestId = genId('req');
    routing.set(requestId, { conversationId, messageId: assistantMsg.id });
    set({ streamingRequestId: requestId });

    const conv = findConversation(get().conversations, conversationId);
    const history = (conv?.messages ?? [])
      .filter((m) => m.id !== assistantMsg.id && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role as ChatRole, content: m.content }));

    const messages = [
      ...(settings.systemPrompt
        ? [{ role: 'system' as ChatRole, content: settings.systemPrompt }]
        : []),
      ...history,
    ];

    await window.qwen.chatStream({
      requestId,
      conversationId,
      model: settings.model,
      temperature: settings.temperature,
      messages,
    });
  },

  abort: async () => {
    const requestId = get().streamingRequestId;
    if (requestId) await window.qwen.abortChat(requestId);
  },

  regenerate: async (messageId) => {
    const conversationId = get().activeId;
    if (!conversationId) return;
    const conv = findConversation(get().conversations, conversationId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    // Find the user message preceding this assistant message.
    let userIdx = idx;
    while (userIdx >= 0 && conv.messages[userIdx].role !== 'user') userIdx -= 1;
    if (userIdx < 0) return;
    const userText = conv.messages[userIdx].content;
    // Drop everything from the user message onward, then re-send it.
    const trimmed = conv.messages.slice(0, userIdx);
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, () => trimmed),
    }));
    persist(conversationId, get().conversations);
    await get().sendMessage(userText);
  },

  deleteMessage: async (messageId) => {
    const conversationId = get().activeId;
    if (!conversationId) return;
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.filter((x) => x.id !== messageId),
      ),
    }));
    persist(conversationId, get().conversations);
  },

  appendDelta: (conversationId, messageId, text) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) => (x.id === messageId ? { ...x, content: x.content + text } : x)),
      ),
    }));
  },

  setUsage: (conversationId, messageId, usage) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) => (x.id === messageId ? { ...x, usage } : x)),
      ),
    }));
  },

  finishMessage: (conversationId, messageId, aborted) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) =>
          x.id === messageId ? { ...x, status: 'done', aborted: aborted ?? false } : x,
        ),
      ),
      streamingRequestId: null,
    }));
    persist(conversationId, get().conversations);
  },

  failMessage: (conversationId, messageId, message) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) =>
          x.id === messageId
            ? { ...x, status: 'error', error: message, content: x.content || '' }
            : x,
        ),
      ),
      streamingRequestId: null,
    }));
    persist(conversationId, get().conversations);
  },
}));

/** Wire IPC stream events to the store. Call once at app startup. */
export function initChatBridge(): void {
  window.qwen.onChatDelta((e) => {
    const r = routing.get(e.requestId);
    if (r) useChatStore.getState().appendDelta(r.conversationId, r.messageId, e.text);
  });
  window.qwen.onChatUsage((e) => {
    const r = routing.get(e.requestId);
    if (r) useChatStore.getState().setUsage(r.conversationId, r.messageId, e.usage);
  });
  window.qwen.onChatDone((e) => {
    const r = routing.get(e.requestId);
    if (r) {
      useChatStore.getState().finishMessage(r.conversationId, r.messageId, e.aborted);
      routing.delete(e.requestId);
    }
  });
  window.qwen.onChatError((e) => {
    const r = routing.get(e.requestId);
    if (r) {
      useChatStore.getState().failMessage(r.conversationId, r.messageId, e.message);
      routing.delete(e.requestId);
    }
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0. (If `create` import errors, confirm `zustand@^4` is installed — v4 exports `create` from the package root.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add renderer settings and chat zustand stores"
```

---

### Task 12: Renderer UI components

**Files:**
- Create: `src/renderer/components/MarkdownMessage.tsx`, `ModelSelect.tsx`, `ChatInput.tsx`, `MessageBubble.tsx`, `Sidebar.tsx`, `SettingsDialog.tsx`, `WelcomeState.tsx`
- Create: `src/renderer/pages/ChatPage.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create `src/renderer/components/MarkdownMessage.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const code = extractText(children);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative group my-2">
      <button
        onClick={copy}
        className="absolute right-2 top-2 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 opacity-0 group-hover:opacity-100 transition"
      >
        {copied ? '已复制' : '复制'}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-[#0b0d12] p-3 text-sm">{children}</pre>
    </div>
  );
}

export default function MarkdownMessage({ content }: { content: string }): JSX.Element {
  return (
    <div className="prose-invert max-w-none leading-relaxed [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:border-white/15 [&_th]:border-white/15 [&_td]:px-2 [&_th]:px-2 [&_a]:text-sky-400 [&_code]:rounded [&_:not(pre)>code]:bg-white/10 [&_:not(pre)>code]:px-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/renderer/components/ModelSelect.tsx`**

```tsx
import { useState } from 'react';
import { MODEL_PRESETS } from '../../shared/types';
import { useSettingsStore } from '../store/settingsStore';

export default function ModelSelect(): JSX.Element {
  const { settings, save } = useSettingsStore();
  const [custom, setCustom] = useState(false);
  const isPreset = (MODEL_PRESETS as readonly string[]).includes(settings.model);

  if (custom || !isPreset) {
    return (
      <input
        value={settings.model}
        onChange={(e) => save({ model: e.target.value })}
        onBlur={() => setCustom(false)}
        placeholder="自定义模型名"
        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm w-40"
      />
    );
  }

  return (
    <select
      value={settings.model}
      onChange={(e) => {
        if (e.target.value === '__custom__') setCustom(true);
        else save({ model: e.target.value });
      }}
      className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm"
    >
      {MODEL_PRESETS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value="__custom__">自定义…</option>
    </select>
  );
}
```

- [ ] **Step 3: Create `src/renderer/components/ChatInput.tsx`**

```tsx
import { useRef, useState, type KeyboardEvent } from 'react';
import { useChatStore } from '../store/chatStore';

export default function ChatInput(): JSX.Element {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abort = useChatStore((s) => s.abort);
  const streaming = useChatStore((s) => s.streamingRequestId !== null);

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const submit = async () => {
    const value = text;
    if (!value.trim() || streaming) return;
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
    await sendMessage(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && streaming) {
      e.preventDefault();
      void abort();
    }
  };

  return (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-end gap-2 bg-white/5 rounded-xl border border-white/10 p-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autosize();
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="给 Qwen 发消息…（Cmd/Ctrl + Enter 发送，Esc 停止）"
          className="flex-1 resize-none bg-transparent outline-none px-2 py-1 text-sm max-h-[200px]"
        />
        {text && (
          <button
            onClick={() => setText('')}
            className="text-xs text-white/50 hover:text-white/80 px-2"
            title="清空"
          >
            清空
          </button>
        )}
        {streaming ? (
          <button
            onClick={() => void abort()}
            className="px-3 py-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-sm"
          >
            停止
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={!text.trim()}
            className="px-3 py-1.5 rounded-lg bg-sky-500/90 hover:bg-sky-500 disabled:opacity-40 text-sm"
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/renderer/components/MessageBubble.tsx`**

```tsx
import { useState } from 'react';
import { type ChatMessage } from '../../shared/types';
import { useChatStore } from '../store/chatStore';
import MarkdownMessage from './MarkdownMessage';

export default function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const regenerate = useChatStore((s) => s.regenerate);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const streaming = useChatStore((s) => s.streamingRequestId !== null);
  const isUser = message.role === 'user';

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${isUser ? 'bg-sky-600/30' : 'bg-white/5'}`}>
        <div className="text-xs text-white/40 mb-1">{isUser ? '你' : 'Qwen'}</div>

        {message.status === 'error' ? (
          <div className="text-red-300 text-sm whitespace-pre-wrap">⚠️ {message.error}</div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
        ) : (
          <MarkdownMessage content={message.content || (message.status === 'streaming' ? '▍' : '')} />
        )}

        {message.aborted && <div className="text-xs text-white/40 mt-1">（已停止）</div>}
        {message.usage && (
          <div className="text-xs text-white/30 mt-1">
            tokens：{message.usage.promptTokens} + {message.usage.completionTokens} ={' '}
            {message.usage.totalTokens}
          </div>
        )}

        <div className="flex gap-3 mt-2 opacity-0 group-hover:opacity-100 transition text-xs text-white/50">
          <button onClick={copy} className="hover:text-white/90">
            {copied ? '已复制' : '复制'}
          </button>
          {!isUser && !streaming && (
            <button onClick={() => void regenerate(message.id)} className="hover:text-white/90">
              重新生成
            </button>
          )}
          {!streaming && (
            <button onClick={() => void deleteMessage(message.id)} className="hover:text-red-300">
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/renderer/components/Sidebar.tsx`**

```tsx
import { useChatStore } from '../store/chatStore';

export default function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const { conversations, activeId, newConversation, selectConversation, deleteConversation, renameConversation } =
    useChatStore();

  return (
    <aside className="w-64 shrink-0 border-r border-white/10 flex flex-col bg-black/20">
      <div className="p-3">
        <button
          onClick={() => void newConversation()}
          className="w-full rounded-lg bg-white/10 hover:bg-white/15 py-2 text-sm"
        >
          ＋ 新建聊天
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => selectConversation(c.id)}
            className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer ${
              c.id === activeId ? 'bg-white/15' : 'hover:bg-white/5'
            }`}
          >
            <span className="truncate flex-1">{c.title}</span>
            <span className="hidden group-hover:flex gap-2 ml-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const title = window.prompt('重命名会话', c.title);
                  if (title) void renameConversation(c.id, title);
                }}
                className="text-white/40 hover:text-white/80"
                title="重命名"
              >
                ✎
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('删除该会话？')) void deleteConversation(c.id);
                }}
                className="text-white/40 hover:text-red-300"
                title="删除"
              >
                🗑
              </button>
            </span>
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="text-xs text-white/30 px-3 py-4">还没有会话，点上面新建一个。</div>
        )}
      </div>

      <div className="p-3 border-t border-white/10">
        <button onClick={onOpenSettings} className="w-full text-left text-sm text-white/60 hover:text-white/90">
          ⚙ 设置
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Create `src/renderer/components/WelcomeState.tsx`**

```tsx
import { useChatStore } from '../store/chatStore';

const PROMPTS = [
  '你好，请用一句话介绍你自己',
  '用 Python 写一个快速排序，并解释思路',
  '把下面这段话翻译成英文：今天天气很好',
  '给我三个周末适合做的小项目点子',
];

export default function WelcomeState(): JSX.Element {
  const sendMessage = useChatStore((s) => s.sendMessage);
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-2xl font-semibold mb-2">欢迎使用 Qwen Studio Desktop</div>
      <div className="text-white/50 mb-8">挑一个开始，或直接在下面输入框提问。</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => void sendMessage(p)}
            className="text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-4 text-sm"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/renderer/components/SettingsDialog.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';

export default function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, hasKey, save } = useSettingsStore();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setTemperature(settings.temperature);
    setSystemPrompt(settings.systemPrompt);
  }, [settings]);

  const onSave = async () => {
    await save({
      baseUrl,
      model,
      temperature,
      systemPrompt,
      ...(apiKey ? { apiKey } : {}),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="w-[560px] max-w-[92vw] rounded-2xl bg-[#161a23] border border-white/10 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-semibold mb-4">设置</div>

        <label className="block text-sm mb-1 text-white/70">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? '已保存（留空则不修改）' : '填写你的 DashScope API Key'}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4"
        />

        <label className="block text-sm mb-1 text-white/70">Base URL</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4"
        />

        <label className="block text-sm mb-1 text-white/70">默认模型</label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4"
        />

        <label className="block text-sm mb-1 text-white/70">Temperature：{temperature.toFixed(1)}</label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
          className="w-full mb-4"
        />

        <label className="block text-sm mb-1 text-white/70">System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm mb-4 resize-none"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm">
            取消
          </button>
          <button onClick={() => void onSave()} className="px-4 py-2 rounded-lg bg-sky-500/90 hover:bg-sky-500 text-sm">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create `src/renderer/pages/ChatPage.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../store/settingsStore';
import MessageBubble from '../components/MessageBubble';
import ChatInput from '../components/ChatInput';
import ModelSelect from '../components/ModelSelect';
import WelcomeState from '../components/WelcomeState';

export default function ChatPage({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const hasKey = useSettingsStore((s) => s.hasKey);
  const active = conversations.find((c) => c.id === activeId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages]);

  const isEmpty = !active || active.messages.length === 0;

  return (
    <main className="flex-1 flex flex-col min-w-0">
      <header className="h-12 shrink-0 border-b border-white/10 flex items-center justify-between px-4">
        <div className="text-sm text-white/60 truncate">{active?.title ?? 'Qwen Studio'}</div>
        <div className="flex items-center gap-3">
          <ModelSelect />
          <button onClick={onOpenSettings} className="text-sm text-white/60 hover:text-white/90">
            ⚙
          </button>
        </div>
      </header>

      {!hasKey && (
        <div className="bg-amber-500/15 text-amber-200 text-sm px-4 py-2 flex items-center justify-between">
          <span>还没配置 API Key，无法发送消息。</span>
          <button onClick={onOpenSettings} className="underline">
            去设置
          </button>
        </div>
      )}

      {isEmpty ? (
        <WelcomeState />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {active!.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <ChatInput />
    </main>
  );
}
```

- [ ] **Step 9: Replace `src/renderer/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useChatStore, initChatBridge } from './store/chatStore';
import { useSettingsStore } from './store/settingsStore';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';
import SettingsDialog from './components/SettingsDialog';

export default function App(): JSX.Element {
  const [showSettings, setShowSettings] = useState(false);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadSettings = useSettingsStore((s) => s.load);
  const hasKey = useSettingsStore((s) => s.hasKey);
  const loaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    initChatBridge();
    void loadSettings();
    void loadConversations();
  }, [loadConversations, loadSettings]);

  // First run with no key: open settings automatically.
  useEffect(() => {
    if (loaded && !hasKey) setShowSettings(true);
  }, [loaded, hasKey]);

  return (
    <div className="h-full flex">
      <Sidebar onOpenSettings={() => setShowSettings(true)} />
      <ChatPage onOpenSettings={() => setShowSettings(true)} />
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  );
}
```

- [ ] **Step 10: Verify typecheck and build**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm run build`
Expected: builds main + preload + renderer with no errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: build chat UI (sidebar, chat page, input, settings, markdown)"
```

---

### Task 13: Full verification — tests, build, and live end-to-end

**Files:** none (verification + packaging smoke)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass (sse, qwenService, id, title).

- [ ] **Step 2: Typecheck and production build**

Run: `npm run typecheck && npm run build`
Expected: exit 0, `out/` populated.

- [ ] **Step 3: Live end-to-end with the user's API key**

This step needs a display. On WSL2 use WSLg (a display is usually present); otherwise run under `xvfb-run`. Ask the user for the DashScope API key when prompted by the app's Settings dialog (do not hardcode it).

Run: `npm run dev`
Then in the app:
1. Settings dialog opens on first run (no key) → paste the API key, confirm Base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`, model `qwen-plus`, Save.
2. Send "你好，请用一句话介绍你自己" → expect streaming, character-by-character output.
3. Send a coding prompt → expect a Markdown code block with a working 复制 button.
4. While a long answer streams, click 停止 → output stops immediately, "（已停止）" shows.
5. Open Settings, change the key to an invalid value, send a message → expect a clear red error, no blank screen. Restore the valid key after.
6. Close and reopen the app (`Ctrl+C`, then `npm run dev` again) → conversations are still present.
7. Create a second conversation and switch between them → messages don't leak across conversations.

Expected: every check passes. If any fails, use superpowers:systematic-debugging before patching.

- [ ] **Step 4: Packaging smoke test (Linux AppImage in this environment)**

Run: `npm run dist`
Expected: `electron-builder` produces an installer in `release/` (AppImage on Linux). macOS dmg / Windows nsis targets are configured for those platforms; building them requires running on/again those OSes and is acceptable to defer.

- [ ] **Step 5: Final commit (lockfile / any fixes)**

```bash
git add -A
git commit -m "chore: verify build, tests, and live streaming end-to-end"
```

---

## Self-Review

**Spec coverage (design doc §7 functionality):**
- API Key 设置 (safeStorage) → Tasks 7, 10, 12(SettingsDialog)
- Chat Completions 调用 → Task 5
- 流式渲染 → Tasks 4, 5, 9, 11 (appendDelta)
- 会话历史本地持久化 → Task 8 + persist() in Task 11
- 停止生成 → Task 9 (abort registry) + Task 11 (abort) + ChatInput/MessageBubble
- 错误提示 (无 Key/Key 错/模型错/网络断/超时) → Task 5 (friendlyMessage), Task 9 (no-key guard), Task 12 (error bubble + banner)
- Markdown + 代码复制 → Task 12 (MarkdownMessage)
- 模型下拉 (presets + 自定义) → Task 12 (ModelSelect)
- 首页欢迎态 + 推荐 prompt → Task 12 (WelcomeState)
- 单条消息操作 (复制/重答/删除) → Task 12 (MessageBubble) + Task 11 (regenerate/deleteMessage)
- 会话标题自动取首条用户消息 → Task 11 (deriveTitle in sendMessage)
- usage 展示 → Task 11 (setUsage) + Task 12 (MessageBubble)
- 快捷键 (Cmd/Ctrl+Enter / Esc) → Task 12 (ChatInput)
- 输入框自动增高 → Task 12 (ChatInput autosize)
- electron-builder 打包配置 → Task 1 (package.json build) + Task 13
- 会话隔离 (requestId 路由) → Task 9 + Task 11 (routing map)

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✔

**Type consistency:** `QwenApi` method names match between `src/shared/api.ts` (Task 2), preload (Task 10), and store call sites (Tasks 11–12). Store mutation names (`appendDelta`, `setUsage`, `finishMessage`, `failMessage`) match between `initChatBridge` and the store definition (Task 11). `Usage` shape (`promptTokens/completionTokens/totalTokens`) is consistent across `sse.ts`, `types.ts`, and `MessageBubble`. ✔

No gaps found.
