import { useRef, useState, type KeyboardEvent } from 'react';
import { useChatStore } from '../store/chatStore';

export default function ChatInput(): JSX.Element {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abort = useChatStore((s) => s.abort);
  const streaming = useChatStore((s) => s.streamingRequestId !== null);

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const submit = async () => {
    const value = text;
    if (!value.trim() || streaming) return;
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
    await sendMessage(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && streaming) {
      e.preventDefault();
      void abort();
    }
  };

  return (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-end gap-2 bg-white/5 rounded-xl border border-white/10 p-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autosize();
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="给 Qwen 发消息…（Cmd/Ctrl + Enter 发送，Esc 停止）"
          className="flex-1 resize-none bg-transparent outline-none px-2 py-1 text-sm max-h-[200px]"
        />
        {text && (
          <button
            onClick={() => setText('')}
            className="text-xs text-white/50 hover:text-white/80 px-2"
            title="清空"
          >
            清空
          </button>
        )}
        {streaming ? (
          <button
            onClick={() => void abort()}
            className="px-3 py-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-sm"
          >
            停止
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={!text.trim()}
            className="px-3 py-1.5 rounded-lg bg-sky-500/90 hover:bg-sky-500 disabled:opacity-40 text-sm"
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
