import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Conversation } from '../../shared/types';

type StoreData = Record<string, unknown>;

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): ChatMessage {
  return {
    id: overrides.id,
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'hello',
    createdAt: overrides.createdAt ?? 100,
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
    ...(overrides.aborted === undefined ? {} : { aborted: overrides.aborted }),
    ...(overrides.error === undefined ? {} : { error: overrides.error }),
    ...(overrides.errorDetail === undefined ? {} : { errorDetail: overrides.errorDetail }),
    ...(overrides.usage === undefined ? {} : { usage: overrides.usage }),
  };
}

function conversation(overrides: Partial<Conversation> & Pick<Conversation, 'id'>): Conversation {
  return {
    id: overrides.id,
    title: overrides.title ?? `Conversation ${overrides.id}`,
    messages: overrides.messages ?? [],
    createdAt: overrides.createdAt ?? 1_700_000_000_000,
    updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
    ...(overrides.pinned === undefined ? {} : { pinned: overrides.pinned }),
    ...(overrides.archived === undefined ? {} : { archived: overrides.archived }),
  };
}

async function importConversationStore(initialData: StoreData = {}) {
  vi.resetModules();

  const data: StoreData = { ...initialData };
  vi.doMock('electron-store', () => ({
    default: class MockStore {
      constructor(config: { defaults?: StoreData }) {
        Object.assign(data, config.defaults, { ...data });
      }

      get(key: string) {
        return data[key];
      }

      set(key: string, value: unknown) {
        data[key] = value;
      }
    },
  }));

  const mod = await import('../conversationStore');
  return { mod, data };
}

describe('conversationStore metadata repair', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('loads old conversations without pinned or archived metadata', async () => {
    const oldConversation = conversation({ id: 'old' });
    const { mod } = await importConversationStore({ conversations: [oldConversation] });

    expect(mod.listConversations()).toEqual([oldConversation]);
    expect(mod.getConversation('old')).toEqual(oldConversation);
    expect(mod.getConversation('missing')).toBeUndefined();
  });

  it('drops malformed pinned and archived metadata while preserving valid booleans', async () => {
    const { mod, data } = await importConversationStore({
      conversations: [
        { ...conversation({ id: 'bad', updatedAt: 300 }), pinned: 'true', archived: 1 },
        conversation({ id: 'good', pinned: true, archived: false, updatedAt: 200 }),
      ],
    });

    expect(mod.listConversations()).toEqual([
      conversation({ id: 'good', pinned: true, archived: false, updatedAt: 200 }),
      conversation({ id: 'bad', updatedAt: 300 }),
    ]);
    expect(data.conversations).toEqual([
      conversation({ id: 'bad', updatedAt: 300 }),
      conversation({ id: 'good', pinned: true, archived: false, updatedAt: 200 }),
    ]);
  });

  it('preserves valid message errorDetail and drops malformed errorDetail values', async () => {
    const good = message({
      id: 'good-detail',
      role: 'assistant',
      error: 'Friendly error',
      errorDetail: 'HTTP 500: upstream exploded',
    });
    const malformed = {
      ...message({ id: 'bad-detail', role: 'assistant', error: 'Friendly error' }),
      errorDetail: { status: 500 },
    };
    const { mod } = await importConversationStore({
      conversations: [
        {
          ...conversation({ id: 'c1' }),
          messages: [good, malformed],
        },
      ],
    });

    expect(mod.getConversation('c1')?.messages).toEqual([
      good,
      message({ id: 'bad-detail', role: 'assistant', error: 'Friendly error' }),
    ]);
  });

  it('preserves valid provider metadata and drops malformed optional provider metadata', async () => {
    const valid: ChatMessage = {
      id: 'valid-responses',
      role: 'assistant',
      content: 'Found the answer.',
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
    };
    const repaired = message({
      id: 'bad-responses',
      role: 'assistant',
      content: 'Malformed metadata should be removed.',
      createdAt: 101,
    });
    const malformed = {
      ...repaired,
      provider: 'legacy_responses',
      providerResponseId: 42,
      toolEvents: [
        {
          id: 'tool-2',
          type: 'web_search',
          status: 'running',
          title: 'Bad event',
        },
        {
          id: 'tool-3',
          type: 'calculator',
          status: 'completed',
          title: 'Bad tool',
        },
      ],
    };
    const { mod, data } = await importConversationStore({
      conversations: [
        {
          ...conversation({ id: 'c1' }),
          messages: [valid, malformed],
        },
      ],
    });

    expect(mod.getConversation('c1')?.messages).toEqual([valid, repaired]);
    expect((data.conversations as Conversation[])[0].messages).toEqual([valid, repaired]);
  });

  it('lists archived conversations using display sorting so pinned conversations stay first', async () => {
    const { mod } = await importConversationStore({
      conversations: [
        conversation({ id: 'archived-newest', archived: true, updatedAt: 500 }),
        conversation({ id: 'pinned-oldest', pinned: true, updatedAt: 100 }),
        conversation({ id: 'normal', updatedAt: 300 }),
      ],
    });

    expect(mod.listConversations().map((item) => item.id)).toEqual([
      'pinned-oldest',
      'archived-newest',
      'normal',
    ]);
  });
});

