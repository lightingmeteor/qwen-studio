import { useState } from 'react';
import { type ChatMessage } from '../../shared/types';
import { useChatStore } from '../store/chatStore';
import MarkdownMessage from './MarkdownMessage';

export default function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const regenerate = useChatStore((s) => s.regenerate);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const streaming = useChatStore((s) =>
    s.activeId ? Boolean(s.streamingByConversation[s.activeId]) : false,
  );
  const isUser = message.role === 'user';

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
