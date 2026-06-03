import { useEffect, useRef } from 'react';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../store/settingsStore';
import MessageBubble from '../components/MessageBubble';
import ChatInput from '../components/ChatInput';
import ModelSelect from '../components/ModelSelect';
import WelcomeState from '../components/WelcomeState';

export default function ChatPage({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const hasKey = useSettingsStore((s) => s.hasKey);
  const active = conversations.find((c) => c.id === activeId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages]);

  const isEmpty = !active || active.messages.length === 0;

  return (
    <main className="flex-1 flex flex-col min-w-0">
      <header className="h-12 shrink-0 border-b border-white/10 flex items-center justify-between px-4">
        <div className="text-sm text-white/60 truncate">{active?.title ?? 'Qwen Studio'}</div>
        <div className="flex items-center gap-3">
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

      {isEmpty ? (
        <WelcomeState hasKey={hasKey} onOpenSettings={onOpenSettings} />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {active!.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <ChatInput hasKey={hasKey} onOpenSettings={onOpenSettings} />
    </main>
  );
}
