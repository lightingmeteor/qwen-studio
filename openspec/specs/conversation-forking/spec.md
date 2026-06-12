# conversation-forking

## Purpose

允许用户从会话中任意一条已完成消息处分叉出独立的新会话：原会话保持不变，新会话携带可见、可跳回的来源信息。为"改写历史"类操作（编辑重发）提供不破坏原会话的替代路径，并保证 Responses 模式下分叉续聊的连续性与失效回退。

## Requirements

### Requirement: 从消息处分叉出新会话

系统 SHALL 允许用户从会话中任意一条状态为 `done` 的 user 或 assistant 消息处分叉：创建一个新会话，包含原会话从开头到该消息（含）的全部消息副本，原会话保持不变。新会话 SHALL 记录 `forkedFrom`（原会话 id、分叉点消息 id、原会话标题快照、分叉点序号快照），标题为 `<原标题>（分叉）`，并在创建后成为当前活跃会话。

#### Scenario: 从中间一条模型回复分叉

- **WHEN** 用户在一个有 20 条消息的会话中，对第 10 条（assistant、status=done）点击"从这里分叉"
- **THEN** 创建一个新会话，包含原会话第 1–10 条消息的副本（深拷贝，保留消息 id、usage、toolEvents、providerResponseId）
- **THEN** 原会话仍有完整 20 条消息
- **THEN** 新会话的 `forkedFrom` 指向原会话与第 10 条消息，并成为当前活跃会话

#### Scenario: 流式中的消息不可分叉

- **WHEN** 一条 assistant 消息正在流式生成（status=streaming）
- **THEN** 该消息的悬停菜单不提供"从这里分叉"入口

#### Scenario: 分叉操作原子完成

- **WHEN** renderer 发起分叉请求
- **THEN** 主进程在单次 IPC（`convo:fork`）内完成复制、写入 `forkedFrom` 与持久化，不产生中间状态的半成品会话

### Requirement: 分叉来源横幅与跳回

分叉出的会话 SHALL 在聊天页顶部显示来源横幅"分叉自 <原会话标题> 第 N 条"。原会话存在时标题 SHALL 取实时值且横幅可点击；点击 SHALL 切换到原会话并滚动定位到分叉点消息。原会话已被删除时横幅 SHALL 降级为使用标题快照的纯文本，不可点击。"第 N 条"恒使用分叉时的序号快照。

#### Scenario: 点击横幅跳回原会话

- **WHEN** 用户在分叉会话中点击横幅"分叉自 xxx 第 10 条"
- **THEN** 应用切换到原会话，消息列表滚动到第 10 条（分叉点）消息

#### Scenario: 原会话被重命名

- **WHEN** 原会话标题从 "xxx" 改为 "yyy" 后用户查看分叉会话
- **THEN** 横幅显示"分叉自 yyy 第 10 条"

#### Scenario: 原会话被删除

- **WHEN** 原会话已被删除，用户查看分叉会话
- **THEN** 横幅以标题快照显示"分叉自 xxx 第 10 条"，呈不可点击状态

#### Scenario: 分叉点消息被单独删除

- **WHEN** 原会话存在但分叉点消息已被删除，用户点击横幅
- **THEN** 应用切换到原会话，不做滚动定位，不报错

### Requirement: 编辑重发提供原地与分叉两个选项

用户编辑自己的消息后，系统 SHALL 提供两个发送方式：「重新发送」保持现状（截断该消息及之后内容并原地重发）；「分叉后发送」SHALL 创建一个包含该消息之前全部消息（不含被编辑消息）的分叉会话，切换过去后以编辑后的文本作为新消息发送，原会话完全不变。

#### Scenario: 分叉后发送

- **WHEN** 用户编辑第 5 条（user）消息并选择"分叉后发送"
- **THEN** 创建分叉会话，包含原会话第 1–4 条消息副本
- **THEN** 编辑后的文本在分叉会话中作为新 user 消息发送并开始流式回复
- **THEN** 原会话的第 5 条及之后消息全部保留

#### Scenario: 原地重新发送保持现有行为

- **WHEN** 用户编辑消息后选择"重新发送"
- **THEN** 行为与现状一致：该消息及之后的消息被截断，编辑后内容原地重发

### Requirement: Responses 模式分叉续聊与失效回退

Responses 模式下，分叉会话续聊 SHALL 沿用复制消息上最近的 `providerResponseId` 作为 `previous_response_id`。当服务端以 4xx 拒绝且错误可识别为 `previous_response_id` 失效时，主进程 SHALL 向 renderer 发送带 `code: 'previous_response_invalid'` 的错误事件；renderer SHALL 对带过 `previousResponseId` 的请求自动重试一次，改为不带 id 的全量消息历史重发。同一条消息 SHALL 最多自动重试一次。

#### Scenario: 分叉后自然续聊

- **WHEN** 用户在 Responses 模式的分叉会话中发送新消息，且最后一条复制来的 assistant 消息带有 `providerResponseId`
- **THEN** 请求携带该 id 作为 `previous_response_id`，仅发送新的 user 消息

#### Scenario: id 失效自动回退

- **WHEN** 携带 `previous_response_id` 的请求被服务端以可识别的失效错误拒绝
- **THEN** renderer 自动重试一次：不携带 `previousResponseId`，发送全量消息历史
- **THEN** 重试成功后用户正常收到流式回复，无需手动干预

#### Scenario: 回退后仍失败不再循环

- **WHEN** 回退重试的请求也失败
- **THEN** 错误正常展示给用户，不再自动重试

### Requirement: forkedFrom 的持久化校验与导出

持久化层 SHALL 校验 `forkedFrom` 字段（四个子字段类型齐全才保留）；结构不合法时 SHALL 丢弃该字段并标记修复，不得丢弃整个会话。JSON 导出 SHALL 随会话携带 `forkedFrom`，envelope version 保持 1。单会话 Markdown 导出 SHALL 在头部以纯文本注记分叉来源。

#### Scenario: 损坏的 forkedFrom 被修复

- **WHEN** 持久化数据中某会话的 `forkedFrom.messageIndex` 为字符串
- **THEN** 载入后该会话保留全部消息，仅 `forkedFrom` 字段被移除

#### Scenario: 旧版本数据兼容

- **WHEN** 载入不含 `forkedFrom` 字段的既有会话数据
- **THEN** 校验通过，行为与现状完全一致

#### Scenario: JSON 导出携带分叉信息

- **WHEN** 导出全部会话为 JSON
- **THEN** 分叉会话的 `forkedFrom` 字段出现在导出文件中，`version` 仍为 1
