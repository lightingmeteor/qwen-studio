import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Conversation } from '../../shared/types';

type Handler = (_event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();

const conversation: Conversation = {
  id: 'c1',
  title: 'Conversation c1',
  messages: [],
  createdAt: 100,
  updatedAt: 200,
};

const convoMock = vi.hoisted(() => ({
  listConversations: vi.fn(() => [conversation]),
  createConversation: vi.fn(() => conversation),
  renameConversation: vi.fn(() => undefined),
  deleteConversation: vi.fn(() => undefined),
  saveMessages: vi.fn(() => undefined),
  setConversationPinned: vi.fn(() => ({ ...conversation, pinned: true })),
  setConversationArchived: vi.fn(() => ({ ...conversation, archived: true })),
  getConversation: vi.fn(() => conversation),
}));

const exportMock = vi.hoisted(() => ({
  exportConversationMarkdown: vi.fn(async () => ({ canceled: false, filePath: '/tmp/c1.md' })),
  exportConversationsJson: vi.fn(async () => ({ canceled: false, filePath: '/tmp/all.json' })),
}));

const settingsMock = vi.hoisted(() => ({
  getSettings: vi.fn(() => ({
    baseUrl: 'https://example.com/v1',
    model: 'qwen-plus',
    temperature: 0.7,
    systemPrompt: '',
  })),
  saveSettings: vi.fn(),
  setApiKey: vi.fn(),
  getApiKey: vi.fn(() => 'sk-test'),
  hasApiKey: vi.fn(() => true),
}));

const qwenServiceMock = vi.hoisted(() => ({
  testQwenConnection: vi.fn(async () => ({
    ok: true,
    category: 'ok',
    message: 'Connection test succeeded.',
  })),
}));

const llmProviderMock = vi.hoisted(() => ({
  streamChat: vi.fn(),
  streamTurn: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../settingsStore', () => settingsMock);

vi.mock('../conversationStore', () => convoMock);
vi.mock('../conversationExport', () => exportMock);
vi.mock('../llmProvider', () => ({
  defaultProvider: llmProviderMock,
}));
vi.mock('../qwenService', () => qwenServiceMock);

async function importIpc() {
  handlers.clear();
  vi.resetModules();
  const mod = await import('../ipc');
  mod.registerIpc();
  return mod;
}

describe('conversation IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.getSettings.mockReturnValue({
      baseUrl: 'https://example.com/v1',
      model: 'qwen-plus',
      temperature: 0.7,
      systemPrompt: '',
    });
    settingsMock.getApiKey.mockReturnValue('sk-test');
    qwenServiceMock.testQwenConnection.mockResolvedValue({
      ok: true,
      category: 'ok',
      message: 'Connection test succeeded.',
    });
    llmProviderMock.streamChat.mockReset();
    llmProviderMock.streamTurn.mockReset();
  });

  it('registers handlers for pinning, archiving, and exporting conversations', async () => {
    await importIpc();

    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        'convo:setPinned',
        'convo:setArchived',
        'convo:exportMarkdown',
        'convo:exportJson',
      ]),
    );
  });

  it('validates pinned and archived inputs before updating the store', async () => {
    await importIpc();

    expect(await handlers.get('convo:setPinned')?.({}, 'c1', true)).toEqual({
      ...conversation,
      pinned: true,
    });
    expect(convoMock.setConversationPinned).toHaveBeenCalledWith('c1', true);
    expect(() => handlers.get('convo:setArchived')?.({}, '', true)).toThrow(
      'id must be a non-empty string',
    );
    expect(() => handlers.get('convo:setArchived')?.({}, 'c1', 'true')).toThrow(
      'archived must be a boolean',
    );
  });

  it('sanitizes errorDetail while validating saveMessages payloads', async () => {
    await importIpc();
    const secret = 'sk-' + 'a'.repeat(64);
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: '',
        createdAt: 100,
        status: 'error',
        error: 'Friendly error',
        errorDetail: `HTTP 500 Authorization: Bearer ${secret} ${'x'.repeat(1200)}`,
      },
    ];

    await handlers.get('convo:saveMessages')?.({}, 'c1', messages);

    const savedMessages = (convoMock.saveMessages.mock.calls[0] as unknown[])[1] as ChatMessage[];
    expect(savedMessages[0].errorDetail).toContain('Authorization: [REDACTED]');
    expect(savedMessages[0].errorDetail).not.toContain(secret);
    expect(savedMessages[0].errorDetail?.length).toBeLessThanOrEqual(1000);
  });

  it('preserves Responses provider metadata while validating saveMessages payloads', async () => {
    await importIpc();
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: 'I searched the web.',
        createdAt: 100,
        status: 'done',
        provider: 'responses',
        providerResponseId: 'resp-1',
        toolEvents: [
          {
            id: 'tool-1',
            type: 'web_search',
            status: 'completed',
            title: 'Web search',
            detail: 'Found 3 results',
          },
        ],
      },
    ];

    await handlers.get('convo:saveMessages')?.({}, 'c1', messages);

    const savedMessages = (convoMock.saveMessages.mock.calls[0] as unknown[])[1] as ChatMessage[];
    expect(savedMessages).toEqual(messages);
  });

  it('drops malformed optional Responses metadata while saving otherwise valid messages', async () => {
    await importIpc();
    const validToolEvent = {
      id: 'tool-1',
      type: 'web_search' as const,
      status: 'completed' as const,
      title: 'Web search',
      detail: 'Found 3 results',
    };

    await handlers.get('convo:saveMessages')?.({}, 'c1', [
      {
        id: 'm1',
        role: 'assistant',
        content: 'I searched the web.',
        createdAt: 100,
        status: 'done',
        provider: 'legacy_responses',
        providerResponseId: 42,
        toolEvents: [
          validToolEvent,
          {
            id: 'tool-2',
            type: 'calculator',
            status: 'completed',
            title: 'Unsupported tool',
          },
        ],
      },
    ]);

    const savedMessages = (convoMock.saveMessages.mock.calls[0] as unknown[])[1] as ChatMessage[];
    expect(savedMessages).toEqual([
      {
        id: 'm1',
        role: 'assistant',
        content: 'I searched the web.',
        createdAt: 100,
        status: 'done',
        toolEvents: [validToolEvent],
      },
    ]);
  });

  it('exports by looking up conversations in main and never accepting renderer output paths', async () => {
    await importIpc();

    await expect(handlers.get('convo:exportMarkdown')?.({}, 'c1')).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/c1.md',
    });
    await expect(handlers.get('convo:exportJson')?.({})).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/all.json',
    });

    expect(exportMock.exportConversationMarkdown).toHaveBeenCalledWith(conversation);
    expect(exportMock.exportConversationsJson).toHaveBeenCalledWith([conversation]);
  });
});

