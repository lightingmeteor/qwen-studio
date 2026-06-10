import { create } from 'zustand';
import {
  type AppSettings,
  type ChatStreamRequest,
  type Conversation,
  type ChatMessage,
  type ChatRole,
  type ToolEvent,
  type ExportResult,
  type Usage,
} from '../../shared/types';
import { genId } from '../../shared/id';
import { deriveTitle } from '../../shared/title';
import { useSettingsStore } from './settingsStore';

// Routes streaming events (keyed by requestId) to the right conversation/message.
const routing = new Map<string, { conversationId: string; messageId: string }>();
// Requests sent with previous_response_id; eligible for a single full-history fallback retry.
const requestsWithPreviousResponseId = new Set<string>();
const CHAT_BRIDGE_UNSUBSCRIBERS_KEY = '__qwenStudioChatBridgeUnsubscribers' as const;

type ChatBridgeGlobal = typeof globalThis & {
  [CHAT_BRIDGE_UNSUBSCRIBERS_KEY]?: Array<() => void>;
};

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  streamingByConversation: Record<string, string>;

  loadConversations: () => Promise<void>;
  newConversation: () => Promise<void>;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  setConversationPinned: (id: string, pinned: boolean) => Promise<void>;
  setConversationArchived: (id: string, archived: boolean) => Promise<void>;
  exportActiveConversationMarkdown: () => Promise<ExportResult | undefined>;
  exportAllConversationsJson: () => Promise<ExportResult>;

  sendMessage: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  editAndResend: (messageId: string, text: string) => Promise<void>;
  fork: (messageId: string) => Promise<void>;
  forkAndResend: (messageId: string, text: string) => Promise<void>;

  // Internal mutations driven by IPC events:
  appendDelta: (conversationId: string, messageId: string, text: string) => void;
  setUsage: (conversationId: string, messageId: string, usage: Usage) => void;
  setProviderResponseId: (
    conversationId: string,
    messageId: string,
    responseId: string,
  ) => void;
  appendToolEvent: (conversationId: string, messageId: string, event: ToolEvent) => void;
  finishMessage: (
    requestId: string,
    conversationId: string,
    messageId: string,
    aborted?: boolean,
  ) => void;
  failMessage: (
    requestId: string,
    conversationId: string,
    messageId: string,
    message: string,
    detail?: string,
  ) => void;
  retryWithoutPreviousResponseId: (conversationId: string, messageId: string) => Promise<void>;
}

function updateMessages(
  conversations: Conversation[],
  conversationId: string,
  fn: (msgs: ChatMessage[]) => ChatMessage[],
): Conversation[] {
  return conversations.map((c) =>
    c.id === conversationId ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c,
  );
}

function findConversation(conversations: Conversation[], id: string | null): Conversation | undefined {
  return conversations.find((c) => c.id === id);
}

function firstNonArchivedConversationId(conversations: Conversation[]): string | null {
  return conversations.find((c) => !c.archived)?.id ?? null;
}

function resolveLoadedActiveId(
  conversations: Conversation[],
  activeId: string | null,
): string | null {
  if (activeId && findConversation(conversations, activeId)) return activeId;
  return firstNonArchivedConversationId(conversations);
}

function persist(conversationId: string, conversations: Conversation[]): void {
  const conv = findConversation(conversations, conversationId);
  if (conv) void window.qwen.saveMessages(conversationId, conv.messages).catch(console.error);
}

function routesForConversation(
  conversationId: string,
): Array<[string, { conversationId: string; messageId: string }]> {
  return [...routing.entries()].filter(([, route]) => route.conversationId === conversationId);
}

function abortAndDeleteRoutes(conversationId: string): string[] {
  const requestIds = routesForConversation(conversationId).map(([requestId]) => requestId);
  for (const requestId of requestIds) {
    void window.qwen.abortChat(requestId).catch(console.error);
    routing.delete(requestId);
    requestsWithPreviousResponseId.delete(requestId);
  }
  return requestIds;
}

function latestContiguousResponseId(conversation: Conversation | undefined): string | undefined {
  const lastVisibleMessage = conversation?.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .at(-1);

  if (
    lastVisibleMessage?.role === 'assistant' &&
    lastVisibleMessage.provider === 'responses' &&
    lastVisibleMessage.providerResponseId
  ) {
    return lastVisibleMessage.providerResponseId;
  }

  return undefined;
}

async function abortConversationStream(
  conversationId: string,
  streamingByConversation: Record<string, string>,
): Promise<string[]> {
  const requestId = streamingByConversation[conversationId];
  const requestIds = requestId ? [requestId] : [];

  await Promise.all(requestIds.map((requestId) => window.qwen.abortChat(requestId)));
  return requestIds;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function conversationHistory(
  conversation: Conversation | undefined,
  excludeMessageId: string,
): { role: ChatRole; content: string }[] {
  return (conversation?.messages ?? [])
    .filter((m) => m.id !== excludeMessageId && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role as ChatRole, content: m.content }));
}

