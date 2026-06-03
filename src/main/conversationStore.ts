import Store from 'electron-store';
import { type Conversation, type ChatMessage } from '../shared/types';
import { genId } from '../shared/id';

interface Persisted {
  conversations: Conversation[];
}

const store = new Store<Persisted>({
  name: 'qwen-studio-conversations',
  defaults: { conversations: [] },
});

export function listConversations(): Conversation[] {
  return [...store.get('conversations')].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createConversation(title = '新会话'): Conversation {
  const now = Date.now();
  const conv: Conversation = {
    id: genId('c'),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  store.set('conversations', [conv, ...store.get('conversations')]);
  return conv;
}

export function renameConversation(id: string, title: string): void {
  store.set(
    'conversations',
    store.get('conversations').map((c) =>
      c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
    ),
  );
}

export function deleteConversation(id: string): void {
  store.set(
    'conversations',
    store.get('conversations').filter((c) => c.id !== id),
  );
}

export function saveMessages(id: string, messages: ChatMessage[]): void {
  store.set(
    'conversations',
    store.get('conversations').map((c) =>
      c.id === id ? { ...c, messages, updatedAt: Date.now() } : c,
    ),
  );
}
