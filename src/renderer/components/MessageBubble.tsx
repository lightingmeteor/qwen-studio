import { useState } from 'react';
import { type ChatMessage, type ToolEvent } from '../../shared/types';
import { useChatStore } from '../store/chatStore';
import MarkdownMessage from './MarkdownMessage';

const TOOL_STATUS_LABELS: Record<ToolEvent['status'], string> = {
  started: '进行中',
  completed: '完成',
  failed: '失败',
};

const TOOL_STATUS_STYLES: Record<ToolEvent['status'], string> = {
  started: 'bg-sky-300',
  completed: 'bg-emerald-300',
  failed: 'bg-red-300',
};

function compactDetail(detail: string, maxLength = 140): string {
  const normalized = detail.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function describeToolEvents(events: ToolEvent[]): string {
  const failed = events.filter((event) => event.status === 'failed').length;
  const active = events.filter((event) => event.status === 'started').length;
  const completed = events.filter((event) => event.status === 'completed').length;

  if (active > 0) return `工具运行中 (${active}/${events.length})`;
  if (failed > 0) return `工具有失败 (${failed}/${events.length})`;
  return `工具已完成 (${completed}/${events.length})`;
}

export default function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [editError, setEditError] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const regenerate = useChatStore((s) => s.regenerate);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const editAndResend = useChatStore((s) => s.editAndResend);
  const streaming = useChatStore((s) =>
    s.activeId ? Boolean(s.streamingByConversation[s.activeId]) : false,
  );
  const isUser = message.role === 'user';
  const toolEvents = isUser ? [] : (message.toolEvents ?? []);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startEdit = () => {
    setDraft(message.content);
    setEditError('');
    setEditing(true);
  };

  const submitEdit = async () => {
    const content = draft.trim();
    if (!content) return;
    setEditError('');
    if (content === message.content.trim()) {
      setEditing(false);
      return;
    }

    try {
      await editAndResend(message.id, content);
      const originalMessageStillExists = useChatStore
        .getState()
        .conversations.some((conversation) =>
          conversation.messages.some((item) => item.id === message.id),
        );
      if (originalMessageStillExists) {
        setEditError('无法发送，请检查 API Key 或当前生成状态。');
        return;
      }
      setEditing(false);
    } catch (error) {
      console.error(error);
      setEditError('无法发送，请检查 API Key 或当前生成状态。');
    }
  };

  return (
    <div className={`flex min-w-0 ${isUser ? 'justify-end' : 'justify-start'} group`}>
      <div
        className={`min-w-0 max-w-[80%] break-words rounded-2xl px-4 py-3 [overflow-wrap:anywhere] ${
          isUser ? 'bg-sky-600/30' : 'bg-white/5'
        }`}
      >
        <div className="text-xs text-white/40 mb-1">{isUser ? '你' : 'Qwen'}</div>

        {message.status === 'error' ? (
          <div className="text-red-300 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
            ⚠️ {message.error}
            {message.errorDetail && (
              <details className="mt-2 text-xs text-red-100/75">
                <summary className="cursor-pointer select-none text-red-100/60 hover:text-red-100">
                  技术细节
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere]">
                  {message.errorDetail}
                </pre>
              </details>
            )}
          </div>
        ) : editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setEditError('');
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void submitEdit();
                }
                if (e.key === 'Escape') {
                  setEditing(false);
                }
              }}
              rows={Math.min(8, Math.max(3, draft.split('\n').length))}
              className="w-full min-w-[220px] resize-y rounded border border-sky-300/30 bg-black/20 px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-sky-300/70"
              autoFocus
            />
            {editError && <div className="text-xs text-red-200/90">{editError}</div>}
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setEditing(false)}
                className="rounded border border-white/10 px-2 py-1 text-white/55 hover:bg-white/10 hover:text-white/85"
              >
                取消
              </button>
              <button
                onClick={() => void submitEdit()}
                disabled={!draft.trim()}
                className="rounded bg-sky-500/80 px-2 py-1 text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                发送
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
            {message.content}
          </div>
        ) : (
          <MarkdownMessage content={message.content || (message.status === 'streaming' ? '▍' : '')} />
        )}

        {toolEvents.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-black/15 text-xs text-white/60">
            <button
              type="button"
              onClick={() => setToolsOpen((open) => !open)}
              className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  toolEvents.some((event) => event.status === 'failed')
                    ? TOOL_STATUS_STYLES.failed
                    : toolEvents.some((event) => event.status === 'started')
                      ? TOOL_STATUS_STYLES.started
                      : TOOL_STATUS_STYLES.completed
                }`}
              />
              <span className="min-w-0 flex-1 font-medium text-white/70 [overflow-wrap:anywhere]">
                {describeToolEvents(toolEvents)}
              </span>
              <span className="shrink-0 text-white/35">{toolsOpen ? '收起' : '展开'}</span>
            </button>
            {toolsOpen && (
              <div className="space-y-2 border-t border-white/10 px-3 py-2">
                {toolEvents.map((event, index) => (
                  <div key={`${event.id}:${event.status}:${index}`} className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TOOL_STATUS_STYLES[event.status]}`} />
                      <span className="shrink-0 text-white/45">{TOOL_STATUS_LABELS[event.status]}</span>
                      <span className="min-w-0 flex-1 text-white/75 [overflow-wrap:anywhere]">{event.title}</span>
                    </div>
                    {event.detail && (
                      <div className="mt-1 pl-3 text-[11px] leading-relaxed text-white/45 [overflow-wrap:anywhere]">
                        {compactDetail(event.detail)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {message.aborted && <div className="text-xs text-white/40 mt-1">（已停止）</div>}
        {message.usage && (
          <div className="text-xs text-white/30 mt-1 [overflow-wrap:anywhere]">
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
              {message.status === 'error' ? '重试' : '重新生成'}
            </button>
          )}
          {isUser && !streaming && !editing && (
            <button onClick={startEdit} className="hover:text-white/90">
              编辑
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
