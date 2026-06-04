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

vi.mock('../settingsStore', () => ({
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

vi.mock('../conversationStore', () => convoMock);
vi.mock('../conversationExport', () => exportMock);
vi.mock('../llmProvider', () => ({
  defaultProvider: {
    streamChat: vi.fn(),
  },
}));

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
