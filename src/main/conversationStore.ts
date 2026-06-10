import Store from 'electron-store';
import {
  type ApiMode,
  type BuiltInTool,
  type Conversation,
  type ChatMessage,
  type ForkOrigin,
  type ToolEvent,
} from '../shared/types';
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
const API_MODES = ['chat_completions', 'responses'] as const;
const BUILT_IN_TOOLS = ['web_search'] as const;
const TOOL_STATUSES = ['started', 'completed', 'failed'] as const;

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

function isApiMode(value: unknown): value is ApiMode {
  return typeof value === 'string' && API_MODES.includes(value as ApiMode);
}

function isBuiltInTool(value: unknown): value is BuiltInTool {
  return typeof value === 'string' && BUILT_IN_TOOLS.includes(value as BuiltInTool);
}

function isToolStatus(value: unknown): value is ToolEvent['status'] {
  return typeof value === 'string' && TOOL_STATUSES.includes(value as ToolEvent['status']);
}

function isUsage(value: unknown): value is NonNullable<ChatMessage['usage']> {
  return (
    isRecord(value) &&
    isFiniteNumber(value.promptTokens) &&
    isFiniteNumber(value.completionTokens) &&
    isFiniteNumber(value.totalTokens)
  );
}

function isToolEvent(value: unknown): value is ToolEvent {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isBuiltInTool(value.type) &&
    isToolStatus(value.status) &&
    typeof value.title === 'string' &&
    (value.detail === undefined || typeof value.detail === 'string')
  );
}

function isToolEvents(value: unknown): value is ToolEvent[] {
  return Array.isArray(value) && value.every(isToolEvent);
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
    (value.usage === undefined || isUsage(value.usage)) &&
    (value.provider === undefined || isApiMode(value.provider)) &&
    (value.providerResponseId === undefined || typeof value.providerResponseId === 'string') &&
    (value.toolEvents === undefined || isToolEvents(value.toolEvents))
  );
}

function isForkOrigin(value: unknown): value is ForkOrigin {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    typeof value.messageId === 'string' &&
    typeof value.sourceTitle === 'string' &&
    isFiniteNumber(value.messageIndex)
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
    (value.archived === undefined || typeof value.archived === 'boolean') &&
    (value.forkedFrom === undefined || isForkOrigin(value.forkedFrom))
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
  if (value.provider !== undefined) {
    if (isApiMode(value.provider)) {
      message.provider = value.provider;
    } else {
      repaired = true;
    }
  }
  if (value.providerResponseId !== undefined) {
    if (typeof value.providerResponseId === 'string') {
      message.providerResponseId = value.providerResponseId;
    } else {
      repaired = true;
    }
  }
  if (value.toolEvents !== undefined) {
    if (Array.isArray(value.toolEvents)) {
      const toolEvents = value.toolEvents.filter(isToolEvent);
      if (toolEvents.length > 0) {
        message.toolEvents = toolEvents;
      }
      if (toolEvents.length !== value.toolEvents.length) {
        repaired = true;
      }
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
  if (value.forkedFrom !== undefined) {
    if (isForkOrigin(value.forkedFrom)) {
      conversation.forkedFrom = value.forkedFrom;
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

export interface ForkConversationOptions {
  /** true 时只复制分叉点之前的消息（不含分叉点），用于"分叉后编辑"。 */
  exclusive?: boolean;
}

export function forkConversation(
  sourceId: string,
  messageId: string,
  opts: ForkConversationOptions = {},
): Conversation {
  const conversations = getConversations();
  const source = conversations.find((c) => c.id === sourceId);
  if (!source) {
    throw new Error(`Conversation not found: ${sourceId}`);
  }

  const forkIndex = source.messages.findIndex((m) => m.id === messageId);
  if (forkIndex < 0) {
    throw new Error(`Message not found: ${messageId}`);
  }

  const forkPoint = source.messages[forkIndex];
  if (forkPoint.role !== 'user' && forkPoint.role !== 'assistant') {
    throw new Error(`Fork point must be a user or assistant message: ${messageId}`);
  }
  if (forkPoint.status !== 'done') {
    throw new Error(`Fork point message must be done: ${messageId}`);
  }

  // 1-based 序号快照，按 user/assistant 可见消息计，供分叉来源横幅"第 N 条"展示。
  const messageIndex = source.messages
    .slice(0, forkIndex + 1)
    .filter((m) => m.role === 'user' || m.role === 'assistant').length;

  const copied = structuredClone(
    source.messages.slice(0, opts.exclusive ? forkIndex : forkIndex + 1),
  );
  const now = Date.now();
  const forked: Conversation = {
    id: genId('c'),
    title: `${source.title}（分叉）`,
    messages: copied,
    createdAt: now,
    updatedAt: now,
    forkedFrom: {
      conversationId: source.id,
      messageId: forkPoint.id,
      sourceTitle: source.title,
      messageIndex,
    },
  };
  store.set('conversations', [forked, ...conversations]);
  return forked;
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
