# 问题记录

## 已修复

### 归档会话仍可能被默认选中

- 现象：启动或删除当前会话后，归档会话可能被当作默认活动会话。
- 影响：用户可能误以为归档会话仍在主列表中继续工作。
- 修复：默认活动会话选择逻辑改为优先选择未归档会话，归档会话只在显式筛选时进入工作流。
- 相关记录：`e4efcc9 fix: avoid selecting archived conversations by default`

### Responses 上下文可能串到不连续历史

- 现象：编辑、删除或混合 API 模式后，旧的 `previous_response_id` 可能被错误沿用。
- 影响：模型可能拿到不该复用的 Responses 上下文。
- 修复：只从连续且最后一条可见 assistant 消息中取 Responses response id，避免跨断点复用。
- 相关记录：`42d0dfc fix: avoid stale responses context in mixed history`

### Responses 设置没有完整走 IPC 持久化

- 现象：API 模式和联网搜索开关保存后可能没有正确进入主进程设置。
- 影响：用户切换模式后重启或再次发送时配置不一致。
- 修复：IPC 设置补丁增加 `apiMode` 和 `webSearchEnabled` 校验并转发给设置存储。
- 相关记录：`c46a53b fix: persist responses settings through ipc`

### 畸形设置和工具元数据会污染会话数据

- 现象：旧版本或异常写入可能留下非法 API 模式、工具状态或消息元数据。
- 影响：会话加载、保存或工具状态展示可能失败。
- 修复：设置和会话读取增加修复逻辑，丢弃非法可选字段并保留可用消息。
- 相关记录：`1436241 fix: repair malformed settings and tool keys`

### 老会话 Responses 续聊时 previous_response_id 过期直接报错

- 现象：Responses 模式下隔较久继续老会话（或在分叉会话中续聊）时，服务端可能已回收 `previous_response_id` 对应的上下文，请求被 4xx 拒绝。
- 影响：用户只能看到原始错误，需要手动想办法绕开。
- 修复：主进程识别该类失效错误并标记 `previous_response_invalid`；renderer 对带过 id 的请求自动重试一次，改为不带 id 的全量历史重发，最多重试一次不循环。
- 相关记录：`90fe306 feat: add conversation forking backend (store/ipc/chat actions)`

### forkConversation 写盘绕过会话缓存

- 现象：分叉功能与会话持久化缓存（PR #4）并行开发，合并后 `forkConversation` 仍直接写盘，没有走 `writeConversations` 更新内存缓存。
- 影响：分叉后立即读取会话列表会拿到旧数据（合并前被测试发现，未流入发布版本）。
- 修复：`forkConversation` 的写入统一改走 `writeConversations`。
- 相关记录：`80f6b2c fix: route forkConversation writes through writeConversations cache`

## 后续排查规则

- 新 bug 先记录现象、影响、触发条件和修复方式，再合入代码。
- 任何包含 API Key、Authorization 或用户消息正文的错误细节，都必须先脱敏再进入日志或界面。
- 会话数据修复类问题要保留损坏数据备份或说明不可恢复字段，避免静默丢失。
