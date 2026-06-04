import Store from 'electron-store';
import { type Conversation, type ChatMessage } from '../shared/types';
import { genId } from '../shared/id';
import { sortConversationsForDisplay } from '../shared/conversationUtils';

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
    (value.errorDetail === undefined || typeof value.errorDetail === 'string') &&
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
    isFiniteNumber(value.updatedAt) &&
    (value.pinned === undefined || typeof value.pinned === 'boolean') &&
    (value.archived === undefined || typeof value.archived === 'boolean')
  );
}

function repairMessage(value: unknown): { message?: ChatMessage; repaired: boolean } {
  if (isChatMessage(value)) {
    return { message: value, repaired: false };
  }

  if (!isRecord(value)) {
    return { repaired: true };
  }

  if (
    typeof value.id !== 'string' ||
    !isChatRole(value.role) ||
    typeof value.content !== 'string' ||
    !isFiniteNumber(value.createdAt)
  ) {
    return { repaired: true };
  }

  const message: ChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
  };
  let repaired = false;

  if (value.status !== undefined) {
    if (isMessageStatus(value.status)) {
      message.status = value.status;
    } else {
      repaired = true;
    }
  }
  if (value.aborted !== undefined) {
    if (typeof value.aborted === 'boolean') {
      message.aborted = value.aborted;
    } else {
      repaired = true;
    }
  }
  if (value.error !== undefined) {
    if (typeof value.error === 'string') {
      message.error = value.error;
    } else {
      repaired = true;
    }
  }
  if (value.errorDetail !== undefined) {
    if (typeof value.errorDetail === 'string') {
      message.errorDetail = value.errorDetail;
    } else {
      repaired = true;
    }
  }
  if (value.usage !== undefined) {
    if (isUsage(value.usage)) {
      message.usage = value.usage;
    } else {
      repaired = true;
    }
  }

  return { message, repaired };
}

function repairMessages(value: unknown): { messages: ChatMessage[]; repaired: boolean } {
  if (!Array.isArray(value)) {
    return { messages: [], repaired: true };
  }

  let repaired = false;
  const messages = value.reduce<ChatMessage[]>((acc, item) => {
    const result = repairMessage(item);

    if (!result.message) {
      repaired = true;
      return acc;
    }

    if (result.repaired) {
      repaired = true;
    }

    acc.push(result.message);
    return acc;
  }, []);

  return { messages, repaired };
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
  const conversation: Conversation = {
    id: value.id,
    title: value.title,
    messages,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  let conversationRepaired = repaired;

  if (value.pinned !== undefined) {
    if (typeof value.pinned === 'boolean') {
      conversation.pinned = value.pinned;
    } else {
      conversationRepaired = true;
    }
  }
  if (value.archived !== undefined) {
    if (typeof value.archived === 'boolean') {
      conversation.archived = value.archived;
    } else {
      conversationRepaired = true;
    }
  }

  return { conversation, repaired: conversationRepaired };
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
  return sortConversationsForDisplay(getConversations(), { includeArchived: true });
}

export function getConversation(id: string): Conversation | undefined {
  return getConversations().find((conversation) => conversation.id === id);
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

function updateConversationMetadata(
  id: string,
  patch: Pick<Conversation, 'pinned'> | Pick<Conversation, 'archived'>,
): Conversation {
  const conversations = getConversations();
  let updatedConversation: Conversation | undefined;
  const updatedAt = Date.now();

  const nextConversations = conversations.map((conversation) => {
    if (conversation.id !== id) {
      return conversation;
    }

    updatedConversation = { ...conversation, ...patch, updatedAt };
    return updatedConversation;
  });

  if (!updatedConversation) {
    throw new Error(`Conversation not found: ${id}`);
  }

  store.set('conversations', nextConversations);
  return updatedConversation;
}

export function setConversationPinned(id: string, pinned: boolean): Conversation {
  return updateConversationMetadata(id, { pinned });
}

export function setConversationArchived(id: string, archived: boolean): Conversation {
  return updateConversationMetadata(id, { archived });
}
