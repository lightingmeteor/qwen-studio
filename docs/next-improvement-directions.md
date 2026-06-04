# Qwen Studio 下一步改进方向研究

日期：2026-06-04

## 结论摘要

0.3 已按本研究建议实施，主线为 **会话资产化 + 使用可靠性**。下一阶段进入 0.4：Responses API / 联网搜索 / 内置工具。

当前项目已经完成桌面文本聊天 MVP 和 0.2 改进：基础聊天、流式输出、多会话、本地历史、设置、安全 IPC、地域/模型预设、Windows/macOS/Linux 打包脚本都已具备。测试、类型检查和构建均通过。因此下一步不必先做稳定性救火，而应提升长期使用体验。

路线顺序：

1. 0.3：会话资产化 + 使用可靠性。（已实施）
2. 0.4：Responses API / 联网搜索 / 内置工具。（下一步）
3. 0.5：文件、长文档与多模态输入。
4. 发布工程增强穿插推进：自动更新、签名、公证、诊断日志。

## 当前项目状态

### 已有能力

- 多会话聊天：新建、切换、重命名、删除。
- 流式输出：支持按会话独立生成和停止。
- 本地历史：使用 `electron-store` 保存会话和消息。
- 设置面板：API Key、Base URL、模型、Temperature、System Prompt。
- Markdown 渲染：表格、代码块、高亮、复制代码。
- 消息操作：复制、重新生成/重试、删除。
- 安全边界：API Key 只在主进程使用，preload 暴露白名单 IPC。
- 发布基础：已有 Windows/macOS/Linux 打包脚本，已有 Windows/macOS 发布 workflow。

### 当前验证结果

- `npm test`：8 个测试文件、43 个用例通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。

### 结构信号

当前最重的文件：

- `src/renderer/store/chatStore.ts`：348 行。
- `src/main/ipc.ts`：344 行。
- `src/main/conversationStore.ts`：185 行。
- `src/main/qwenService.ts`：178 行。

这说明后续新增能力如果同时碰到主进程、preload、renderer 状态和 UI，复杂度会很快集中到最重的模块。下一阶段应选择一个主轴，避免一次性接入文件、多模态、工具调用、自动更新等多条路线。

## 外部能力变化

### Qwen Responses API

Alibaba Cloud Model Studio 文档显示，Qwen 支持 OpenAI-compatible Responses API。相较 Chat Completions，它提供：

- 内置工具：web search、web extractor、code interpreter、text-to-image search、image-to-image search、knowledge base search。
- 更灵活的输入：可以直接传字符串，也兼容消息数组。
- 更简单的上下文管理：可以用 `previous_response_id` 关联上下文。

参考：
https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses

影响：这是 0.4 的好方向，但它不是简单替换 endpoint。它会引入新的响应事件、工具调用状态、可见工具轨迹、错误处理和模型/地域兼容性判断。

### Qwen-Long

Qwen-Long 支持通过文件上传和 `file-id` 引用处理长文档。文档说明：

- 支持格式包括 TXT、DOCX、PDF、XLSX、EPUB、MOBI、MD、CSV、JSON、BMP、PNG、JPG/JPEG、GIF。
- 单次请求最多可引用 100 个文件。
- 总上下文限制可达 10M tokens。
- 文件上传后保存在 Model Studio 账户空间中。

参考：
https://www.alibabacloud.com/help/en/model-studio/long-context-qwen-long

影响：这是 0.5 的好方向，但需要文件生命周期管理、上传状态、删除/清理、地域限制提示、配额提示、隐私提示，以及会话和文件绑定关系。

### 发布与自动更新

electron-builder 文档显示自动更新依赖 `electron-updater` 和发布 metadata。macOS 自动更新还需要签名，macOS target 通常需要 `dmg` 和 `zip` 以生成更新 metadata。

参考：
https://www.electron.build/docs/features/auto-update

影响：这是产品化的重要方向，但更像发布工程。它可以穿插推进，不宜压过 0.3 的核心用户价值。

## 候选路线

### 路线 A：0.3 会话资产化 + 使用可靠性（已实施）

目标：让用户可以长期保存、查找、整理、复用自己的聊天资产。

建议功能：

- 会话搜索：按标题和消息内容搜索。
- 会话置顶/归档：让长期项目和临时聊天分层。
- 消息编辑后重新发送：修正 prompt 时不用手工复制。
- 导出：Markdown 或 JSON 导出，方便备份和迁移；导入作为待决项，不默认纳入首批。
- Usage 汇总：按消息、会话、全局统计 tokens。
- 设置诊断：检查 API Key、Base URL、模型可用性和地域模板。
- 错误恢复：更清晰地区分认证、地域、模型、网络、超时、用户中止。

价值：

- 直接改善日常使用。
- 风险低于新 API 和文件能力。
- 能为后续文件、联网搜索、工具调用提供更好的信息架构。

