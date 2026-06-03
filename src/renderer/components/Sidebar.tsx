import { useChatStore } from '../store/chatStore';

export default function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const { conversations, activeId, newConversation, selectConversation, deleteConversation, renameConversation } =
    useChatStore();

  return (
    <aside className="w-64 shrink-0 border-r border-white/10 flex flex-col bg-black/20">
      <div className="p-3">
        <button
          onClick={() => void newConversation()}
          className="w-full rounded-lg bg-white/10 hover:bg-white/15 py-2 text-sm"
        >
          ＋ 新建聊天
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => selectConversation(c.id)}
            className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer ${
              c.id === activeId ? 'bg-white/15' : 'hover:bg-white/5'
            }`}
          >
            <span className="truncate flex-1">{c.title}</span>
            <span className="hidden group-hover:flex gap-2 ml-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const title = window.prompt('重命名会话', c.title);
                  if (title) void renameConversation(c.id, title);
                }}
                className="text-white/40 hover:text-white/80"
                title="重命名"
              >
                ✎
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('删除该会话？')) void deleteConversation(c.id);
                }}
                className="text-white/40 hover:text-red-300"
                title="删除"
              >
                🗑
              </button>
            </span>
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="text-xs text-white/30 px-3 py-4">还没有会话，点上面新建一个。</div>
        )}
      </div>

      <div className="p-3 border-t border-white/10">
        <button onClick={onOpenSettings} className="w-full text-left text-sm text-white/60 hover:text-white/90">
          ⚙ 设置
        </button>
      </div>
    </aside>
  );
}