function withSystemPrompt(
  systemPrompt: string,
  messages: { role: ChatRole; content: string }[],
): { role: ChatRole; content: string }[] {
  return systemPrompt
    ? [{ role: 'system' as ChatRole, content: systemPrompt }, ...messages]
    : messages;
}

// 唯一的请求载荷拼装点：sendMessage 与 previous_response_id 失效回退共用，避免两边悄悄分叉。
function buildStreamPayload(
  settings: AppSettings,
  requestId: string,
  conversationId: string,
  messages: { role: ChatRole; content: string }[],
  previousResponseId?: string,
): ChatStreamRequest {
  return {
    requestId,
    conversationId,
    model: settings.model,
    temperature: settings.temperature,
    messages,
    ...(settings.apiMode === 'responses'
      ? {
          apiMode: settings.apiMode,
          ...(settings.webSearchEnabled ? { tools: ['web_search' as const] } : {}),
          ...(previousResponseId ? { previousResponseId } : {}),
        }
      : {}),
  };
}

function replaceBridgeUnsubscribers(unsubscribers: Array<() => void>): void {
  (globalThis as ChatBridgeGlobal)[CHAT_BRIDGE_UNSUBSCRIBERS_KEY] = unsubscribers;
}

function clearBridgeListeners(): void {
  const chatBridgeGlobal = globalThis as ChatBridgeGlobal;
  const unsubscribers = chatBridgeGlobal[CHAT_BRIDGE_UNSUBSCRIBERS_KEY] ?? [];
  chatBridgeGlobal[CHAT_BRIDGE_UNSUBSCRIBERS_KEY] = [];

  for (const unsubscribe of unsubscribers) {
    try {
      unsubscribe();
    } catch (error) {
      console.error(error);
    }
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  streamingByConversation: {},

  loadConversations: async () => {
    const conversations = await window.qwen.listConversations();
    set({
      conversations,
      activeId: resolveLoadedActiveId(conversations, get().activeId),
    });
  },

  newConversation: async () => {
    const conv = await window.qwen.createConversation();
    set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }));
  },

  selectConversation: (id) => set({ activeId: id }),

  renameConversation: async (id, title) => {
    await window.qwen.renameConversation(id, title);
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
  },

  deleteConversation: async (id) => {
    const requestIds = abortAndDeleteRoutes(id);
    await window.qwen.deleteConversation(id);
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const activeId =
        s.activeId === id ? firstNonArchivedConversationId(conversations) : s.activeId;
      const streamingByConversation = { ...s.streamingByConversation };
      if (requestIds.length > 0 || streamingByConversation[id]) {
        delete streamingByConversation[id];
      }
      return { conversations, activeId, streamingByConversation };
    });
  },

  setConversationPinned: async (id, pinned) => {
    const conversation = await window.qwen.setConversationPinned(id, pinned);
    set((s) => ({
      conversations: s.conversations.map((item) =>
        item.id === id
          ? conversation
            ? { ...conversation, pinned: conversation.pinned ?? pinned }
            : { ...item, pinned }
          : item,
      ),
    }));
  },

  setConversationArchived: async (id, archived) => {
    const requestIds = await abortConversationStream(id, get().streamingByConversation);
    if (requestIds.length > 0 || get().streamingByConversation[id]) {
      set((s) => {
        const streamingByConversation = { ...s.streamingByConversation };
        delete streamingByConversation[id];
        return { streamingByConversation };
      });
    }

    const conversation = await window.qwen.setConversationArchived(id, archived);
    set((s) => {
      const conversations = s.conversations.map((item) =>
        item.id === id
          ? conversation
            ? { ...conversation, archived: conversation.archived ?? archived }
            : { ...item, archived }
          : item,
      );
      const activeId =
        s.activeId === id && archived
          ? conversations.find((item) => !item.archived)?.id ?? null
          : s.activeId;
      return { conversations, activeId };
    });
  },

  exportActiveConversationMarkdown: async () => {
    const conversationId = get().activeId;
    if (!conversationId) return undefined;
    return window.qwen.exportConversationMarkdown(conversationId);
  },

  exportAllConversationsJson: async () => window.qwen.exportConversationsJson(),

  sendMessage: async (text) => {
    const activeConversationId = get().activeId;
    if (activeConversationId && get().streamingByConversation[activeConversationId]) return;

    const content = text.trim();
    if (!content) return;
    if (!useSettingsStore.getState().hasKey) return;

    let conversationId = get().activeId;
    if (!conversationId) {
      const conv = await window.qwen.createConversation();
      set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }));
      conversationId = conv.id;
    }

    const { settings } = useSettingsStore.getState();
    const existingConversation = findConversation(get().conversations, conversationId);
    const previousResponseId = latestContiguousResponseId(existingConversation);
    const now = Date.now();
    const userMsg: ChatMessage = { id: genId('m'), role: 'user', content, createdAt: now, status: 'done' };
    const assistantMsg: ChatMessage = {
      id: genId('m'),
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      status: 'streaming',
      provider: settings.apiMode,
    };

    // Append both messages, and auto-title the conversation from the first user message.
    set((s) => {
      const conv = findConversation(s.conversations, conversationId);
      const isFirst = !!conv && conv.messages.length === 0;
      let conversations = updateMessages(s.conversations, conversationId!, (m) => [
        ...m,
        userMsg,
        assistantMsg,
      ]);
      if (isFirst) {
        const title = deriveTitle(content);
        conversations = conversations.map((c) => (c.id === conversationId ? { ...c, title } : c));
        void window.qwen.renameConversation(conversationId!, title);
      }
      return { conversations };
    });
    persist(conversationId, get().conversations);

    const requestId = genId('req');
    routing.set(requestId, { conversationId, messageId: assistantMsg.id });
    if (settings.apiMode === 'responses' && previousResponseId) {
      requestsWithPreviousResponseId.add(requestId);
    }
    set((s) => ({
      streamingByConversation: { ...s.streamingByConversation, [conversationId]: requestId },
    }));

    const conv = findConversation(get().conversations, conversationId);
    const messages = withSystemPrompt(
      settings.systemPrompt,
      settings.apiMode === 'responses' && previousResponseId
        ? [{ role: 'user' as ChatRole, content }]
        : conversationHistory(conv, assistantMsg.id),
    );

    try {
      await window.qwen.chatStream(
        buildStreamPayload(settings, requestId, conversationId, messages, previousResponseId),
      );
    } catch (error) {
      if (routing.delete(requestId)) {
        get().failMessage(requestId, conversationId, assistantMsg.id, errorMessage(error));
      }
    }
  },

  abort: async () => {
    const { activeId, streamingByConversation } = get();
    const requestId = activeId ? streamingByConversation[activeId] : undefined;
    if (requestId) await window.qwen.abortChat(requestId);
  },

  regenerate: async (messageId) => {
    const conversationId = get().activeId;
    if (!conversationId) return;
    if (get().streamingByConversation[conversationId]) return;

    const conv = findConversation(get().conversations, conversationId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    // Find the user message preceding this assistant message.
    let userIdx = idx;
    while (userIdx >= 0 && conv.messages[userIdx].role !== 'user') userIdx -= 1;
    if (userIdx < 0) return;
    const userText = conv.messages[userIdx].content;
    // Drop everything from the user message onward, then re-send it.
    const trimmed = conv.messages.slice(0, userIdx);
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, () => trimmed),
    }));
    persist(conversationId, get().conversations);
    await get().sendMessage(userText);
  },

  deleteMessage: async (messageId) => {
    const conversationId = get().activeId;
    if (!conversationId) return;
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.filter((x) => x.id !== messageId),
      ),
    }));
    persist(conversationId, get().conversations);
  },

  fork: async (messageId) => {
    const conversationId = get().activeId;
    if (!conversationId) return;

    const forked = await window.qwen.forkConversation(conversationId, messageId);
    set((s) => ({ conversations: [forked, ...s.conversations], activeId: forked.id }));
  },

  forkAndResend: async (messageId, text) => {
    const conversationId = get().activeId;
    if (!conversationId) return;
    if (get().streamingByConversation[conversationId]) return;

    const content = text.trim();
    if (!content) return;
    if (!useSettingsStore.getState().hasKey) return;

    const conv = findConversation(get().conversations, conversationId);
    const edited = conv?.messages.find((message) => message.id === messageId);
    if (!edited || edited.role !== 'user') return;

    // 分叉出不含被编辑消息的前缀，切换过去后用现有 send 流程发送编辑后的文本。
    const forked = await window.qwen.forkConversation(conversationId, messageId, {
      exclusive: true,
    });
    set((s) => ({ conversations: [forked, ...s.conversations], activeId: forked.id }));
    await get().sendMessage(content);
  },

  editAndResend: async (messageId, text) => {
    const conversationId = get().activeId;
    if (!conversationId) return;
    if (get().streamingByConversation[conversationId]) return;

    const content = text.trim();
    if (!content) return;
    if (!useSettingsStore.getState().hasKey) return;

    const conv = findConversation(get().conversations, conversationId);
    if (!conv) return;

    const messageIndex = conv.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) return;
    if (conv.messages[messageIndex].role !== 'user') return;

    const trimmed = conv.messages.slice(0, messageIndex);
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, () => trimmed),
    }));
    persist(conversationId, get().conversations);
    await get().sendMessage(content);
  },

  appendDelta: (conversationId, messageId, text) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) => (x.id === messageId ? { ...x, content: x.content + text } : x)),
      ),
    }));
  },

  setUsage: (conversationId, messageId, usage) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) => (x.id === messageId ? { ...x, usage } : x)),
      ),
    }));
  },

  setProviderResponseId: (conversationId, messageId, responseId) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) => (x.id === messageId ? { ...x, providerResponseId: responseId } : x)),
      ),
    }));
    persist(conversationId, get().conversations);
  },

  appendToolEvent: (conversationId, messageId, event) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) =>
          x.id === messageId ? { ...x, toolEvents: [...(x.toolEvents ?? []), event] } : x,
        ),
      ),
    }));
    persist(conversationId, get().conversations);
  },

  finishMessage: (requestId, conversationId, messageId, aborted) => {
    requestsWithPreviousResponseId.delete(requestId);
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) =>
          x.id === messageId ? { ...x, status: 'done', aborted: aborted ?? false } : x,
        ),
      ),
      streamingByConversation:
        s.streamingByConversation[conversationId] === requestId
          ? Object.fromEntries(
              Object.entries(s.streamingByConversation).filter(([id]) => id !== conversationId),
            )
          : s.streamingByConversation,
    }));
    persist(conversationId, get().conversations);
  },

  failMessage: (requestId, conversationId, messageId, message, detail) => {
    requestsWithPreviousResponseId.delete(requestId);
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) =>
          x.id === messageId
            ? {
                ...x,
                status: 'error',
                error: message,
                errorDetail: detail,
                content: x.content || '',
              }
            : x,
        ),
      ),
      streamingByConversation:
        s.streamingByConversation[conversationId] === requestId
          ? Object.fromEntries(
              Object.entries(s.streamingByConversation).filter(([id]) => id !== conversationId),
            )
          : s.streamingByConversation,
    }));
    persist(conversationId, get().conversations);
  },

  // previous_response_id 失效后的单次回退：清空占位消息，改为全量历史重发（不带 id）。
  retryWithoutPreviousResponseId: async (conversationId, messageId) => {
    const { settings } = useSettingsStore.getState();

    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) => (x.id === messageId ? { ...x, content: '' } : x)),
      ),
    }));

    const requestId = genId('req');
    routing.set(requestId, { conversationId, messageId });
    set((s) => ({
      streamingByConversation: { ...s.streamingByConversation, [conversationId]: requestId },
    }));

    const conv = findConversation(get().conversations, conversationId);
    const messages = withSystemPrompt(
      settings.systemPrompt,
      conversationHistory(conv, messageId),
    );

    try {
      await window.qwen.chatStream(
        buildStreamPayload(settings, requestId, conversationId, messages),
      );
    } catch (error) {
      if (routing.delete(requestId)) {
        get().failMessage(requestId, conversationId, messageId, errorMessage(error));
      }
    }
  },
}));

