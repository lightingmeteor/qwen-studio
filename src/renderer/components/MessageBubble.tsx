import { useState } from 'react';
import { type ChatMessage } from '../../shared/types';
import { useChatStore } from '../store/chatStore';
import MarkdownMessage from './MarkdownMessage';

export default function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const regenerate = useChatStore((s) => s.regenerate);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const editAndResend = useChatStore((s) => s.editAndResend);
  const streaming = useChatStore((s) =>
    s.activeId ? Boolean(s.streamingByConversation[s.activeId]) : false,
  );
  const isUser = message.role === 'user';

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };

  const submitEdit = async () => {
    const content = draft.trim();
    if (!content) return;
    if (content === message.content.trim()) {
      setEditing(false);
      return;
    }

    try {
      await editAndResend(message.id, content);
      setEditing(false);
    } catch (error) {
      console.error(error);
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
              onChange={(e) => setDraft(e.target.value)}
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
