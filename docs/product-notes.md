# 产品说明

## 这个产品做什么

Qwen Studio Desktop 是一个本地桌面聊天客户端，面向日常使用 Qwen / DashScope / 阿里云百炼 OpenAI 兼容接口的用户。它把 API Key、模型、地域和常用对话操作收进一个桌面应用里，让用户可以在本机完成流式聊天、会话管理、Markdown 阅读、连接诊断和导出备份。

当前产品重点：

- 提供多会话文本聊天，支持新建、切换、重命名、删除、置顶、归档和搜索。
- 支持 Chat Completions 稳定路径，以及 Responses API 的基础文本对话、`previous_response_id` 上下文和 `web_search` 工具状态展示。
- 在本机保存设置和会话历史，API Key 由 Electron 主进程通过 `safeStorage` 加密保存。
- 提供连接测试，帮助定位 API Key、地域、Base URL、模型、网络和超时问题。
- 支持当前会话 Markdown 导出、全部会话 JSON 导出，以及 tokens usage 汇总。

## 这个产品不做什么

当前版本不做账号体系、云同步、团队协作、服务端代理、自动更新和跨设备历史同步。它也不把聊天历史上传到模型接口以外的服务。

暂未纳入的模型能力包括：文件 / Qwen-Long、多模态输入、知识库搜索、自定义函数、`web_extractor`、`code_interpreter` 和完整的工具编排。Responses API 目前只接入 `web_search`，Chat Completions 仍是默认稳定路径。

## 维护边界

- 用户隐私优先：日志和诊断信息不得记录 API Key、Authorization 头或用户消息正文。
- 本地优先：数据持久化默认走本机 `electron-store`，不引入后端服务。
- 小步上线：新能力先补文档、测试和问题记录，再进入发布说明。
