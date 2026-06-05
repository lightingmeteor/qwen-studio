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

## 后续排查规则

- 新 bug 先记录现象、影响、触发条件和修复方式，再合入代码。
- 任何包含 API Key、Authorization 或用户消息正文的错误细节，都必须先脱敏再进入日志或界面。
- 会话数据修复类问题要保留损坏数据备份或说明不可恢复字段，避免静默丢失。
