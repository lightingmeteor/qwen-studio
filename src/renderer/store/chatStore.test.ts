import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ChatErrorEvent, type Conversation } from '../../shared/types';
import type { QwenApi } from '../../shared/api';
import { useSettingsStore } from './settingsStore';
import { initChatBridge, useChatStore } from './chatStore';

function makeConversation(id: string, title = '新会话'): Conversation {
  const now = Date.now();
  return {
    id,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeStreamingConversation(id: string, messageId: string): Conversation {
  const conversation = makeConversation(id);
  return {
    ...conversation,
    messages: [
      {
        id: messageId,
        role: 'assistant',
        content: 'partial',
        createdAt: Date.now(),
        status: 'streaming',
      },
    ],
  };
}

function installFakeBridge(): {
  chatStreamCalls: unknown[];
  emitChatError: (event: ChatErrorEvent) => void;
} {
  let nextConversation = 1;
  const conversations: Conversation[] = [];
  const chatStreamCalls: unknown[] = [];
  const errorListeners: Array<(event: ChatErrorEvent) => void> = [];
  const subscribe = () => () => {};

  const qwen: QwenApi = {
    getSettings: async () => DEFAULT_SETTINGS,
    saveSettings: async () => {},
    hasApiKey: async () => true,
    testConnection: async () => ({
      ok: true,
      category: 'ok',
      message: 'Connection test succeeded.',
    }),
    listConversations: async () => conversations,
    createConversation: async (title?: string) => {
      const conversation = makeConversation(`c${nextConversation++}`, title);
      conversations.unshift(conversation);
      return conversation;
    },
    renameConversation: async () => {},
    deleteConversation: async () => {},
    saveMessages: async () => {},
    setConversationPinned: async (id: string, pinned: boolean) => {
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error(`Conversation not found: ${id}`);
      conversation.pinned = pinned;
      return conversation;
    },
    setConversationArchived: async (id: string, archived: boolean) => {
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error(`Conversation not found: ${id}`);
      conversation.archived = archived;
      return conversation;
    },
    exportConversationMarkdown: async () => ({ canceled: true }),
    exportConversationsJson: async () => ({ canceled: true }),
    chatStream: async (payload: unknown) => {
      chatStreamCalls.push(payload);
    },
    abortChat: async () => {},
    openExternal: async () => {},
    onChatDelta: subscribe,
    onChatUsage: subscribe,
    onChatDone: subscribe,
    onChatError: (cb) => {
      errorListeners.push(cb);
      return () => {
        const index = errorListeners.indexOf(cb);
        if (index >= 0) errorListeners.splice(index, 1);
      };
    },
  };

  Object.defineProperty(globalThis, 'window', {
    value: { qwen },
    configurable: true,
  });

  return {
    chatStreamCalls,
    emitChatError: (event) => errorListeners.forEach((listener) => listener(event)),
  };
}

describe('chatStore streaming routing', () => {
  beforeEach(() => {
    installFakeBridge();
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      hasKey: true,
      loaded: true,
    });
    useChatStore.setState({
      conversations: [],
      activeId: null,
      streamingByConversation: {},
    });
  });

  it('allows another conversation to send while the current conversation is streaming', async () => {
    const fake = installFakeBridge();

    await useChatStore.getState().sendMessage('first');
    expect(fake.chatStreamCalls).toHaveLength(1);

    await useChatStore.getState().newConversation();
    await useChatStore.getState().sendMessage('second');

    expect(fake.chatStreamCalls).toHaveLength(2);
  });

  it('clears only the matching conversation streaming state when a message finishes normally', () => {
    useChatStore.setState({
      conversations: [
        makeStreamingConversation('c1', 'm1'),
        makeStreamingConversation('c2', 'm2'),
      ],
      activeId: 'c1',
      streamingByConversation: { c1: 'req-1', c2: 'req-2' },
    });

    useChatStore.getState().finishMessage('req-1', 'c1', 'm1');

    expect(useChatStore.getState().streamingByConversation).toEqual({ c2: 'req-2' });
    expect(useChatStore.getState().conversations[0].messages[0]).toMatchObject({
      status: 'done',
      aborted: false,
    });
  });

  it('clears only the matching conversation streaming state when a message is aborted', () => {
    useChatStore.setState({
      conversations: [
        makeStreamingConversation('c1', 'm1'),
        makeStreamingConversation('c2', 'm2'),
      ],
      activeId: 'c1',
      streamingByConversation: { c1: 'req-1', c2: 'req-2' },
    });

    useChatStore.getState().finishMessage('req-1', 'c1', 'm1', true);

    expect(useChatStore.getState().streamingByConversation).toEqual({ c2: 'req-2' });
    expect(useChatStore.getState().conversations[0].messages[0]).toMatchObject({
      status: 'done',
      aborted: true,
    });
  });

  it('keeps streaming state when finishMessage receives a stale request id', () => {
    useChatStore.setState({
      conversations: [makeStreamingConversation('c1', 'm1')],
      activeId: 'c1',
      streamingByConversation: { c1: 'req-current' },
    });

    useChatStore.getState().finishMessage('req-stale', 'c1', 'm1');

    expect(useChatStore.getState().streamingByConversation).toEqual({ c1: 'req-current' });
  });

  it('clears only the matching conversation streaming state when a message fails', () => {
    useChatStore.setState({
      conversations: [
        makeStreamingConversation('c1', 'm1'),
        makeStreamingConversation('c2', 'm2'),
      ],
      activeId: 'c1',
      streamingByConversation: { c1: 'req-1', c2: 'req-2' },
    });

    useChatStore.getState().failMessage('req-1', 'c1', 'm1', 'stream failed');

    expect(useChatStore.getState().streamingByConversation).toEqual({ c2: 'req-2' });
    expect(useChatStore.getState().conversations[0].messages[0]).toMatchObject({
      status: 'error',
      error: 'stream failed',
    });
  });

  it('stores technical error detail when a message fails', () => {
    useChatStore.setState({
      conversations: [makeStreamingConversation('c1', 'm1')],
      activeId: 'c1',
      streamingByConversation: { c1: 'req-1' },
    });

    useChatStore
      .getState()
      .failMessage('req-1', 'c1', 'm1', 'Friendly failure', 'HTTP 500: upstream exploded');

    expect(useChatStore.getState().conversations[0].messages[0]).toMatchObject({
      status: 'error',
      error: 'Friendly failure',
      errorDetail: 'HTTP 500: upstream exploded',
    });
  });

  it('keeps streaming state when failMessage receives a stale request id', () => {
    useChatStore.setState({
      conversations: [makeStreamingConversation('c1', 'm1')],
      activeId: 'c1',
      streamingByConversation: { c1: 'req-current' },
    });

    useChatStore.getState().failMessage('req-stale', 'c1', 'm1', 'stale failure');

    expect(useChatStore.getState().streamingByConversation).toEqual({ c1: 'req-current' });
    expect(useChatStore.getState().conversations[0].messages[0]).toMatchObject({
      status: 'error',
      error: 'stale failure',
    });
  });

  it('preserves error detail from chat error events', async () => {
    const fake = installFakeBridge();
    initChatBridge();
    await useChatStore.getState().sendMessage('hello');
    const conversationId = useChatStore.getState().activeId!;
    const requestId = useChatStore.getState().streamingByConversation[conversationId];

    fake.emitChatError({
      requestId,
      message: 'Friendly failure',
      detail: 'HTTP 401: bad key',
    });

    expect(useChatStore.getState().conversations[0].messages[1]).toMatchObject({
      status: 'error',
      error: 'Friendly failure',
      errorDetail: 'HTTP 401: bad key',
    });
  });
});
