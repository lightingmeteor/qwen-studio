# Qwen Studio 工程性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动聊天业务语义的前提下，缩小渲染 bundle 与安装包、消除数据层每次操作的全量重复校验、并收紧 CSP。

**Architecture:** 四条独立工作流（WS1 渲染 bundle / WS4 CSP / WS2 打包配置 / WS3 数据层）。WS1/WS2/WS4 由 `npm run build` + 体积量化 / 配置正确性验证；WS3 由扩充的 vitest 单测验证。每条完成后跑 `npm test && npm run typecheck && npm run build`。

**Tech Stack:** Electron 42 + electron-vite + electron-builder；React 18 + react-markdown 9 + rehype-highlight 7（highlight.js 11）；zustand；electron-store 8；vitest。

**Baseline（改前实测）：** `out/renderer/assets/index-*.js` 单块 = **1,021,478 字节（≈998 KB）**。

---

## Task 1: WS1 — highlight.js 精选语言子集

**Files:**
- Create: `src/renderer/highlightLanguages.ts`
- Create: `src/renderer/__tests__/highlightLanguages.test.ts`
- Modify: `src/renderer/components/MarkdownMessage.tsx`

- [ ] **Step 1: 写失败测试**（守护语言子集存在且为函数，防止 import 路径写错）

`src/renderer/__tests__/highlightLanguages.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { highlightLanguages } from '../highlightLanguages';

describe('highlightLanguages', () => {
  it('exposes the curated subset as language functions', () => {
    const expected = [
      'javascript', 'typescript', 'python', 'json', 'bash', 'shell',
      'xml', 'css', 'sql', 'go', 'rust', 'java', 'c', 'cpp',
      'markdown', 'yaml', 'diff',
    ];
    expect(Object.keys(highlightLanguages).sort()).toEqual([...expected].sort());
    for (const fn of Object.values(highlightLanguages)) {
      expect(typeof fn).toBe('function');
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/__tests__/highlightLanguages.test.ts`
Expected: FAIL（`Cannot find module '../highlightLanguages'`）

- [ ] **Step 3: 实现 `highlightLanguages.ts`**

`src/renderer/highlightLanguages.ts`:
```ts
import type { LanguageFn } from 'highlight.js';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import diff from 'highlight.js/lib/languages/diff';

// Curated subset: chat clients rarely need all 37 common grammars.
// Restricting to this set drops the unused grammars from the renderer bundle.
// `xml` covers HTML; `bash`/`shell` cover terminal snippets.
export const highlightLanguages: Record<string, LanguageFn> = {
  javascript,
  typescript,
  python,
  json,
  bash,
  shell,
  xml,
  css,
  sql,
  go,
  rust,
  java,
  c,
  cpp,
  markdown,
  yaml,
  diff,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/renderer/__tests__/highlightLanguages.test.ts`
Expected: PASS

- [ ] **Step 5: 在 MarkdownMessage 里启用子集**

`src/renderer/components/MarkdownMessage.tsx`，新增 import：
```tsx
import { highlightLanguages } from '../highlightLanguages';
```
把 `rehypePlugins={[rehypeHighlight]}` 改为带选项的数组形式：
```tsx
        rehypePlugins={[[rehypeHighlight, { languages: highlightLanguages }]]}
```

- [ ] **Step 6: typecheck + 构建并记录体积**

Run: `npm run typecheck && npm run build`
Expected: 通过。记录 `out/renderer/assets/index-*.js`（及任何新 chunk）体积，对比 998 KB 基线（语言子集后应下降）。
Run: `ls -la out/renderer/assets/`

- [ ] **Step 7: 提交**

```bash
git add src/renderer/highlightLanguages.ts src/renderer/__tests__/highlightLanguages.test.ts src/renderer/components/MarkdownMessage.tsx
git commit -m "perf(renderer): restrict highlight.js to a curated language subset"
```

---

## Task 2: WS1 — vendor 代码分割 + SettingsDialog 懒加载

**Files:**
- Modify: `electron.vite.config.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: 在 vite renderer 配置加 manualChunks**

`electron.vite.config.ts`，把 `renderer` 段替换为：
```ts
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            markdown: ['react-markdown', 'remark-gfm', 'rehype-highlight'],
          },
        },
      },
    },
    plugins: [react()],
  },