describe('conversationStore forkedFrom validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('keeps a valid forkedFrom field untouched on load', async () => {
    const forked = {
      ...conversation({ id: 'fork-1' }),
      forkedFrom: {
        conversationId: 'src-1',
        messageId: 'm2',
        sourceTitle: '原会话',
        messageIndex: 2,
      },
    };
    const { mod, data } = await importConversationStore({ conversations: [forked] });

    expect(mod.getConversation('fork-1')).toEqual(forked);
    expect(data.conversations).toEqual([forked]);
  });

  it('drops a corrupted forkedFrom field while keeping the conversation and its messages', async () => {
    const messages = [
      message({ id: 'm1', role: 'user', status: 'done' }),
      message({ id: 'm2', role: 'assistant', content: 'reply', status: 'done' }),
    ];
    const corrupted = {
      ...conversation({ id: 'fork-bad', messages }),
      forkedFrom: {
        conversationId: 'src-1',
        messageId: 'm2',
        sourceTitle: '原会话',
        messageIndex: '2',
      },
    };
    const { mod, data } = await importConversationStore({ conversations: [corrupted] });

    expect(mod.getConversation('fork-bad')).toEqual(conversation({ id: 'fork-bad', messages }));
    expect(data.conversations).toEqual([conversation({ id: 'fork-bad', messages })]);
  });

  it('loads legacy conversations without forkedFrom unchanged', async () => {
    const legacy = conversation({ id: 'legacy' });
    const { mod, data } = await importConversationStore({ conversations: [legacy] });

    expect(mod.getConversation('legacy')).toEqual(legacy);
    expect(data.conversations).toEqual([legacy]);
  });
});

