import { create } from 'zustand';
import {
  type Conversation,
  type ChatMessage,
  type ChatRole,
  type Usage,
} from '../../shared/types';
import { genId } from '../../shared/id';
import { deriveTitle } from '../../shared/title';
import { useSettingsStore } from './settingsStore';

// Routes streaming events (keyed by requestId) to the right conversation/message.
const routing = new Map<string, { conversationId: string; messageId: string }>();
let bridgeInitialized = false;
const bridgeUnsubscribers: Array<() => void> = [];

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  streamingRequestId: string | null;

  loadConversations: () => Promise<void>;
  newConversation: () => Promise<void>;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  sendMessage: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;

  // Internal mutations driven by IPC events:
  appendDelta: (conversationId: string, messageId: string, text: string) => void;
  setUsage: (conversationId: string, messageId: string, usage: Usage) => void;
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
  ) => void;
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
  }
  return requestIds;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  streamingRequestId: null,

  loadConversations: async () => {
    const conversations = await window.qwen.listConversations();
    set({
      conversations,
      activeId: get().activeId ?? conversations[0]?.id ?? null,
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
      const activeId = s.activeId === id ? conversations[0]?.id ?? null : s.activeId;
      const streamingRequestId = requestIds.includes(s.streamingRequestId ?? '')
        ? null
        : s.streamingRequestId;
      return { conversations, activeId, streamingRequestId };
    });
  },

  sendMessage: async (text) => {
    if (get().streamingRequestId) return;

    const content = text.trim();
    if (!content) return;

    let conversationId = get().activeId;
    if (!conversationId) {
      const conv = await window.qwen.createConversation();
      set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }));
      conversationId = conv.id;
    }

    const { settings } = useSettingsStore.getState();
    const now = Date.now();
    const userMsg: ChatMessage = { id: genId('m'), role: 'user', content, createdAt: now, status: 'done' };
    const assistantMsg: ChatMessage = {
      id: genId('m'),
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      status: 'streaming',
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
    set({ streamingRequestId: requestId });

    const conv = findConversation(get().conversations, conversationId);
    const history = (conv?.messages ?? [])
      .filter((m) => m.id !== assistantMsg.id && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role as ChatRole, content: m.content }));

    const messages = [
      ...(settings.systemPrompt
        ? [{ role: 'system' as ChatRole, content: settings.systemPrompt }]
        : []),
      ...history,
    ];

    try {
      await window.qwen.chatStream({
        requestId,
        conversationId,
        model: settings.model,
        temperature: settings.temperature,
        messages,
      });
    } catch (error) {
      if (routing.delete(requestId)) {
        get().failMessage(requestId, conversationId, assistantMsg.id, errorMessage(error));
      }
    }
  },

  abort: async () => {
    const requestId = get().streamingRequestId;
    if (requestId) await window.qwen.abortChat(requestId);
  },

  regenerate: async (messageId) => {
    if (get().streamingRequestId) return;

    const conversationId = get().activeId;
    if (!conversationId) return;
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

  finishMessage: (requestId, conversationId, messageId, aborted) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) =>
          x.id === messageId ? { ...x, status: 'done', aborted: aborted ?? false } : x,
        ),
      ),
      streamingRequestId: s.streamingRequestId === requestId ? null : s.streamingRequestId,
    }));
    persist(conversationId, get().conversations);
  },

  failMessage: (requestId, conversationId, messageId, message) => {
    set((s) => ({
      conversations: updateMessages(s.conversations, conversationId, (m) =>
        m.map((x) =>
          x.id === messageId
            ? { ...x, status: 'error', error: message, content: x.content || '' }
            : x,
        ),
      ),
      streamingRequestId: s.streamingRequestId === requestId ? null : s.streamingRequestId,
    }));
    persist(conversationId, get().conversations);
  },
}));

/** Wire IPC stream events to the store. Call once at app startup. */
export function initChatBridge(): void {
  if (bridgeInitialized) return;
  bridgeInitialized = true;

  bridgeUnsubscribers.push(
    window.qwen.onChatDelta((e) => {
      const r = routing.get(e.requestId);
      if (r) useChatStore.getState().appendDelta(r.conversationId, r.messageId, e.text);
    }),
    window.qwen.onChatUsage((e) => {
      const r = routing.get(e.requestId);
      if (r) useChatStore.getState().setUsage(r.conversationId, r.messageId, e.usage);
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
        useChatStore.getState().failMessage(e.requestId, r.conversationId, r.messageId, e.message);
        routing.delete(e.requestId);
      }
    }),
  );
}
