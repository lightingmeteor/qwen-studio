import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type ChatErrorEvent,
  type ChatMessage,
  type Conversation,
  type ExportResult,
} from '../../shared/types';
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

function makeUserMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    createdAt: Date.now(),
    status: 'done',
  };
}

function makeAssistantMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    createdAt: Date.now(),
    status: 'done',
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
  saveMessagesCalls: Array<{ conversationId: string; messages: ChatMessage[] }>;
  pinnedCalls: Array<{ id: string; pinned: boolean }>;
  archivedCalls: Array<{ id: string; archived: boolean }>;
  exportMarkdownCalls: string[];
  exportJsonCalls: number;
  abortChatCalls: string[];
  conversations: Conversation[];
  emitChatError: (event: ChatErrorEvent) => void;
} {
  let nextConversation = 1;
  const conversations: Conversation[] = [];
  const chatStreamCalls: unknown[] = [];
  const saveMessagesCalls: Array<{ conversationId: string; messages: ChatMessage[] }> = [];
  const pinnedCalls: Array<{ id: string; pinned: boolean }> = [];
  const archivedCalls: Array<{ id: string; archived: boolean }> = [];
  const exportMarkdownCalls: string[] = [];
  let exportJsonCalls = 0;
  const abortChatCalls: string[] = [];
  const errorListeners: Array<(event: ChatErrorEvent) => void> = [];
  const subscribe = () => () => {};
  const markdownResult: ExportResult = {
    canceled: false,
    filePath: '/tmp/conversation.md',
  };
  const jsonResult: ExportResult = {
    canceled: false,
    filePath: '/tmp/conversations.json',
  };

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
    saveMessages: async (conversationId, messages) => {
      saveMessagesCalls.push({ conversationId, messages });
    },
    setConversationPinned: async (id: string, pinned: boolean) => {
      pinnedCalls.push({ id, pinned });
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error(`Conversation not found: ${id}`);
      conversation.pinned = pinned;
      return conversation;
    },
    setConversationArchived: async (id: string, archived: boolean) => {
      archivedCalls.push({ id, archived });
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error(`Conversation not found: ${id}`);
      conversation.archived = archived;
      return conversation;
    },
    exportConversationMarkdown: async (id) => {
      exportMarkdownCalls.push(id);
      return markdownResult;
    },
    exportConversationsJson: async () => {
      exportJsonCalls += 1;
      return jsonResult;
    },
    chatStream: async (payload: unknown) => {
      chatStreamCalls.push(payload);
    },
    abortChat: async (requestId) => {
      abortChatCalls.push(requestId);
    },
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
    saveMessagesCalls,
    pinnedCalls,
    archivedCalls,
    exportMarkdownCalls,
    get exportJsonCalls() {
      return exportJsonCalls;
    },
    abortChatCalls,
    conversations,
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

  it('pins a conversation through the bridge and updates local state', async () => {
    const fake = installFakeBridge();
    const conversation = makeConversation('c1');
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });

    await useChatStore.getState().setConversationPinned('c1', true);

    expect(fake.pinnedCalls).toEqual([{ id: 'c1', pinned: true }]);
    expect(useChatStore.getState().conversations[0].pinned).toBe(true);
  });

  it('archives an inactive conversation through the bridge and updates local state', async () => {
    const fake = installFakeBridge();
    const active = makeConversation('c1');
    const inactive = makeConversation('c2');
    fake.conversations.push(active, inactive);
    useChatStore.setState({ conversations: [active, inactive], activeId: 'c1' });

    await useChatStore.getState().setConversationArchived('c2', true);

    expect(fake.archivedCalls).toEqual([{ id: 'c2', archived: true }]);
    expect(useChatStore.getState().conversations.find((item) => item.id === 'c2')?.archived).toBe(
      true,
    );
    expect(useChatStore.getState().activeId).toBe('c1');
  });

  it('selects the next non-archived conversation after archiving the active one', async () => {
    const fake = installFakeBridge();
    const active = makeConversation('c1');
    const archived = { ...makeConversation('c2'), archived: true };
    const next = makeConversation('c3');
    fake.conversations.push(active, archived, next);
    useChatStore.setState({ conversations: [active, archived, next], activeId: 'c1' });

    await useChatStore.getState().setConversationArchived('c1', true);

    expect(useChatStore.getState().activeId).toBe('c3');
  });

  it('aborts a streaming conversation before archiving it', async () => {
    const fake = installFakeBridge();
    const conversation = makeStreamingConversation('c1', 'm1');
    fake.conversations.push(conversation);
    useChatStore.setState({
      conversations: [conversation],
      activeId: 'c1',
      streamingByConversation: { c1: 'req-1' },
    });

    await useChatStore.getState().setConversationArchived('c1', true);

    expect(fake.abortChatCalls).toEqual(['req-1']);
    expect(fake.archivedCalls).toEqual([{ id: 'c1', archived: true }]);
    expect(useChatStore.getState().streamingByConversation).toEqual({});
  });

  it('exports the active conversation as markdown and all conversations as json', async () => {
    const fake = installFakeBridge();
    const conversation = makeConversation('c1');
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });

    await expect(useChatStore.getState().exportActiveConversationMarkdown()).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/conversation.md',
    });
    await expect(useChatStore.getState().exportAllConversationsJson()).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/conversations.json',
    });

    expect(fake.exportMarkdownCalls).toEqual(['c1']);
    expect(fake.exportJsonCalls).toBe(1);
  });

  it('returns undefined when exporting markdown without an active conversation', async () => {
    const fake = installFakeBridge();

    await expect(useChatStore.getState().exportActiveConversationMarkdown()).resolves.toBeUndefined();

    expect(fake.exportMarkdownCalls).toEqual([]);
  });

  it('truncates from an edited user message and sends the edited text', async () => {
    const fake = installFakeBridge();
    const conversation = {
      ...makeConversation('c1'),
      messages: [
        makeUserMessage('m1', 'first'),
        makeAssistantMessage('m2', 'first reply'),
        makeUserMessage('m3', 'old follow up'),
        makeAssistantMessage('m4', 'old reply'),
      ],
    };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });

    await useChatStore.getState().editAndResend('m3', ' revised follow up ');

    expect(fake.saveMessagesCalls[0]).toMatchObject({
      conversationId: 'c1',
      messages: [
        { id: 'm1', content: 'first' },
        { id: 'm2', content: 'first reply' },
      ],
    });
    expect(fake.chatStreamCalls).toHaveLength(1);
    const messages = (fake.chatStreamCalls[0] as { messages: Array<{ content: string }> }).messages;
    expect(messages.at(-1)).toMatchObject({ content: 'revised follow up' });
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(4);
    expect(useChatStore.getState().conversations[0].messages[2]).toMatchObject({
      role: 'user',
      content: 'revised follow up',
    });
  });

  it('ignores edit and resend while the active conversation is streaming', async () => {
    const fake = installFakeBridge();
    const conversation = {
      ...makeConversation('c1'),
      messages: [makeUserMessage('m1', 'first')],
    };
    fake.conversations.push(conversation);
    useChatStore.setState({
      conversations: [conversation],
      activeId: 'c1',
      streamingByConversation: { c1: 'req-1' },
    });

    await useChatStore.getState().editAndResend('m1', 'second');

    expect(fake.saveMessagesCalls).toEqual([]);
    expect(fake.chatStreamCalls).toEqual([]);
    expect(useChatStore.getState().conversations[0].messages).toEqual(conversation.messages);
  });
});
