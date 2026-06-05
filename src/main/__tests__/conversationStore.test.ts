import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Conversation } from '../../shared/types';

type StoreData = Record<string, unknown>;
type StoreTrace = {
  gets: string[];
  sets: Array<{ key: string; value: unknown }>;
};

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
  const trace: StoreTrace = { gets: [], sets: [] };
  vi.doMock('electron-store', () => ({
    default: class MockStore {
      constructor(config: { defaults?: StoreData }) {
        Object.assign(data, config.defaults, { ...data });
      }

      get(key: string) {
        trace.gets.push(key);
        return data[key];
      }

      set(key: string, value: unknown) {
        trace.sets.push({ key, value });
        data[key] = value;
      }
    },
  }));

  const mod = await import('../conversationStore');
  return { mod, data, trace };
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

  it('caches validated conversations after the first store read', async () => {
    const first = conversation({ id: 'first', updatedAt: 100 });
    const second = conversation({ id: 'second', updatedAt: 200 });
    const { mod, data, trace } = await importConversationStore({ conversations: [first, second] });

    expect(mod.listConversations().map((item) => item.id)).toEqual(['second', 'first']);
    data.conversations = [conversation({ id: 'external', updatedAt: 300 })];

    expect(mod.getConversation('first')).toEqual(first);
    expect(mod.getConversation('external')).toBeUndefined();
    expect(trace.gets).toEqual(['conversations']);
    expect(trace.sets).toEqual([]);
  });

  it('repairs malformed conversations only on first access and keeps using the cache', async () => {
    const repaired = conversation({ id: 'bad' });
    const { mod, data, trace } = await importConversationStore({
      conversations: [{ ...repaired, pinned: 'yes' }],
    });

    expect(mod.listConversations()).toEqual([repaired]);
    expect(data.conversations).toEqual([repaired]);
    expect(mod.getConversation('bad')).toEqual(repaired);
    expect(mod.listConversations()).toEqual([repaired]);
    expect(trace.gets).toEqual(['conversations']);
    expect(trace.sets).toEqual([{ key: 'conversations', value: [repaired] }]);
  });

  it('backs up non-array conversation data before resetting it once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:34:56.789Z'));
    const corrupt = { not: 'an array' };
    const { mod, data, trace } = await importConversationStore({ conversations: corrupt });

    expect(mod.listConversations()).toEqual([]);
    expect(data.conversations).toEqual([]);
    expect(data.conversations_corrupt_1780576496789).toEqual(corrupt);
    expect(mod.getConversation('missing')).toBeUndefined();
    expect(trace.gets).toEqual(['conversations']);
    expect(trace.sets).toEqual([
      { key: 'conversations_corrupt_1780576496789', value: corrupt },
      { key: 'conversations', value: [] },
    ]);
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