describe('diagnostic IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.getSettings.mockReturnValue({
      baseUrl: 'https://example.com/v1',
      model: 'qwen-plus',
      temperature: 0.7,
      systemPrompt: '',
    });
    settingsMock.getApiKey.mockReturnValue('sk-test');
    qwenServiceMock.testQwenConnection.mockResolvedValue({
      ok: true,
      category: 'ok',
      message: 'Connection test succeeded.',
    });
    llmProviderMock.streamChat.mockReset();
    llmProviderMock.streamTurn.mockReset();
  });

  it('returns missing_key without calling the network when no saved or temporary key exists', async () => {
    settingsMock.getApiKey.mockReturnValue('');
    await importIpc();

    await expect(handlers.get('diagnostics:testConnection')?.({})).resolves.toMatchObject({
      ok: false,
      category: 'missing_key',
    });
    expect(qwenServiceMock.testQwenConnection).not.toHaveBeenCalled();
  });

  it('returns config without calling the network for unresolved base URL templates', async () => {
    await importIpc();

    await expect(
      handlers.get('diagnostics:testConnection')?.({}, {
        baseUrl: 'https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
      }),
    ).resolves.toMatchObject({
      ok: false,
      category: 'config',
    });
    expect(qwenServiceMock.testQwenConnection).not.toHaveBeenCalled();
  });

  it('uses a temporary API key and patch settings without saving them', async () => {
    await importIpc();

    await expect(
      handlers.get('diagnostics:testConnection')?.({}, {
        apiKey: 'sk-temp',
        baseUrl: 'https://patched.example/v1',
        model: 'qwen-max',
        temperature: 0.2,
        systemPrompt: 'temporary prompt',
      }),
    ).resolves.toMatchObject({
      ok: true,
      category: 'ok',
    });

    expect(qwenServiceMock.testQwenConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-temp',
        baseUrl: 'https://patched.example/v1',
        model: 'qwen-max',
      }),
    );
    expect(settingsMock.setApiKey).not.toHaveBeenCalled();
    expect(settingsMock.saveSettings).not.toHaveBeenCalled();
  });

  it('refuses to test a changed base URL with the saved API key', async () => {
    await importIpc();

    await expect(
      handlers.get('diagnostics:testConnection')?.({}, {
        baseUrl: 'https://attacker.example/v1',
      }),
    ).resolves.toMatchObject({
      ok: false,
      category: 'config',
    });

    expect(qwenServiceMock.testQwenConnection).not.toHaveBeenCalled();
  });

  it('allows testing a changed model on the saved base URL with the saved API key', async () => {
    await importIpc();

    await expect(
      handlers.get('diagnostics:testConnection')?.({}, {
        model: 'qwen-max',
      }),
    ).resolves.toMatchObject({
      ok: true,
      category: 'ok',
    });

    expect(qwenServiceMock.testQwenConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        baseUrl: 'https://example.com/v1',
        model: 'qwen-max',
      }),
    );
  });
});

