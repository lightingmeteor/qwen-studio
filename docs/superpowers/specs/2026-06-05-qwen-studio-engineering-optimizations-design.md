# Qwen Studio 工程性优化设计

日期：2026-06-05

## 背景与动机

Qwen Studio 0.4 已完成功能主线（聊天、流式、多会话、Responses、web_search）。本次不新增产品功能，而是处理一批**工程性问题**：让安装包更小、首屏更快、数据层在历史变大后更可靠、安全基线再收紧。

设计前已对代码做过核实，结论如下（区分"真问题"与"其实已做好"，避免无用功）：

| 项 | 现状 | 性质 |
| --- | --- | --- |
| 渲染 bundle | `out/renderer/assets/index-*.js` ≈ **998 KB 单一巨块** | 真问题，本地可量化 |
| highlight.js | `rehypeHighlight` 用默认 common 集（~37 种语法）全打进首屏 | bundle 主要肥肉 |
| electron locale | electron-builder 未配 `electronLanguages`，打包 ~50 个 `.pak` | 真问题（安装包实测需下载 Chromium） |
| 数据层写入 | 流式 `appendDelta` 不存盘（好）；但每次 `persist` 对**全部会话**重跑校验 + 全量重写 JSON | O(全历史)/次，重度用户卡 |
| 损坏处理 | electron-store 默认直接重置为空，不备份 | 破坏性，可改 |
| IPC 入参校验 | `validateChatStreamRequest` 等已完整 | 已做好，不重复 |
| Markdown XSS | 未启用 `rehype-raw`，原始 HTML 不渲染；URL 经 `normalizeExternalUrl` | 已安全 |
| CSP | 只设 default/style/img-src | 可低成本收紧 |

**诚实的边界**：Electron 安装包的大头是 Chromium 本身（解压后约 150 MB），由框架决定。不更换框架（如 Tauri，等同整体重写，超出本次范围）无法根除。本设计能动且能验证的是：裁语言包、最大压缩、渲染 bundle 瘦身、数据层与安全。

关于用户最初提到的 "CDP 易被识别为 AI，用 GLIC 优化"：当前仓库**没有任何浏览器自动化 / CDP 代码**，该问题在本项目无落点，本设计不涉及；它被理解为"希望有工程视角"的示例。

## 目标

1. 渲染 bundle 体积下降、首屏 JS 下降（可量化对比）。
2. 安装包打包配置裁剪语言包、开启最大压缩、收紧打包文件。
3. 数据层消除每次操作 O(全历史) 的重复校验，合并落盘，损坏先备份。
4. CSP 收紧到合理的最小权限集。

## 非目标

- 不更换桌面框架（不引入 Tauri / 不脱离 Electron）。
- 不引入 SQLite / 不改数据持久化为数据库（仍用 electron-store 的 JSON）。
- 不新增浏览器自动化 / CDP / GLIC 能力。
- 不做自动更新 / 签名 / 公证（属另一条发布工程线）。
- 不改任何聊天 / Responses 业务语义。

## 工作流设计

### WS1 · 渲染 bundle 瘦身与首屏性能

**问题**：renderer 产物是单个 ≈998 KB 的 JS。主要来自 react + react-dom、react-markdown 全家桶、highlight.js 的 ~37 种语法、zustand 等，全部塞进一个首屏 chunk。

**改动**：

1. `src/renderer/components/MarkdownMessage.tsx`：把 `rehypeHighlight` 从默认 common 集改为**精选语言子集**。子集取一个聊天客户端实际常见的范围，初定：`javascript, typescript, python, json, bash/shell, html(xml), css, sql, go, rust, java, c, cpp, markdown, yaml, diff`。通过 `rehype-highlight` 的 `languages` 选项显式注入 grammar，未命中语言降级为纯文本（不报错）。
2. `electron.vite.config.ts`：renderer `build.rollupOptions.output.manualChunks` 把第三方依赖拆成稳定的 vendor chunk（至少：`react` 组、`markdown`(react-markdown/remark/rehype/highlight) 组）。目的：首屏与重渲染分层、利于缓存。
3. `src/renderer/App.tsx`（或 SettingsDialog 的引入处）：`SettingsDialog` 改 `React.lazy` + `Suspense` 懒加载，首屏不加载设置面板代码。

**验证**：`npm run build` 后比较 `out/renderer/assets/*.js`：
- 记录改前基线：单块 998 KB。
- 改后：首屏入口 chunk 体积、各 vendor chunk 体积、总 JS 体积。
- `npm test` + `npm run typecheck` 通过。
- 手动确认代码块高亮（常见语言）仍正常、设置面板仍能打开。

**接受标准**：首屏入口 JS 明显下降（highlight 语法子集 + 懒加载设置）；构建、类型、测试通过；高亮与设置功能不退化。

### WS2 · 打包工程瘦身

**问题**：`package.json` 的 electron-builder 配置只排除到 `out/**`，无语言裁剪、无压缩级别、无对 source map / 多余文件的排除。

**改动**（均在 `package.json` 的 `build` 段）：