风险：

- 搜索和归档会让 `Conversation` 类型扩展。
- `electron-store` 单体 JSON 在历史变大后可能成为瓶颈。
- 如果 0.3 同时做太多 UI 改版，范围容易膨胀。

建议范围：

- 不迁移 SQLite，除非搜索性能或数据体量已证明需要。
- 不做云同步。
- 不接 Responses API。
- 不做文件上传。

### 路线 B：0.4 Responses API / 联网搜索 / 内置工具

目标：让 Qwen Studio 从纯聊天变成可联网、可抽取网页、可执行代码的助手。

建议功能：

- Provider 层新增 Chat Completions 和 Responses 两种能力。
- 设置里增加“联网搜索/工具模式”开关。
- 消息流支持工具事件，例如 search started、extractor result、code interpreter result。
- UI 中显示工具调用轨迹，但默认折叠。
- 保留现有 Chat Completions 作为稳定默认。

价值：

- 差异化明显。
- 跟 Model Studio 最新能力对齐。
- 对研究、资料整理、编码辅助价值高。

风险：

- 新流式事件解析复杂。
- 模型/地域支持矩阵会变化。
- 工具调用成本和隐私提示必须明确。
- 需要重新设计 `qwenService.ts` 和 `llmProvider.ts` 的边界。

### 路线 C：0.5 文件、长文档、多模态

目标：支持用户把 PDF、DOCX、XLSX、Markdown、图片等材料带入聊天。

建议功能：

- 会话附件列表。
- 文件上传到 Model Studio，保存 `file-id` 和本地元数据。
- 上传状态、解析中、解析失败、可用状态。
- 调用 Qwen-Long 时自动把选中文件作为 system message 引用。
- 文件删除/清理入口。
- 明确提示文件会上传到用户的 Model Studio 账户空间。

价值：

- 对长文档问答价值高。
- 非常适合桌面客户端。
- 能成为核心卖点。

风险：

- 文件生命周期和隐私处理复杂。
- 地域限制更强。
- 需要设计文件与会话、模型、Base URL 的绑定关系。
- 需要更多端到端测试和手动验证。

### 路线 D：发布产品化

目标：让下载、安装、升级、诊断更像正式产品。

建议功能：

- 自动更新。
- macOS 签名/公证。
- Windows 签名。
- 应用内版本信息、检查更新。
- 日志导出和诊断包。
- 首次启动引导和连接测试。

价值：

- 降低非开发者使用门槛。
- 对公开分发很重要。

风险：

- 证书、平台策略、CI secret、发布流程成本较高。
- 本地验证比普通功能困难。

## 0.3 实施范围

0.3 已按三个小批次实施。

### 0.3.1 会话整理

- 会话置顶。
- 会话归档。
- 侧边栏筛选：全部、置顶、归档。
- 会话标题编辑保留现有能力。

### 0.3.2 搜索与导出

- 本地搜索标题和消息内容。
- 搜索结果跳转到对应会话。
- 单会话导出 Markdown。
- 全量导出 JSON。

### 0.3.3 可靠性与诊断

- 设置面板增加“测试连接”。
- 显示认证、地域、模型、网络、超时的诊断结果。
- Usage 按会话汇总。
- 错误消息保留技术细节的折叠区。

## 数据模型影响

推荐最小扩展：

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

导出 JSON 使用版本化 envelope，避免以后字段变化破坏导入：

```ts
interface ConversationExport {
  version: 1;
  exportedAt: number;
  conversations: Conversation[];
}
```

暂不建议在 0.3 引入 SQLite。只有当搜索或导出暴露出明显性能问题，再设计持久层迁移。

## 成功标准

0.3 成功应满足：

- 用户能在 30 秒内找到历史对话。
- 用户能把重要会话从临时会话中分离出来。
- 用户能导出并备份自己的聊天数据。
- 用户遇到 API 配置问题时，能知道是 Key、地域、模型还是网络问题。
- 原有聊天流式体验不退化。
- API Key 仍不暴露给 renderer。
- 测试、类型检查、构建继续通过。

## 已关闭问题

1. 下一阶段确认选择 0.3：会话资产化 + 使用可靠性。
2. 0.3 只做导出，不做导入。
3. 搜索使用当前本地会话数据做轻量搜索，暂不迁移 SQLite。
4. Usage 汇总只显示 tokens，不估算价格。
5. 发布工程增强暂不穿插进 0.3，后续单独安排。

## 当前建议

0.3 已完成后，继续进入 0.4 正式设计。0.4 应覆盖：

- Chat Completions 与 Responses API 的 provider 边界。
- SSE 通用解析和 Responses 事件映射。
- `previous_response_id` 的持久化和上下文传递。
- `web_search` 作为首个内置工具。
- 工具调用状态在 UI 中的折叠展示。
- 模型/地域支持提示、成本和隐私提示。
- 测试计划。