/** Wire IPC stream events to the store. Call once at app startup. */
export function initChatBridge(): void {
  clearBridgeListeners();

  replaceBridgeUnsubscribers([
    window.qwen.onChatDelta((e) => {
      const r = routing.get(e.requestId);
      if (r) useChatStore.getState().appendDelta(r.conversationId, r.messageId, e.text);
    }),
    window.qwen.onChatUsage((e) => {
      const r = routing.get(e.requestId);
      if (r) useChatStore.getState().setUsage(r.conversationId, r.messageId, e.usage);
    }),
    window.qwen.onChatResponse((e) => {
      const r = routing.get(e.requestId);
      if (r) {
        useChatStore
          .getState()
          .setProviderResponseId(r.conversationId, r.messageId, e.responseId);
      }
    }),
    window.qwen.onChatTool((e) => {
      const r = routing.get(e.requestId);
      if (r) useChatStore.getState().appendToolEvent(r.conversationId, r.messageId, e.event);
    }),
    window.qwen.onChatDone((e) => {
      const r = routing.get(e.requestId);
      if (r) {
        useChatStore.getState().finishMessage(e.requestId, r.conversationId, r.messageId, e.aborted);
        routing.delete(e.requestId);
      }
    }),
    window.qwen.onChatError((e) => {
      const r = routing.get(e.requestId);
      if (r) {
        routing.delete(e.requestId);
        if (
          e.code === 'previous_response_invalid' &&
          requestsWithPreviousResponseId.delete(e.requestId)
        ) {
          // 回退请求不带 previous_response_id，再失败时走普通失败路径，不会循环重试。
          void useChatStore
            .getState()
            .retryWithoutPreviousResponseId(r.conversationId, r.messageId);
          return;
        }
        useChatStore
          .getState()
          .failMessage(e.requestId, r.conversationId, r.messageId, e.message, e.detail);
      }
    }),
  ]);
}