```

- [ ] **Step 2: 把 SettingsDialog 改成懒加载**

`src/renderer/App.tsx`：
1. 第 1 行 import 改为：
```tsx
import { lazy, Suspense, useEffect, useState } from 'react';
```
2. 删除第 6 行静态 import `import SettingsDialog from './components/SettingsDialog';`，改为在 import 区块下方新增：
```tsx
const SettingsDialog = lazy(() => import('./components/SettingsDialog'));
```
3. 把渲染处：
```tsx
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
```
改为：
```tsx
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
```

- [ ] **Step 3: typecheck + 构建并记录 chunk 拆分**

Run: `npm run typecheck && npm run build`
Expected: 通过；`out/renderer/assets/` 出现多个 chunk（入口 index、react、markdown、以及 SettingsDialog 懒加载块）。入口 chunk 应小于改前 998 KB。
Run: `ls -la out/renderer/assets/`

- [ ] **Step 4: 跑全量测试确保未回归**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add electron.vite.config.ts src/renderer/App.tsx
git commit -m "perf(renderer): split vendor chunks and lazy-load settings dialog"
```

---

## Task 3: WS4 — 收紧 CSP

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 替换 CSP meta**

`index.html` 第 6 行替换为（保持单行，避免 meta content 多行问题）：
```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none';" />
```

- [ ] **Step 2: 构建确认无破坏**

Run: `npm run build`
Expected: 通过。CSP 仅收紧、不放开；外部 API 调用都在主进程，渲染层 `connect-src 'self'` 安全；`'unsafe-inline'` 仅保留给 style。

- [ ] **Step 3: 提交**

```bash
git add index.html
git commit -m "security(renderer): tighten CSP to a minimal directive set"
```

---

## Task 4: WS2 — 打包工程瘦身

**Files:**
- Modify: `package.json`（`build` 段）

- [ ] **Step 1: 扩充 electron-builder build 配置**

`package.json` 的 `build` 对象，在 `appId`/`productName`/`directories` 同级新增/修改以下键：
```json
    "asar": true,
    "compression": "maximum",
    "npmRebuild": false,
    "electronLanguages": [
      "en-US",
      "zh-CN"
    ],
    "files": [
      "out/**",
      "!out/**/*.map"
    ],
```
（保留原有 `mac` / `win` / `linux` target 配置不变。）

- [ ] **Step 2: 校验 JSON 合法 + 构建未受影响**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json valid')"`
Expected: 打印 `package.json valid`
Run: `npm run build`
Expected: electron-vite 构建通过（electron-builder 全量打包需下载 Chromium，不在本步必跑；如环境允许可 `npx electron-builder --linux dir` 实测解包体积）。

- [ ] **Step 3: 提交**

```bash
git add package.json
git commit -m "build: shrink installer via locale pruning, max compression, file excludes"
```

---

## Task 5: WS3 — 数据层内存缓存（写穿透）

**Files:**
- Modify: `src/main/conversationStore.ts`
- Modify: `src/main/__tests__/conversationStore.test.ts`

**说明：** 现有测试用 `MockStore`（只有 `get`/`set`）且断言写入同步生效。本任务保持同步写穿透，仅把"每次操作重跑全量校验"改为"首次校验一次后缓存于内存"。

- [ ] **Step 1: 写失败测试 —— 校验只跑一次**

在 `src/main/__tests__/conversationStore.test.ts` 的 `importConversationStore` 里，给 MockStore 增加 `set` 调用计数，便于断言回写次数。把 mock 的 store class 改为记录 `setCount`：
```ts
  const calls = { set: 0 };
  vi.doMock('electron-store', () => ({
    default: class MockStore {
      constructor(config: { defaults?: StoreData }) {
        Object.assign(data, config.defaults, { ...data });
      }
      get(key: string) {
        return data[key];
      }
      set(key: string, value: unknown) {
        calls.set += 1;
        data[key] = value;
      }
    },
  }));

  const mod = await import('../conversationStore');
  return { mod, data, calls };
```
新增用例（放在 `conversationStore metadata repair` describe 内）：
```ts
  it('validates persisted conversations once and caches them in memory', async () => {
    const repairable = {
      ...conversation({ id: 'r', updatedAt: 10 }),
      pinned: 'nope', // malformed -> triggers one repair write on first read
    };
    const { mod, calls } = await importConversationStore({ conversations: [repairable] });

    mod.listConversations(); // first read: repairs + writes back once
    const afterFirst = calls.set;
    mod.listConversations();
    mod.getConversation('r');
    mod.listConversations();

    expect(afterFirst).toBe(1);
    expect(calls.set).toBe(afterFirst); // subsequent reads do not re-write
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/conversationStore.test.ts -t "caches them in memory"`
Expected: FAIL（当前 `getConversations` 每次读都可能回写 / 重复校验，`calls.set` 不止 1）

- [ ] **Step 3: 在 conversationStore.ts 引入内存缓存**

`src/main/conversationStore.ts`：在 `store` 定义之后、`getConversations` 之前新增缓存层；改写读取路径。