describe('chat IPC errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.getSettings.mockReturnValue({
      baseUrl: 'https://example.com/v1',
      model: 'qwen-plus',
      temperature: 0.7,
      systemPrompt: '',
    });
    settingsMock.getApiKey.mockReturnValue('sk-test');
    llmProviderMock.streamChat.mockReset();
    llmProviderMock.streamTurn.mockReset();
  });

  it('sanitizes technical details before sending chat errors to the renderer', async () => {
    const secret = 'sk-' + 'a'.repeat(64);
    const error = new Error('Friendly failure') as Error & { detail: string };
    error.detail = `Authorization: Bearer ${secret} ${'x'.repeat(1200)}`;
    llmProviderMock.streamTurn.mockRejectedValue(error);
    const sender = {
      id: 1,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
    };
    await importIpc();

    await handlers.get('chat:stream')?.(
      { sender },
      {
        requestId: 'req-1',
        conversationId: 'c1',
        messages: [{ role: 'user', content: 'hello' }],
      },
    );

    expect(sender.send).toHaveBeenCalledWith(
      'chat:error',
      expect.objectContaining({
        requestId: 'req-1',
        message: 'Friendly failure',
        detail: expect.stringContaining('Authorization: [REDACTED]'),
      }),
    );
    const payload = sender.send.mock.calls[0][1] as { detail: string };
    expect(payload.detail).not.toContain(secret);
    expect(payload.detail.length).toBeLessThanOrEqual(1000);
  });
});

describe('chat IPC stream requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.getSettings.mockReturnValue({
      baseUrl: 'https://example.com/v1',
      model: 'qwen-plus',
      temperature: 0.7,
      systemPrompt: '',
    });
    settingsMock.getApiKey.mockReturnValue('sk-test');
    llmProviderMock.streamChat.mockReset();
    llmProviderMock.streamTurn.mockReset();
  });

  function makeSender() {
    return {
      id: 1,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
    };
  }

  it('accepts Responses fields and forwards provider response and tool events', async () => {
    const toolEvent = {
      id: 'tool-1',
      type: 'web_search' as const,
      status: 'started' as const,
      title: 'Searching',
      detail: 'query',
    };
    llmProviderMock.streamTurn.mockImplementation(async (input) => {
      input.onResponseId?.('resp-1');
      input.onToolEvent?.(toolEvent);
      input.onDelta('hello');
    });
    const sender = makeSender();
    await importIpc();

    await handlers.get('chat:stream')?.(
      { sender },
      {
        requestId: 'req-1',
        conversationId: 'c1',
        apiMode: 'responses',
        tools: ['web_search'],
        previousResponseId: 'resp-prev',
        messages: [{ role: 'user', content: 'hello' }],
      },
    );

    expect(llmProviderMock.streamTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        apiMode: 'responses',
        tools: ['web_search'],
        previousResponseId: 'resp-prev',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    );
    expect(sender.send).toHaveBeenCalledWith('chat:response', {
      requestId: 'req-1',
      responseId: 'resp-1',
    });
    expect(sender.send).toHaveBeenCalledWith('chat:tool', {
      requestId: 'req-1',
      event: toolEvent,
    });
    expect(sender.send).toHaveBeenCalledWith('chat:delta', {
      requestId: 'req-1',
      text: 'hello',
    });
    expect(sender.send).toHaveBeenCalledWith('chat:done', { requestId: 'req-1' });
  });

  it('rejects unknown API modes and tools before calling the provider', async () => {
    const sender = makeSender();
    await importIpc();

    await handlers.get('chat:stream')?.(
      { sender },
      {
        requestId: 'req-bad-mode',
        conversationId: 'c1',
        apiMode: 'unknown',
        messages: [{ role: 'user', content: 'hello' }],
      },
    );
    await handlers.get('chat:stream')?.(
      { sender },
      {
        requestId: 'req-bad-tool',
        conversationId: 'c1',
        apiMode: 'responses',
        tools: ['calculator'],
        messages: [{ role: 'user', content: 'hello' }],
      },
    );

    expect(llmProviderMock.streamTurn).not.toHaveBeenCalled();
    expect(llmProviderMock.streamChat).not.toHaveBeenCalled();
    expect(sender.send).toHaveBeenCalledWith('chat:error', {
      requestId: 'req-bad-mode',
      message: 'apiMode must be chat_completions or responses',
    });
    expect(sender.send).toHaveBeenCalledWith('chat:error', {
      requestId: 'req-bad-tool',
      message: 'tools[0] must be web_search',
    });
  });

  it('keeps the default chat-completions path free of Responses-only fields', async () => {
    const sender = makeSender();
    await importIpc();

    await handlers.get('chat:stream')?.(
      { sender },
      {
        requestId: 'req-chat',
        conversationId: 'c1',
        messages: [{ role: 'user', content: 'hello' }],
      },
    );

    expect(llmProviderMock.streamTurn).toHaveBeenCalledTimes(1);
    const input = llmProviderMock.streamTurn.mock.calls[0][0];
    expect(input).toMatchObject({
      apiMode: 'chat_completions',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(input).not.toHaveProperty('tools');
    expect(input).not.toHaveProperty('previousResponseId');
    expect(input).not.toHaveProperty('input');
  });
});
