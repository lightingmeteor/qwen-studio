import { useMemo, useState } from 'react';
import { filterConversations } from '../../shared/conversationUtils';
import { useChatStore } from '../store/chatStore';

type SidebarFilter = 'all' | 'pinned' | 'archived';

const FILTERS: Array<{ value: SidebarFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'pinned', label: '置顶' },
  { value: 'archived', label: '归档' },
];

export default function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const {
    conversations,
    activeId,
    newConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    setConversationPinned,
    setConversationArchived,
  } = useChatStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SidebarFilter>('all');
  const visibleConversations = useMemo(
    () => filterConversations(conversations, { filter, query }),
    [conversations, filter, query],
  );

  const emptyText = query.trim()
    ? '没有匹配的会话。'
    : filter === 'pinned'
      ? '还没有置顶会话。'
      : filter === 'archived'
        ? '归档里还没有会话。'
        : '还没有会话，点上面新建一个。';

  return (
    <aside className="w-64 shrink-0 border-r border-white/10 flex flex-col bg-black/20">
      <div className="p-3 space-y-2">
        <button
          onClick={() => void newConversation()}
          className="w-full rounded-lg bg-white/10 hover:bg-white/15 py-2 text-sm"
        >
          ＋ 新建聊天
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索会话"
          className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 placeholder:text-white/30 outline-none focus:border-sky-400/50"
        />
        <div className="grid grid-cols-3 rounded-md border border-white/10 bg-white/5 p-0.5">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              onClick={() => setFilter(item.value)}
              className={`rounded px-2 py-1 text-xs ${
                filter === item.value
                  ? 'bg-white/15 text-white'
                  : 'text-white/50 hover:bg-white/10 hover:text-white/80'
              }`}
              title={item.label}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {visibleConversations.map((c) => (
          <div
            key={c.id}
            onClick={() => selectConversation(c.id)}
            className={`group flex min-w-0 items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer ${
              c.id === activeId ? 'bg-white/15' : 'hover:bg-white/5'
            }`}
          >
            <span className="min-w-0 truncate flex-1">
              {c.pinned && !c.archived ? <span className="mr-1 text-white/40">★</span> : null}
              {c.title}
            </span>
            <span className="hidden group-hover:flex gap-1 ml-2 shrink-0">
              {!c.archived && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void setConversationPinned(c.id, !c.pinned);
                  }}
                  className="w-5 text-white/40 hover:text-amber-200"
                  title={c.pinned ? '取消置顶' : '置顶'}
                >
                  {c.pinned ? '☆' : '★'}
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void setConversationArchived(c.id, !c.archived);
                }}
                className="w-5 text-white/40 hover:text-white/80"
                title={c.archived ? '恢复' : '归档'}
              >
                {c.archived ? '↩' : '收'}
              </button>
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
                删
              </button>
            </span>
          </div>
        ))}
        {visibleConversations.length === 0 && (
          <div className="text-xs text-white/30 px-3 py-4">{emptyText}</div>
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
