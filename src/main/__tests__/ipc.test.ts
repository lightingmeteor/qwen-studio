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
  defaultProvider: {
    streamChat: vi.fn(),
  },
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

  it('preserves errorDetail while validating saveMessages payloads', async () => {
    await importIpc();
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: '',
        createdAt: 100,
        status: 'error',
        error: 'Friendly error',
        errorDetail: 'HTTP 500 body',
      },
    ];

    await handlers.get('convo:saveMessages')?.({}, 'c1', messages);

    expect(convoMock.saveMessages).toHaveBeenCalledWith('c1', messages);
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
});
