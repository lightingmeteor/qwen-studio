# Qwen Studio 0.3 设计文档

日期：2026-06-04

## 目标

0.3 把 Qwen Studio 从“可用的本地聊天 MVP”推进到“可以长期使用和管理聊天资产”的桌面客户端。范围聚焦会话整理、历史检索、导出备份、usage 汇总、设置诊断和消息编辑重发。

0.3 不接入 Responses API、联网搜索、文件上传、SQLite、云同步、自动更新或导入功能。这些能力留给 0.4 及之后的版本。

## 用户能力

用户在 0.3 中应能做到：

- 将重要会话置顶。
- 将不常用会话归档，并在侧边栏筛选全部、置顶、归档。
- 按会话标题和消息正文搜索本地历史。
- 从搜索结果跳转到对应会话。
- 导出单个会话为 Markdown。
- 导出全部会话为版本化 JSON 备份。
- 查看当前会话的 tokens 使用汇总。
- 在设置页测试当前 API Key、Base URL 和模型是否可用。
- 编辑用户消息后从该轮重新生成后续回答。
- 遇到聊天错误时看到用户友好的错误说明和可展开的技术细节。

## 架构

沿用现有 Electron main/preload/renderer 边界。

主进程继续拥有持久化、API Key、外部文件写入和网络诊断能力。Renderer 只能通过 preload 白名单接口请求会话变更、导出和诊断。API Key 不返回 renderer。

0.3 不迁移持久层。`electron-store` 继续保存会话数组，但 `Conversation` 增加可选 `pinned` 和 `archived` 字段。读取旧数据时，现有修复逻辑接受缺失字段；写入时只保存受校验的会话结构。

为了避免继续扩大 `ipc.ts`，新增纯函数模块处理导出序列化和 usage 汇总。IPC 只负责参数校验、调用 store/service、返回结果。

## 数据模型

`Conversation` 增加两个可选字段：

```ts
interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
}
```

`ChatMessage` 增加错误细节字段：

```ts
interface ChatMessage {
  error?: string;
  errorDetail?: string;
}
```

导出 JSON 使用版本化 envelope：

```ts
interface ConversationExport {
  version: 1;
  exportedAt: number;
  conversations: Conversation[];
}
```

连接诊断返回结构：

```ts
type DiagnosticCategory =
  | 'ok'
  | 'missing_key'
  | 'auth'
  | 'region_or_model'
  | 'network'
  | 'timeout'
  | 'config'
  | 'unknown';

interface ConnectionDiagnostic {
  ok: boolean;
  category: DiagnosticCategory;
  message: string;
  detail?: string;
}
```

## 主进程与 IPC

新增会话接口：

- `convo:setPinned(id, pinned)`
- `convo:setArchived(id, archived)`
- `convo:exportMarkdown(id)`
- `convo:exportJson()`
- `diagnostics:testConnection()`

导出由主进程打开保存对话框并写文件。取消保存不算错误，返回 `{ canceled: true }`。成功返回 `{ canceled: false, filePath }`。

连接诊断由主进程读取当前设置和 API Key，调用一个最小的非流式 Chat Completions 请求。诊断只返回分类、简短说明和可选技术细节，不返回 API Key。

## Renderer 交互

### 侧边栏

侧边栏顶部增加搜索框和筛选 segmented control：

- 全部：显示未归档会话和置顶会话。
- 置顶：只显示已置顶且未归档会话。
- 归档：只显示归档会话。

搜索匹配会话标题和消息正文。搜索时显示匹配结果；点击结果切换到对应会话。置顶会话在普通列表中排在前面，其余按 `updatedAt` 倒序。

会话 hover 操作增加：

- 置顶/取消置顶。
- 归档/取消归档。
- 重命名。
- 删除。

### 聊天页

聊天页标题区显示当前会话 usage 汇总：prompt tokens、completion tokens、total tokens。没有 usage 时不显示。

用户消息 hover 操作增加“编辑”。编辑后提交会删除该用户消息及其后续消息，用编辑后的文本重新发送。若当前会话正在生成，则禁用编辑。

Assistant 错误消息显示友好错误；若有 `errorDetail`，提供折叠区查看技术细节。

### 设置页

设置页增加“测试连接”按钮。点击后调用主进程诊断接口，并显示结果：

- 成功：说明 Key、Base URL、模型可用。
- 缺少 Key：提示先保存 API Key。
- 认证失败：提示检查 Key。
- 地域/模型问题：提示检查 Base URL 和模型名是否匹配。
- 网络/超时：提示检查网络或代理。
- 配置问题：例如 Base URL 中仍有 `{WorkspaceId}`。

## 错误处理

- 导出取消：UI 显示为无操作，不显示错误。
- 导出写入失败：显示错误说明，技术细节写入 console。
- 诊断失败：返回分类结果，renderer 不直接展示原始异常栈。
- 聊天 API 错误：保留现有友好错误，同时尽量保存 HTTP status 或响应片段为 `errorDetail`。
- 会话不存在：主进程接口抛出明确错误，renderer 刷新列表后保持可用。

## 测试计划

0.3 使用 TDD 实施。

主进程测试：

- 旧会话数据缺少 `pinned`/`archived` 时仍可读取。
- `setPinned` 和 `setArchived` 更新会话并刷新 `updatedAt`。
- Markdown 导出包含标题、时间、角色、消息正文和 usage。
- JSON 导出 envelope 包含 `version: 1` 和全部会话。
- 诊断把 401/403 分类为 `auth`，404/400 分类为 `region_or_model`，网络错误分类为 `network`，超时分类为 `timeout`。

Renderer store 测试：

- 置顶/归档调用 preload API 后更新本地状态。
- 搜索标题和消息正文都能匹配。
- 筛选全部、置顶、归档行为正确。
- 编辑用户消息会截断该轮及之后消息，并用新文本重新发送。
- 生成中禁用编辑、删除、重新生成等会改变当前会话的操作。

共享层测试：

- usage 汇总只统计有 `usage` 的 assistant 消息。
- 导出序列化对 Markdown 特殊字符和代码块保持可读。
- 诊断分类函数对常见错误稳定。

验收命令：

- `npm test`
- `npm run typecheck`
- `npm run build`

## 0.4 衔接

0.3 完成后，0.4 再引入 Responses API。0.3 的诊断、错误细节、usage 汇总和会话整理能力会成为 0.4 的基础。0.4 不应在 0.3 尚未稳定时改写现有 Chat Completions 流程。

