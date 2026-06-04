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

const CHAT_ROLES = ['system', 'user', 'assistant'] as const;
const MESSAGE_STATUSES = ['pending', 'streaming', 'done', 'error'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isChatRole(value: unknown): value is ChatMessage['role'] {
  return typeof value === 'string' && CHAT_ROLES.includes(value as ChatMessage['role']);
}

function isMessageStatus(value: unknown): value is NonNullable<ChatMessage['status']> {
  return (
    typeof value === 'string' &&
    MESSAGE_STATUSES.includes(value as NonNullable<ChatMessage['status']>)
  );
}

function isUsage(value: unknown): value is NonNullable<ChatMessage['usage']> {
  return (
    isRecord(value) &&
    isFiniteNumber(value.promptTokens) &&
    isFiniteNumber(value.completionTokens) &&
    isFiniteNumber(value.totalTokens)
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    isChatRole(value.role) &&
    typeof value.content === 'string' &&
    isFiniteNumber(value.createdAt) &&
    (value.status === undefined || isMessageStatus(value.status)) &&
    (value.aborted === undefined || typeof value.aborted === 'boolean') &&
    (value.error === undefined || typeof value.error === 'string') &&
    (value.usage === undefined || isUsage(value.usage))
  );
}

function isConversation(value: unknown): value is Conversation {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every(isChatMessage) &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt)
  );
}

function repairMessages(value: unknown): { messages: ChatMessage[]; repaired: boolean } {
  if (!Array.isArray(value)) {
    return { messages: [], repaired: true };
  }

  const messages = value.filter(isChatMessage);
  return { messages, repaired: messages.length !== value.length };
}

function repairConversation(value: unknown): { conversation?: Conversation; repaired: boolean } {
  if (isConversation(value)) {
    return { conversation: value, repaired: false };
  }

  if (!isRecord(value)) {
    return { repaired: true };
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt)
  ) {
    return { repaired: true };
  }

  const { messages, repaired } = repairMessages(value.messages);
  return {
    conversation: {
      id: value.id,
      title: value.title,
      messages,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    },
    repaired,
  };
}

function getConversations(): Conversation[] {
  const persisted = store.get('conversations') as unknown;

  if (!Array.isArray(persisted)) {
    store.set('conversations', []);
    return [];
  }

  let repaired = false;
  const conversations = persisted.reduce<Conversation[]>((acc, item) => {
    const result = repairConversation(item);

    if (!result.conversation) {
      repaired = true;
      return acc;
    }

    if (result.repaired) {
      repaired = true;
    }

    acc.push(result.conversation);
    return acc;
  }, []);

  if (repaired) {
    store.set('conversations', conversations);
  }

  return conversations;
}

export function listConversations(): Conversation[] {
  return [...getConversations()].sort((a, b) => b.updatedAt - a.updatedAt);
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
  store.set('conversations', [conv, ...getConversations()]);
  return conv;
}

export function renameConversation(id: string, title: string): void {
  store.set(
    'conversations',
    getConversations().map((c) =>
      c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
    ),
  );
}

export function deleteConversation(id: string): void {
  store.set(
    'conversations',
    getConversations().filter((c) => c.id !== id),
  );
}

export function saveMessages(id: string, messages: ChatMessage[]): void {
  store.set(
    'conversations',
    getConversations().map((c) =>
      c.id === id ? { ...c, messages, updatedAt: Date.now() } : c,
    ),
  );
}
