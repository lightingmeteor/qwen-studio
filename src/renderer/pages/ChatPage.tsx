import { useEffect, useRef, useState } from 'react';
import { summarizeUsage } from '../../shared/conversationUtils';
import type { ExportResult } from '../../shared/types';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../store/settingsStore';
import MessageBubble from '../components/MessageBubble';
import ChatInput from '../components/ChatInput';
import ModelSelect from '../components/ModelSelect';
import WelcomeState from '../components/WelcomeState';

type ExportStatus = { tone: 'success' | 'error'; text: string };

export default function ChatPage({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const exportActiveConversationMarkdown = useChatStore((s) => s.exportActiveConversationMarkdown);
  const exportAllConversationsJson = useChatStore((s) => s.exportAllConversationsJson);
  const hasKey = useSettingsStore((s) => s.hasKey);
  const active = conversations.find((c) => c.id === activeId);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 一次性滚动目标（横幅跳回原会话后定位分叉点消息用），消费后即清空。
  const scrollTargetRef = useRef<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);

  useEffect(() => {
    const targetId = scrollTargetRef.current;
    if (targetId) {
      scrollTargetRef.current = null;
      // 分叉点消息可能已被删除：找不到就只切换会话，不滚动、不报错。
      document
        .querySelector(`[data-message-id="${CSS.escape(targetId)}"]`)
        ?.scrollIntoView({ block: 'center' });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages]);

  useEffect(() => {
    if (!exportStatus) return undefined;
    const timer = window.setTimeout(() => setExportStatus(null), 2400);
    return () => window.clearTimeout(timer);
  }, [exportStatus]);

  const forkedFrom = active?.forkedFrom;
  const forkSource = forkedFrom
    ? conversations.find((c) => c.id === forkedFrom.conversationId)
    : undefined;

  const jumpToForkOrigin = () => {
    if (!forkedFrom || !forkSource) return;
    scrollTargetRef.current = forkedFrom.messageId;
    selectConversation(forkSource.id);
  };

  const isEmpty = !active || active.messages.length === 0;
  const usage = active ? summarizeUsage(active.messages) : null;
  const hasUsage = !!usage && usage.totalTokens > 0;
  const usageText =
    usage && hasUsage
      ? `tokens ${usage.promptTokens}+${usage.completionTokens}=${usage.totalTokens}`
      : '';

  const describeExportResult = (result: ExportResult | undefined, label: string) => {
    if (!result) {
      setExportStatus({ tone: 'error', text: '没有可导出的会话' });
      return;
    }

    if (result.canceled) {
      return;
    }

    if (result.error) {
      console.error(result.detail ?? result.error);
      setExportStatus({ tone: 'error', text: result.error });
      return;
    }

    setExportStatus({ tone: 'success', text: `${label}已导出` });
  };

  const exportMarkdown = async () => {
    setExportStatus(null);
    try {
      describeExportResult(await exportActiveConversationMarkdown(), 'Markdown');
    } catch (error) {
      setExportStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  const exportJson = async () => {
    setExportStatus(null);
    try {
      describeExportResult(await exportAllConversationsJson(), 'JSON');
    } catch (error) {
      setExportStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <main className="flex-1 flex flex-col min-w-0">
      <header className="h-12 shrink-0 border-b border-white/10 flex items-center justify-between gap-3 px-4">
        <div className="min-w-0 flex items-baseline gap-3">
          <div className="text-sm text-white/60 truncate">{active?.title ?? 'Qwen Studio'}</div>
          {hasUsage && (
            <div
              className="hidden md:block shrink-0 text-xs text-white/35"
              title={`prompt ${usage?.promptTokens ?? 0}, completion ${usage?.completionTokens ?? 0}`}
            >
              {usageText}
            </div>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {exportStatus && (
            <div
              className={`hidden sm:block max-w-40 truncate text-xs ${
                exportStatus.tone === 'error'
                  ? 'text-red-300'
                  : 'text-emerald-300'
              }`}
              title={exportStatus.text}
            >
              {exportStatus.text}
            </div>
          )}
          <button
            onClick={() => void exportMarkdown()}
            disabled={!active}
            className="rounded border border-white/10 px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-35"
            title="导出当前会话 Markdown"
          >
            MD
          </button>
          <button
            onClick={() => void exportJson()}
            className="rounded border border-white/10 px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white/85"
            title="导出全部会话 JSON"
          >
            JSON
          </button>
          <ModelSelect />
          <button onClick={onOpenSettings} className="text-sm text-white/60 hover:text-white/90">
            ⚙
          </button>
        </div>
      </header>

      {!hasKey && (
        <div className="bg-amber-500/15 text-amber-200 text-sm px-4 py-2 flex items-center justify-between">
          <span>还没配置 API Key，无法发送消息。</span>
          <button onClick={onOpenSettings} className="underline">
            去设置
          </button>
        </div>
      )}

      {forkedFrom &&
        (forkSource ? (
          <button
            onClick={jumpToForkOrigin}
            className="shrink-0 bg-sky-500/10 px-4 py-1.5 text-left text-xs text-sky-200/90 hover:bg-sky-500/20 hover:text-sky-100"
            title="跳回原会话并定位到分叉点"
          >
            分叉自 {forkSource.title} 第 {forkedFrom.messageIndex} 条
          </button>
        ) : (
          <div className="shrink-0 bg-white/5 px-4 py-1.5 text-xs text-white/40">
            分叉自 {forkedFrom.sourceTitle} 第 {forkedFrom.messageIndex} 条
          </div>
        ))}

      {isEmpty ? (
        <WelcomeState hasKey={hasKey} onOpenSettings={onOpenSettings} />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {active!.messages.map((m) => (
            <div key={m.id} data-message-id={m.id}>
              <MessageBubble message={m} />
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <ChatInput hasKey={hasKey} onOpenSettings={onOpenSettings} />
    </main>
  );
}