1. `electronLanguages: ["en-US", "zh-CN"]`：仅保留这两套 locale `.pak`（mac 为 lproj），裁掉其余 ~48 个。
2. `compression: "maximum"`：NSIS / dmg / AppImage 走最大压缩。
3. `asar: true`（显式声明，默认即开）。
4. 收紧 `files`：在保留 `out/**` 的前提下排除 source map 等（`"!out/**/*.map"`），并确认不打包 `node_modules` 中无关内容（externalize 的运行时依赖仅 `electron-store`）。
5. `npmRebuild: false`：本项目无原生模块编译需求，关闭可加快打包、避免误编译。

**验证**：
- 配置 schema 正确（electron-builder 能解析）。
- `electronLanguages` 语义：量化"未裁剪 = ~50 个 .pak / 裁剪后 = 2 个"。
- 安装包最终体积需下载 Chromium 才能实测；优先尝试 `electron-builder --linux dir`（仅解包、不压缩）测 app 目录体积，跑不动则记录预期量级并在 spec/PR 中说明限制。

**接受标准**：build 段配置合法、语义正确、不破坏现有 `dist:*` 脚本；语言裁剪与压缩生效（实测或有据说明）。

### WS3 · 数据层可靠性与性能

**问题**：`src/main/conversationStore.ts` 每次读写都 `getConversations()` → 对**所有**会话重跑校验/修复 → 全量 `store.set`。成本随总历史增长，不随单次改动量。且 electron-store 损坏时默认静默重置为空。

**改动**（集中在 `conversationStore.ts`）：

1. **内存缓存（写穿透）**：模块加载首次访问时从 store 读取并校验一次，得到 `Conversation[]` 缓存于内存；后续 `list/get/create/rename/delete/saveMessages/setPinned/setArchived` 都基于内存缓存读，写时更新缓存并**同步**写盘（write-through）。消除每次操作对全部会话的重复校验——校验只在首次发生一次。
2. **损坏先备份（不依赖文件路径）**：读取时若 `conversations` 不是数组（合法 JSON 但结构损坏 / 版本不符），先把原始坏值写入同一 store 的备份键 `conversations_corrupt_<timestamp>`，再把 `conversations` 回退为 `[]`。避免静默清空、且坏数据仍可从配置文件恢复。该方案不依赖 `store.path` / fs，既能用真实 electron-store，也能用现有测试 mock 验证。
3. 保持对外导出的函数签名不变（`listConversations` / `getConversation` / `saveMessages` 等），仅改内部实现，IPC 层与渲染层无需改动。

**故意推迟（不做）**：spec 初稿提到的"去抖合并落盘 + 退出前 flush"被**刻意砍掉**。原因：现有测试契约假定写入**同步生效**（`setConversationPinned` 后立即断言 `data.conversations`），去抖会把同步写改成异步、破坏该契约并引入退出 flush 复杂度；而 electron-store 写入本就是原子的、一次突发只有少量写，去抖的边际收益不抵复杂度与测试改动成本。真正的高价值是"消除重复校验"，已由内存缓存解决。

**验证**：扩充 `src/main/__tests__/conversationStore.test.ts`：
- 缓存一致性：连续多次 `saveMessages` / 元数据更新后，`listConversations` 与 `data.conversations` 反映最新且互相一致。
- 校验只跑一次：构造一个会触发 repair 的会话，确认首次读触发一次回写、后续读不再重复回写（用 `set` 调用计数或回写次数断言）。
- 损坏备份：`conversations` 为非数组（如对象 / 字符串）时，生成 `conversations_corrupt_<ts>` 备份键且 `conversations` 被重置为 `[]`。
- 现有 7 个用例保持通过（同步写穿透不破坏既有断言）。
- `npm test` + `npm run typecheck` 通过。

**接受标准**：单次操作不再 O(全历史) 重复校验（校验只首次一次）；损坏有备份且不静默清空；现有测试与新测试全部通过；对外行为不变。

### WS4 · CSP 收紧（低成本搭车）

**问题**：`index.html` 的 CSP 仅含 `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;`，未显式约束脚本、连接、对象、base、表单、frame。

**改动**：`index.html` 的 CSP 扩展为最小权限集：
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'none';
frame-src 'none';
```
说明：所有外部 API 调用都在主进程 Node 侧发起，渲染层不直连外网，故 `connect-src 'self'` 安全。`'unsafe-inline'` 仅保留给 style（Tailwind / 组件内联样式需要）。

**验证**：开发模式与构建产物均能正常加载、无 CSP 报错；聊天、Markdown、设置功能正常。

**接受标准**：CSP 生效且应用功能不退化。

## 实施顺序

1. WS1（渲染 bundle）— 收益大、最易量化，先做能立刻看到数字。
2. WS4（CSP）— 改动最小，顺手完成。
3. WS2（打包配置）— 配置类改动，注意不破坏 `dist:*`。
4. WS3（数据层）— 改动面集中但需配套测试，放在最后稳扎稳打。

每条独立可验证；每条完成后跑 `npm test && npm run typecheck && npm run build`。

## 整体验收

- `npm test`、`npm run typecheck`、`npm run build` 全部通过。
- 渲染 bundle 有改前/改后体积对比数据。
- 打包配置合法且语言裁剪/压缩语义正确（实测或有据说明）。
- 数据层新增测试覆盖缓存一致性、合并落盘、损坏备份、退出 flush。
- CSP 收紧后应用功能不退化。
- 不改动任何聊天 / Responses 业务语义。