新增模块级缓存与加载函数（放在第 19 行 `});` 之后）：
```ts
let cache: Conversation[] | null = null;

function backupCorruptConversations(raw: unknown): void {
  const key = `conversations_corrupt_${Date.now()}`;
  store.set(key, raw as never);
}

function loadConversations(): Conversation[] {
  const persisted = store.get('conversations') as unknown;

  if (!Array.isArray(persisted)) {
    if (persisted !== undefined) {
      backupCorruptConversations(persisted); // non-destructive: keep the bad value
    }
    store.set('conversations', []);
    return [];
  }

  let repaired = false;
  const conversations = persisted.reduce<Conversation[]>((acc, item) => {
    const result = repairConversation(item);
    if (!result.conversation) {
      repaired = true;
      return acc;
    }
    if (result.repaired) repaired = true;
    acc.push(result.conversation);
    return acc;
  }, []);

  if (repaired) {
    store.set('conversations', conversations);
  }

  return conversations;
}
```

把原有 `getConversations()` 改为读缓存：
```ts
function getConversations(): Conversation[] {
  if (cache === null) {
    cache = loadConversations();
  }
  return cache;
}
```

新增一个写辅助，更新缓存并同步落盘（写穿透）。在 `getConversations` 之后新增：
```ts
function setConversations(next: Conversation[]): void {
  cache = next;
  store.set('conversations', next);
}
```

把所有原先 `store.set('conversations', X)` 的调用点（`createConversation` / `renameConversation` / `deleteConversation` / `saveMessages` / `updateConversationMetadata`）改为调用 `setConversations(X)`。注意：`getConversations()` 内部原本在 `!Array.isArray` 和 `repaired` 分支里直接 `store.set`，这部分逻辑已移入 `loadConversations`，`getConversations` 不再直接写。

- [ ] **Step 4: 跑新用例与既有用例**

Run: `npx vitest run src/main/__tests__/conversationStore.test.ts`
Expected: 新用例 PASS；既有 7 个用例仍 PASS（同步写穿透不破坏既有断言）。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/main/conversationStore.ts src/main/__tests__/conversationStore.test.ts
git commit -m "perf(main): cache validated conversations in memory (validate once)"
```

---

## Task 6: WS3 — 损坏数据先备份

**Files:**
- Modify: `src/main/__tests__/conversationStore.test.ts`

（备份实现已在 Task 5 的 `loadConversations` 中通过 `backupCorruptConversations` 完成；本任务补测试锁住行为。）

- [ ] **Step 1: 写失败测试 —— 非数组损坏会备份**

新增用例（`conversationStore metadata repair` describe 内）：
```ts
  it('backs up corrupt non-array conversations before resetting', async () => {
    const { mod, data } = await importConversationStore({
      conversations: { not: 'an array' } as unknown as Conversation[],
    });

    expect(mod.listConversations()).toEqual([]);
    expect(data.conversations).toEqual([]);
    const backupKey = Object.keys(data).find((k) => k.startsWith('conversations_corrupt_'));
    expect(backupKey).toBeDefined();
    expect(data[backupKey as string]).toEqual({ not: 'an array' });
  });
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run src/main/__tests__/conversationStore.test.ts -t "backs up corrupt"`
Expected: PASS（Task 5 已实现备份；若 FAIL 则回到 Task 5 修实现）

- [ ] **Step 3: 全量测试 + typecheck + 构建**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add src/main/__tests__/conversationStore.test.ts
git commit -m "test(main): cover corrupt-conversations backup-before-reset"
```

---

## Task 7: 收尾汇总

- [ ] **Step 1: 整体验证**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全绿。

- [ ] **Step 2: 记录改前/改后体积对比**

Run: `ls -la out/renderer/assets/`
把入口 chunk 与各 vendor chunk 体积对比 998 KB 基线，写入 PR 描述 / 总结。

- [ ] **Step 3: 更新 `docs/next-improvement-directions.md`（追加一节"工程性优化"小结，含实测数字与故意推迟项）**，然后提交：

```bash
git add docs/next-improvement-directions.md
git commit -m "docs: record engineering optimization results"
```

---

## Self-Review 结果

- **Spec coverage：** WS1→Task1/2，WS2→Task4，WS3→Task5/6，WS4→Task3，整体验收→Task7。spec 中"故意推迟去抖"已在 Task5 说明里体现（保持同步写穿透）。
- **Placeholder：** 无 TODO/TBD；每个代码步骤都给了完整代码。
- **类型/命名一致：** `highlightLanguages`、`getConversations`、`loadConversations`、`setConversations`、`backupCorruptConversations`、`cache` 跨任务一致；mock 返回值新增 `calls` 字段在 Task5 引入、Task6 复用 `data`。
- **已知限制：** 安装包最终体积、渲染运行时高亮表现需 Chromium / 打包环境才能完整实测；计划用单测 + 构建产物体积 + 配置正确性作为可在本环境验证的替代证据，并在总结中标注限制。
