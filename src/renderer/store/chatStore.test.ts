import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type ChatDoneEvent,
  type ChatErrorEvent,
  type ChatMessage,
  type ChatResponseEvent,
  type ChatToolEvent,
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
  forkCalls: Array<{ sourceId: string; messageId: string; opts?: { exclusive?: boolean } }>;
  saveMessagesCalls: Array<{ conversationId: string; messages: ChatMessage[] }>;
  pinnedCalls: Array<{ id: string; pinned: boolean }>;
  archivedCalls: Array<{ id: string; archived: boolean }>;
  exportMarkdownCalls: string[];
  exportJsonCalls: number;
  abortChatCalls: string[];
  conversations: Conversation[];
  emitChatResponse: (event: ChatResponseEvent) => void;
  emitChatTool: (event: ChatToolEvent) => void;
  emitChatDone: (event: ChatDoneEvent) => void;
  emitChatError: (event: ChatErrorEvent) => void;
} {
  let nextConversation = 1;
  const conversations: Conversation[] = [];
  const chatStreamCalls: unknown[] = [];
  const forkCalls: Array<{ sourceId: string; messageId: string; opts?: { exclusive?: boolean } }> =
    [];
  const saveMessagesCalls: Array<{ conversationId: string; messages: ChatMessage[] }> = [];
  const pinnedCalls: Array<{ id: string; pinned: boolean }> = [];
  const archivedCalls: Array<{ id: string; archived: boolean }> = [];
  const exportMarkdownCalls: string[] = [];
  let exportJsonCalls = 0;
  const abortChatCalls: string[] = [];
  const responseListeners: Array<(event: ChatResponseEvent) => void> = [];
  const toolListeners: Array<(event: ChatToolEvent) => void> = [];
  const doneListeners: Array<(event: ChatDoneEvent) => void> = [];
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
    forkConversation: async (sourceId, messageId, opts) => {
      forkCalls.push({ sourceId, messageId, opts });
      const source = conversations.find((item) => item.id === sourceId);
      if (!source) throw new Error(`Conversation not found: ${sourceId}`);
      const index = source.messages.findIndex((message) => message.id === messageId);
      if (index < 0) throw new Error(`Message not found: ${messageId}`);
      const forked: Conversation = {
        ...makeConversation(`fork-${nextConversation++}`),
        title: `${source.title}（分叉）`,
        messages: source.messages
          .slice(0, opts?.exclusive ? index : index + 1)
          .map((message) => ({ ...message })),
        forkedFrom: {
          conversationId: sourceId,
          messageId,
          sourceTitle: source.title,
          messageIndex: index + 1,
        },
      };
      conversations.unshift(forked);
      return forked;
    },
    saveMessages: async (conversationId, messages) => {
      saveMessagesCalls.push({ conversationId, messages });
      const conversation = conversations.find((item) => item.id === conversationId);
      if (conversation) {
        conversation.messages = messages.map((message) => ({ ...message }));
      }
    },
    setConversationPinned: async (id: string, pinned: boolean) => {
      pinnedCalls.push({ id, pinned });
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error(`Conversation not found: ${id}`);
      return {
        ...conversation,
        title: `${conversation.title} pinned-returned`,
        messages: conversation.messages.map((message) => ({ ...message })),
        pinned,
      };
    },
    setConversationArchived: async (id: string, archived: boolean) => {
      archivedCalls.push({ id, archived });
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error(`Conversation not found: ${id}`);
      return {
        ...conversation,
        title: `${conversation.title} archived-returned`,
        messages: conversation.messages.map((message) => ({ ...message })),
        archived,
      };
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
    onChatResponse: (cb) => {
      responseListeners.push(cb);
      return () => {
        const index = responseListeners.indexOf(cb);
        if (index >= 0) responseListeners.splice(index, 1);
      };
    },
    onChatTool: (cb) => {
      toolListeners.push(cb);
      return () => {
        const index = toolListeners.indexOf(cb);
        if (index >= 0) toolListeners.splice(index, 1);
      };
    },
    onChatDone: (cb) => {
      doneListeners.push(cb);
      return () => {
        const index = doneListeners.indexOf(cb);
        if (index >= 0) doneListeners.splice(index, 1);
      };
    },
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
    forkCalls,
    saveMessagesCalls,
    pinnedCalls,
    archivedCalls,
    exportMarkdownCalls,
    get exportJsonCalls() {
      return exportJsonCalls;
    },
    abortChatCalls,
    conversations,
    emitChatResponse: (event) => responseListeners.forEach((listener) => listener(event)),
    emitChatTool: (event) => toolListeners.forEach((listener) => listener(event)),
    emitChatDone: (event) => doneListeners.forEach((listener) => listener(event)),
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

  it('stores provider response ids and tool events from bridge events', async () => {
    const fake = installFakeBridge();
    initChatBridge();
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiMode: 'responses' },
      hasKey: true,
      loaded: true,
    });

    await useChatStore.getState().sendMessage('hello');
    const conversationId = useChatStore.getState().activeId!;
    const requestId = useChatStore.getState().streamingByConversation[conversationId];
    const toolEvent = {
      id: 'tool-1',
      type: 'web_search' as const,
      status: 'started' as const,
      title: 'Searching',
      detail: 'hello',
    };

    fake.emitChatResponse({ requestId, responseId: 'resp-1' });
    fake.emitChatTool({ requestId, event: toolEvent });

    expect(useChatStore.getState().conversations[0].messages[1]).toMatchObject({
      role: 'assistant',
      provider: 'responses',
      providerResponseId: 'resp-1',
      toolEvents: [toolEvent],
    });
    expect(fake.saveMessagesCalls.at(-2)?.messages[1]).toMatchObject({
      providerResponseId: 'resp-1',
    });
    expect(fake.saveMessagesCalls.at(-1)?.messages[1]).toMatchObject({
      toolEvents: [toolEvent],
    });
  });

  it('pins a conversation through the bridge and updates local state', async () => {
    const fake = installFakeBridge();
    const conversation = makeConversation('c1');
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });

    await useChatStore.getState().setConversationPinned('c1', true);

    expect(fake.pinnedCalls).toEqual([{ id: 'c1', pinned: true }]);
    expect(useChatStore.getState().conversations[0]).toMatchObject({
      pinned: true,
      title: '新会话 pinned-returned',
    });
  });

  it('loads conversations by selecting the first non-archived conversation', async () => {
    const fake = installFakeBridge();
    const archived = { ...makeConversation('c1'), archived: true };
    const visible = makeConversation('c2');
    fake.conversations.push(archived, visible);

    await useChatStore.getState().loadConversations();

    expect(useChatStore.getState().activeId).toBe('c2');
  });

  it('loads conversations by preserving an existing active conversation', async () => {
    const fake = installFakeBridge();
    const archived = { ...makeConversation('c1'), archived: true };
    const active = makeConversation('c2');
    fake.conversations.push(archived, active);
    useChatStore.setState({ conversations: [active], activeId: 'c2' });

    await useChatStore.getState().loadConversations();

    expect(useChatStore.getState().activeId).toBe('c2');
  });

  it('loads conversations by replacing a missing active conversation with the first non-archived one', async () => {
    const fake = installFakeBridge();
    const archived = { ...makeConversation('c1'), archived: true };
    const visible = makeConversation('c2');
    fake.conversations.push(archived, visible);
    useChatStore.setState({ conversations: [], activeId: 'missing' });

    await useChatStore.getState().loadConversations();

    expect(useChatStore.getState().activeId).toBe('c2');
  });

  it('selects the first non-archived conversation after deleting the active conversation', async () => {
    const fake = installFakeBridge();
    const active = makeConversation('c1');
    const archived = { ...makeConversation('c2'), archived: true };
    const visible = makeConversation('c3');
    fake.conversations.push(active, archived, visible);
    useChatStore.setState({ conversations: [active, archived, visible], activeId: 'c1' });

    await useChatStore.getState().deleteConversation('c1');

    expect(useChatStore.getState().activeId).toBe('c3');
  });

  it('clears the active conversation after deleting it when only archived conversations remain', async () => {
    const fake = installFakeBridge();
    const active = makeConversation('c1');
    const archived = { ...makeConversation('c2'), archived: true };
    fake.conversations.push(active, archived);
    useChatStore.setState({ conversations: [active, archived], activeId: 'c1' });

    await useChatStore.getState().deleteConversation('c1');

    expect(useChatStore.getState().activeId).toBeNull();
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
    expect(useChatStore.getState().conversations.find((item) => item.id === 'c2')?.title).toBe(
      '新会话 archived-returned',
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

  it('keeps routing after archiving a streaming conversation so chat done finalizes the message', async () => {
    const fake = installFakeBridge();
    initChatBridge();
    await useChatStore.getState().sendMessage('hello');
    const conversationId = useChatStore.getState().activeId!;
    const requestId = useChatStore.getState().streamingByConversation[conversationId];

    await useChatStore.getState().setConversationArchived(conversationId, true);

    expect(useChatStore.getState().streamingByConversation).toEqual({});
    fake.emitChatDone({ requestId, aborted: true });

    expect(useChatStore.getState().conversations[0].messages[1]).toMatchObject({
      status: 'done',
      aborted: true,
    });
    expect(fake.saveMessagesCalls.at(-1)?.messages[1]).toMatchObject({
      status: 'done',
      aborted: true,
    });
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

  it('sends Responses requests with the latest assistant response id and enabled web search', async () => {
    const fake = installFakeBridge();
    const conversation = {
      ...makeConversation('c1'),
      messages: [
        makeUserMessage('m1', 'first'),
        {
          ...makeAssistantMessage('m2', 'first reply'),
          provider: 'responses' as const,
          providerResponseId: 'resp-prev',
        },
      ],
    };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        apiMode: 'responses',
        webSearchEnabled: true,
        systemPrompt: 'Be concise.',
      },
      hasKey: true,
      loaded: true,
    });

    await useChatStore.getState().sendMessage('follow up');

    expect(fake.chatStreamCalls).toHaveLength(1);
    expect(fake.chatStreamCalls[0]).toMatchObject({
      apiMode: 'responses',
      tools: ['web_search'],
      previousResponseId: 'resp-prev',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'follow up' },
      ],
    });
    expect(useChatStore.getState().conversations[0].messages.at(-1)).toMatchObject({
      role: 'assistant',
      provider: 'responses',
    });
  });

  it('falls back to full history in Responses mode when later Chat Completions turns follow a response id', async () => {
    const fake = installFakeBridge();
    const conversation = {
      ...makeConversation('c1'),
      messages: [
        makeUserMessage('m1', 'first'),
        {
          ...makeAssistantMessage('m2', 'first response reply'),
          provider: 'responses' as const,
          providerResponseId: 'resp-old',
        },
        makeUserMessage('m3', 'chat follow up'),
        {
          ...makeAssistantMessage('m4', 'chat reply'),
          provider: 'chat_completions' as const,
        },
      ],
    };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        apiMode: 'responses',
        webSearchEnabled: true,
        systemPrompt: 'Be concise.',
      },
      hasKey: true,
      loaded: true,
    });

    await useChatStore.getState().sendMessage('responses again');

    expect(fake.chatStreamCalls).toHaveLength(1);
    const payload = fake.chatStreamCalls[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      apiMode: 'responses',
      tools: ['web_search'],
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'first response reply' },
        { role: 'user', content: 'chat follow up' },
        { role: 'assistant', content: 'chat reply' },
        { role: 'user', content: 'responses again' },
      ],
    });
    expect(payload).not.toHaveProperty('previousResponseId');
  });

  it('does not send Responses-only fields in Chat Completions mode', async () => {
    const fake = installFakeBridge();
    const conversation = {
      ...makeConversation('c1'),
      messages: [
        makeUserMessage('m1', 'first'),
        {
          ...makeAssistantMessage('m2', 'first reply'),
          provider: 'responses' as const,
          providerResponseId: 'resp-prev',
        },
      ],
    };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        apiMode: 'chat_completions',
        webSearchEnabled: true,
      },
      hasKey: true,
      loaded: true,
    });

    await useChatStore.getState().sendMessage('follow up');

    expect(fake.chatStreamCalls).toHaveLength(1);
    const payload = fake.chatStreamCalls[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('apiMode');
    expect(payload).not.toHaveProperty('tools');
    expect(payload).not.toHaveProperty('previousResponseId');
    expect(payload.messages).toMatchObject([
      { role: 'system', content: DEFAULT_SETTINGS.systemPrompt },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first reply' },
      { role: 'user', content: 'follow up' },
    ]);
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

  it('forks from a message into a new active conversation and keeps the source untouched', async () => {
    const fake = installFakeBridge();
    const messages = [
      makeUserMessage('m1', 'first'),
      makeAssistantMessage('m2', 'first reply'),
      makeUserMessage('m3', 'follow up'),
      makeAssistantMessage('m4', 'second reply'),
    ];
    const conversation = { ...makeConversation('c1', '长对话'), messages };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });

    await useChatStore.getState().fork('m2');

    expect(fake.forkCalls).toEqual([{ sourceId: 'c1', messageId: 'm2', opts: undefined }]);
    const state = useChatStore.getState();
    expect(state.conversations).toHaveLength(2);
    expect(state.conversations[0]).toMatchObject({
      title: '长对话（分叉）',
      forkedFrom: { conversationId: 'c1', messageId: 'm2' },
    });
    expect(state.conversations[0].messages.map((message) => message.id)).toEqual(['m1', 'm2']);
    expect(state.activeId).toBe(state.conversations[0].id);
    expect(state.conversations[1].messages).toEqual(messages);
  });

  it('forks exclusively before an edited message and sends the edited text in the fork', async () => {
    const fake = installFakeBridge();
    const messages = [
      makeUserMessage('m1', 'first'),
      makeAssistantMessage('m2', 'first reply'),
      makeUserMessage('m3', 'old follow up'),
      makeAssistantMessage('m4', 'old reply'),
    ];
    const conversation = { ...makeConversation('c1', '长对话'), messages };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });

    await useChatStore.getState().forkAndResend('m3', ' revised follow up ');

    expect(fake.forkCalls).toEqual([
      { sourceId: 'c1', messageId: 'm3', opts: { exclusive: true } },
    ]);
    const state = useChatStore.getState();
    const forked = state.conversations[0];
    expect(state.activeId).toBe(forked.id);
    expect(forked.messages.map((message) => message.content)).toEqual([
      'first',
      'first reply',
      'revised follow up',
      '',
    ]);
    expect(fake.chatStreamCalls).toHaveLength(1);
    const payload = fake.chatStreamCalls[0] as { conversationId: string; messages: Array<{ content: string }> };
    expect(payload.conversationId).toBe(forked.id);
    expect(payload.messages.at(-1)).toMatchObject({ content: 'revised follow up' });
    // 原会话完全不变。
    expect(state.conversations[1].messages).toEqual(messages);
  });

  it('retries once with full history when previous_response_id is rejected as invalid', async () => {
    const fake = installFakeBridge();
    initChatBridge();
    const conversation = {
      ...makeConversation('c1'),
      messages: [
        makeUserMessage('m1', 'first'),
        {
          ...makeAssistantMessage('m2', 'first reply'),
          provider: 'responses' as const,
          providerResponseId: 'resp-stale',
        },
      ],
    };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiMode: 'responses' },
      hasKey: true,
      loaded: true,
    });

    await useChatStore.getState().sendMessage('follow up');
    expect(fake.chatStreamCalls[0]).toMatchObject({ previousResponseId: 'resp-stale' });
    const failedRequestId = useChatStore.getState().streamingByConversation.c1;

    fake.emitChatError({
      requestId: failedRequestId,
      message: '请求被拒绝（400）',
      code: 'previous_response_invalid',
    });
    await Promise.resolve();

    expect(fake.chatStreamCalls).toHaveLength(2);
    const retryPayload = fake.chatStreamCalls[1] as Record<string, unknown>;
    expect(retryPayload).not.toHaveProperty('previousResponseId');
    expect(retryPayload).toMatchObject({
      apiMode: 'responses',
      messages: [
        { role: 'system', content: DEFAULT_SETTINGS.systemPrompt },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'first reply' },
        { role: 'user', content: 'follow up' },
      ],
    });
    // 占位消息保持流式中，没有进入错误态。
    expect(useChatStore.getState().conversations[0].messages.at(-1)).toMatchObject({
      status: 'streaming',
    });
    const retryRequestId = useChatStore.getState().streamingByConversation.c1;
    expect(retryRequestId).not.toBe(failedRequestId);

    fake.emitChatDone({ requestId: retryRequestId });
    expect(useChatStore.getState().conversations[0].messages.at(-1)).toMatchObject({
      status: 'done',
    });
  });

  it('surfaces the error without looping when the fallback retry also fails', async () => {
    const fake = installFakeBridge();
    initChatBridge();
    const conversation = {
      ...makeConversation('c1'),
      messages: [
        makeUserMessage('m1', 'first'),
        {
          ...makeAssistantMessage('m2', 'first reply'),
          provider: 'responses' as const,
          providerResponseId: 'resp-stale',
        },
      ],
    };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiMode: 'responses' },
      hasKey: true,
      loaded: true,
    });

    await useChatStore.getState().sendMessage('follow up');
    const failedRequestId = useChatStore.getState().streamingByConversation.c1;
    fake.emitChatError({
      requestId: failedRequestId,
      message: '请求被拒绝（400）',
      code: 'previous_response_invalid',
    });
    await Promise.resolve();
    expect(fake.chatStreamCalls).toHaveLength(2);

    const retryRequestId = useChatStore.getState().streamingByConversation.c1;
    fake.emitChatError({
      requestId: retryRequestId,
      message: '回退后仍然失败',
      code: 'previous_response_invalid',
    });
    await Promise.resolve();

    expect(fake.chatStreamCalls).toHaveLength(2);
    expect(useChatStore.getState().conversations[0].messages.at(-1)).toMatchObject({
      status: 'error',
      error: '回退后仍然失败',
    });
    expect(useChatStore.getState().streamingByConversation).toEqual({});
  });

  it('does not retry when the failed request never carried previous_response_id', async () => {
    const fake = installFakeBridge();
    initChatBridge();
    const conversation = {
      ...makeConversation('c1'),
      messages: [makeUserMessage('m1', 'first'), makeAssistantMessage('m2', 'first reply')],
    };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      hasKey: true,
      loaded: true,
    });

    await useChatStore.getState().sendMessage('follow up');
    expect(fake.chatStreamCalls[0]).not.toHaveProperty('previousResponseId');
    const requestId = useChatStore.getState().streamingByConversation.c1;

    fake.emitChatError({
      requestId,
      message: '请求被拒绝（400）',
      code: 'previous_response_invalid',
    });
    await Promise.resolve();

    expect(fake.chatStreamCalls).toHaveLength(1);
    expect(useChatStore.getState().conversations[0].messages.at(-1)).toMatchObject({
      status: 'error',
      error: '请求被拒绝（400）',
    });
  });

  it('does not truncate edit and resend history when the API key is missing', async () => {
    const fake = installFakeBridge();
    const messages = [
      makeUserMessage('m1', 'first'),
      makeAssistantMessage('m2', 'first reply'),
      makeUserMessage('m3', 'old follow up'),
      makeAssistantMessage('m4', 'old reply'),
    ];
    const conversation = {
      ...makeConversation('c1'),
      messages,
    };
    fake.conversations.push(conversation);
    useChatStore.setState({ conversations: [conversation], activeId: 'c1' });
    useSettingsStore.setState({ hasKey: false });

    await useChatStore.getState().editAndResend('m3', 'revised follow up');

    expect(fake.saveMessagesCalls).toEqual([]);
    expect(fake.chatStreamCalls).toEqual([]);
    expect(useChatStore.getState().conversations[0].messages).toEqual(messages);
  });
});