describe('conversationStore forkConversation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function sourceConversation(): Conversation {
    return conversation({
      id: 'src',
      title: '长对话',
      messages: [
        message({ id: 's0', role: 'system', content: 'be nice', status: 'done' }),
        message({ id: 'm1', role: 'user', content: 'question 1', status: 'done' }),
        {
          ...message({ id: 'm2', role: 'assistant', content: 'answer 1', status: 'done' }),
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          provider: 'responses',
          providerResponseId: 'resp-1',
          toolEvents: [
            { id: 'tool-1', type: 'web_search', status: 'completed', title: 'Web search' },
          ],
        },
        message({ id: 'm3', role: 'user', content: 'question 2', status: 'done' }),
        message({ id: 'm4', role: 'assistant', content: 'streaming…', status: 'streaming' }),
      ],
    });
  }

  it('forks a new conversation with a deep-copied inclusive prefix and fork metadata', async () => {
    const source = sourceConversation();
    const { mod, data } = await importConversationStore({ conversations: [source] });

    const forked = mod.forkConversation('src', 'm2');

    expect(forked.title).toBe('长对话（分叉）');
    expect(forked.messages).toEqual(source.messages.slice(0, 3));
    expect(forked.forkedFrom).toEqual({
      conversationId: 'src',
      messageId: 'm2',
      sourceTitle: '长对话',
      messageIndex: 2,
    });
    // Deep copy: mutating the fork must not touch the source messages.
    forked.messages[2].content = 'mutated';
    forked.messages[2].toolEvents?.push({
      id: 'tool-x',
      type: 'web_search',
      status: 'failed',
      title: 'x',
    });
    expect(mod.getConversation('src')).toEqual(source);
    // Persisted at the head of the list, source untouched.
    expect((data.conversations as Conversation[]).map((c) => c.id)).toEqual([forked.id, 'src']);
    expect(mod.listConversations()[0].id).toBe(forked.id);
  });

  it('copies only messages before the fork point when exclusive is set', async () => {
    const source = sourceConversation();
    const { mod } = await importConversationStore({ conversations: [source] });

    const forked = mod.forkConversation('src', 'm3', { exclusive: true });

    expect(forked.messages).toEqual(source.messages.slice(0, 3));
    expect(forked.forkedFrom).toEqual({
      conversationId: 'src',
      messageId: 'm3',
      sourceTitle: '长对话',
      messageIndex: 3,
    });
  });

  it('produces an empty prefix when forking exclusively at the first visible message', async () => {
    const source = conversation({
      id: 'src',
      title: '短对话',
      messages: [message({ id: 'm1', role: 'user', status: 'done' })],
    });
    const { mod } = await importConversationStore({ conversations: [source] });

    const forked = mod.forkConversation('src', 'm1', { exclusive: true });

    expect(forked.messages).toEqual([]);
    expect(forked.forkedFrom).toEqual({
      conversationId: 'src',
      messageId: 'm1',
      sourceTitle: '短对话',
      messageIndex: 1,
    });
  });

  it('rejects invalid fork points', async () => {
    const source = sourceConversation();
    const { mod } = await importConversationStore({ conversations: [source] });

    expect(() => mod.forkConversation('missing', 'm2')).toThrow('Conversation not found: missing');
    expect(() => mod.forkConversation('src', 'missing')).toThrow('Message not found: missing');
    expect(() => mod.forkConversation('src', 's0')).toThrow(
      'Fork point must be a user or assistant message: s0',
    );
    expect(() => mod.forkConversation('src', 'm4')).toThrow(
      'Fork point message must be done: m4',
    );
    expect(mod.getConversation('src')).toEqual(source);
  });
});

describe('conversationStore metadata updates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
  });

  it('setConversationPinned updates only the selected conversation and refreshes updatedAt', async () => {
    const first = conversation({ id: 'first', updatedAt: 100 });
    const second = conversation({ id: 'second', updatedAt: 200 });
    const { mod, data } = await importConversationStore({ conversations: [first, second] });

    const updated = mod.setConversationPinned('first', true);

    expect(updated).toEqual({ ...first, pinned: true, updatedAt: Date.now() });
    expect(data.conversations).toEqual([{ ...first, pinned: true, updatedAt: Date.now() }, second]);
  });

  it('setConversationArchived updates only the selected conversation and refreshes updatedAt', async () => {
    const first = conversation({ id: 'first', updatedAt: 100 });
    const second = conversation({ id: 'second', updatedAt: 200 });
    const { mod, data } = await importConversationStore({ conversations: [first, second] });

    const updated = mod.setConversationArchived('second', true);

    expect(updated).toEqual({ ...second, archived: true, updatedAt: Date.now() });
    expect(data.conversations).toEqual([first, { ...second, archived: true, updatedAt: Date.now() }]);
  });
});
