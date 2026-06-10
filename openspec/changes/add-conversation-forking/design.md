# Design: add-conversation-forking

## Context

- `Conversation.messages` 是平铺数组（`src/shared/types.ts:38`），无任何分支结构。
- "编辑后重发"（`chatStore.ts:382`）和"重新生成"（`chatStore.ts:348`）都用 `slice(0, idx)` 破坏性截断。
- Chat Completions 模式每轮全量重发历史（`chatStore.ts:306-316`）；Responses 模式用 `latestContiguousResponseId` 取最后一条 assistant 消息上的 `providerResponseId` 作为 `previous_response_id`（`chatStore.ts:113-127`）。
- 会话创建走 `convo:create` IPC（preload → ipc → conversationStore.createConversation），消息持久化走 `convo:saveMessages`。
- `conversationStore.ts` 的 `isConversation` / `repairConversation` 对持久化数据做白名单校验：修复路径只保留已知字段，新字段必须加入校验，否则损坏数据修复时会被静默丢弃。
- 导出 JSON 使用 `ConversationExport`（version 1）信封。

## Goals / Non-Goals

**Goals:**

- 从任意已完成消息处一键分叉出新会话，原会话不动。
- 分叉来源可见、可跳回，原会话被删后优雅降级。
- 编辑重发提供"原地编辑"（现状）与"分叉后编辑"两个入口。
- Responses 模式分叉后自然续聊（沿用已复制消息上的 `providerResponseId`），id 失效时自动回退全量重发。

**Non-Goals:**

- 不做会话内树形分支（消息保持平铺数组）。
- 不做分叉关系的图形化视图 / 分叉树导航。
- 不改"重新生成"语义（保持原地截断，不加分叉变体）。
- 不做导入功能（另一条改进线）。

## Decisions

### D1：分叉 = 新会话，而非会话内分支

复制 `messages[0..N]`（含分叉点消息）进一个新会话。与 git worktree 的直觉对应：另开一份副本，不在原地长树。数据模型、存储、搜索、导出几乎不动。

替代方案（会话内树 + 分支切换 UI，类似 ChatGPT 的 `<2/3>`）被否决：消息结构、持久化、导出、搜索全要翻修，与本次"低成本高价值"的定位不符。

### D2：`forkedFrom` 字段结构

```ts
interface ForkOrigin {
  conversationId: string;  // 原会话 id，用于跳回
  messageId: string;       // 分叉点消息 id，用于跳回后定位
  sourceTitle: string;     // 分叉时原会话标题快照，原会话被删后用于降级展示
  messageIndex: number;    // 分叉时消息序号快照（1-based，按 user/assistant 可见消息计），用于横幅"第 N 条"
}

interface Conversation {
  // ...现有字段
  forkedFrom?: ForkOrigin;
}
```

横幅展示规则：原会话存在时标题取实时值（跟随重命名），"第 N 条"恒用快照；原会话不存在时整行用快照且不可点击。快照避免每次渲染都要在原会话里反查索引，也让降级路径无需额外状态。

### D3：分叉在主进程一次完成（新 IPC `convo:fork`）

新增 `convo:fork(sourceId, messageId)`：主进程读取原会话、定位消息、复制 `messages[0..N]`、生成新会话（标题 `<原标题>（分叉）`）、写入 `forkedFrom`、持久化、返回新 `Conversation`。

替代方案（renderer 用 `convo:create` + `convo:saveMessages` 两步拼）被否决：两次 IPC 之间崩溃会留下半成品会话，且 `forkedFrom` 无法通过现有通道写入。

复制细节：

- 消息保留原 id（id 查找均以会话为作用域，跨会话重复无影响；保留 id 使 `providerResponseId` 等关联零成本继承）。
- 只复制 `status === 'done'` 语义完整的前缀：分叉点必须是 `done` 状态的 user/assistant 消息；UI 在消息流式中禁用分叉入口。
- 复制是深拷贝（含 `usage`、`toolEvents`、`providerResponseId`）。

### D4：编辑重发的两个入口

`MessageBubble` 编辑态从单一"重新发送"扩展为两个动作：

- **重新发送**（现状）：调 `editAndResend`，原地截断。
- **分叉后发送**：调新 action `forkAndResend(messageId, text)` —— 主进程 fork 出 `messages[0..N-1]`（不含被编辑消息），切换到新会话后以编辑后的文本作为新消息走现有 `send` 路径。实现上 `convo:fork` 增加可选 `exclusive` 标志：`exclusive: true` 时复制分叉点**之前**的消息（不含分叉点），`forkedFrom` 仍指向分叉点（被编辑消息）；被编辑消息是首条时自然得到空前缀的新会话，无需特殊分支。

"从这里分叉"（不编辑）则是消息悬停菜单的新按钮，调 `fork(messageId)`，复制含该消息在内的前缀并切换过去。

### D5：Responses 模式续聊与失效回退

分叉后的新会话最后一条消息就是复制来的 assistant 消息，`latestContiguousResponseId` 不改一行代码即可取到它的 `providerResponseId` —— happy path 零成本。

失效回退：DashScope 对失效/过期的 `previous_response_id` 返回 4xx 错误。处理方式：

1. `qwenService` Responses 路径识别错误体中含 `previous_response_id` / response 不存在类标识的 4xx，向 renderer 发带 `code: 'previous_response_invalid'` 的 `ChatErrorEvent`（`ChatErrorEvent` 增加可选 `code` 字段）。
2. `chatStore` 的 send 流程收到该 code 且本次请求带过 `previousResponseId` 时，自动重试一次：不带 `previousResponseId`、改为全量重发消息历史（即 Chat Completions 模式的日常拼法）。只重试一次，避免循环。

该回退同时修复了既有问题：老会话隔几天续聊时 id 过期会直接报错。

### D6：持久化校验与导出

- `isConversation` / `repairConversation` 增加 `forkedFrom` 校验：结构不合法时丢弃该字段（标记 repaired），不丢弃整个会话。
- 导出 JSON：`forkedFrom` 随 `Conversation` 自然携带，envelope `version` 保持 1（新增字段可选，旧文件读取不受影响）。
- Markdown 导出：分叉来源加一行头部注记（"分叉自 xxx 第 N 条"），纯文本即可。

## Risks / Trade-offs

- [复制消息使存储体积增长，重度分叉用户全量 JSON 更大] → 工程优化线已在处理持久层 O(全历史) 写入问题；分叉是用户显式动作，量级可控；不做引用式共享（复杂度不值）。
- [`previous_response_id` 失效错误的服务端文案可能变化，识别启发式失配] → 回退仅在"带过 id 且 4xx"时触发，识别失败的最坏结果是用户看到原始错误并手动重试，不比现状差。
- [原会话分叉点消息被单独删除后，跳回只能进入会话无法定位] → 接受：跳回会话本身仍成立，定位静默跳过。
- [分叉会话再被分叉形成链] → 每个会话只记录直接来源，不做链式追溯展示；横幅只显示一层。

## Migration Plan

纯增量字段 + 新 IPC 通道，无数据迁移。旧版本数据载入新版本无影响；新版本数据（含 `forkedFrom`）被旧版本读取时，`isConversation` 不检查未知字段，亦可通过。

## Open Questions

无 —— 三个原开放问题已由用户决定：分叉关系做可见入口（横幅+跳回）、编辑重发保留两个选项、本改动优先于 0.5。
