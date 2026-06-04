import { describe, expect, it } from 'vitest';
import type { ChatMessage, Conversation } from '../types';
import {
  buildConversationExport,
  filterConversations,
  searchConversations,
  serializeConversationMarkdown,
  sortConversationsForDisplay,
  summarizeUsage,
} from '../conversationUtils';

const message = (
  id: string,
  role: ChatMessage['role'],
  content: string,
  createdAt: number,
  usage?: ChatMessage['usage'],
): ChatMessage => ({
  id,
  role,
  content,
  createdAt,
  ...(usage ? { usage } : {}),
});

const conversation = (overrides: Partial<Conversation> & Pick<Conversation, 'id'>): Conversation => ({
  id: overrides.id,
  title: overrides.title ?? `Conversation ${overrides.id}`,
  messages: overrides.messages ?? [],
  createdAt: overrides.createdAt ?? 1_700_000_000_000,
  updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
  ...(overrides.pinned === undefined ? {} : { pinned: overrides.pinned }),
  ...(overrides.archived === undefined ? {} : { archived: overrides.archived }),
});

describe('sortConversationsForDisplay', () => {
  it('sorts pinned conversations first and then by updatedAt descending while hiding archived conversations by default', () => {
    const conversations = [
      conversation({ id: 'older-pinned', pinned: true, updatedAt: 200 }),
      conversation({ id: 'newer-unpinned', updatedAt: 400 }),
      conversation({ id: 'newer-pinned', pinned: true, updatedAt: 300 }),
      conversation({ id: 'archived', archived: true, pinned: true, updatedAt: 500 }),
    ];

    expect(sortConversationsForDisplay(conversations).map((item) => item.id)).toEqual([
      'newer-pinned',
      'older-pinned',
      'newer-unpinned',
    ]);
  });

  it('includes archived conversations when requested', () => {
    const conversations = [
      conversation({ id: 'visible', updatedAt: 100 }),
      conversation({ id: 'archived', archived: true, updatedAt: 200 }),
    ];

    expect(
      sortConversationsForDisplay(conversations, { includeArchived: true }).map((item) => item.id),
    ).toEqual(['archived', 'visible']);
  });

  it('only treats strict true pinned and archived values as enabled', () => {
    const conversations = [
      {
        ...conversation({ id: 'malformed-pinned', updatedAt: 100 }),
        pinned: 'true',
      },
      {
        ...conversation({ id: 'malformed-archived', updatedAt: 200 }),
        archived: 'true',
      },
      conversation({ id: 'strict-pinned', pinned: true, updatedAt: 50 }),
    ] as unknown as Conversation[];

    expect(sortConversationsForDisplay(conversations).map((item) => item.id)).toEqual([
      'strict-pinned',
      'malformed-archived',
      'malformed-pinned',
    ]);
  });
});

describe('filterConversations', () => {
  it('returns sorted non-archived conversations for the all filter', () => {
    const conversations = [
      conversation({ id: 'archived', archived: true, updatedAt: 300 }),
      conversation({ id: 'unpinned', updatedAt: 200 }),
      conversation({ id: 'pinned', pinned: true, updatedAt: 100 }),
    ];

    expect(filterConversations(conversations, { filter: 'all' }).map((item) => item.id)).toEqual([
      'pinned',
      'unpinned',
    ]);
  });

  it('returns only pinned non-archived conversations for the pinned filter', () => {
    const conversations = [
      conversation({ id: 'archived-pinned', archived: true, pinned: true, updatedAt: 300 }),
      conversation({ id: 'pinned', pinned: true, updatedAt: 200 }),
      conversation({ id: 'unpinned', updatedAt: 100 }),
    ];

    expect(filterConversations(conversations, { filter: 'pinned' }).map((item) => item.id)).toEqual([
      'pinned',
    ]);
  });

  it('returns only archived conversations for the archived filter', () => {
    const conversations = [
      conversation({ id: 'archived-old', archived: true, updatedAt: 100 }),
      conversation({ id: 'visible', updatedAt: 300 }),
      conversation({ id: 'archived-new', archived: true, updatedAt: 200 }),
    ];

    expect(filterConversations(conversations, { filter: 'archived' }).map((item) => item.id)).toEqual([
      'archived-new',
      'archived-old',
    ]);
  });

  it('applies the query within the selected filter', () => {
    const conversations = [
      conversation({ id: 'archived-match', archived: true, title: 'billing notes' }),
      conversation({ id: 'visible-match', title: 'Billing plan' }),
      conversation({ id: 'visible-miss', title: 'Roadmap' }),
    ];

    expect(
      filterConversations(conversations, { filter: 'all', query: 'bill' }).map((item) => item.id),
    ).toEqual(['visible-match']);
  });

  it('does not treat malformed pinned or archived values as true while filtering', () => {
    const conversations = [
      {
        ...conversation({ id: 'malformed-pinned', title: 'Malformed pinned', updatedAt: 300 }),
        pinned: 'true',
      },
      {
        ...conversation({ id: 'malformed-archived', title: 'Malformed archived', updatedAt: 200 }),
        archived: 'true',
      },
      conversation({ id: 'strict-pinned', pinned: true, title: 'Strict pinned', updatedAt: 100 }),
      conversation({ id: 'strict-archived', archived: true, title: 'Strict archived', updatedAt: 400 }),
    ] as unknown as Conversation[];

    expect(filterConversations(conversations, { filter: 'all' }).map((item) => item.id)).toEqual([
      'strict-pinned',
      'malformed-pinned',
      'malformed-archived',
    ]);
    expect(filterConversations(conversations, { filter: 'pinned' }).map((item) => item.id)).toEqual([
      'strict-pinned',
    ]);
    expect(filterConversations(conversations, { filter: 'archived' }).map((item) => item.id)).toEqual([
      'strict-archived',
    ]);
  });
});

describe('searchConversations', () => {
  it('matches titles case-insensitively', () => {
    const conversations = [
      conversation({ id: 'match', title: 'Qwen Release Notes' }),
      conversation({ id: 'miss', title: 'Other topic' }),
    ];

    expect(searchConversations(conversations, 'qwen').map((item) => item.id)).toEqual(['match']);
  });

  it('matches message content case-insensitively', () => {
    const conversations = [
      conversation({
        id: 'match',
        title: 'Planning',
        messages: [message('m1', 'assistant', 'The next step mentions Token Accounting.', 100)],
      }),
      conversation({
        id: 'miss',
        title: 'Planning',
        messages: [message('m2', 'user', 'No relevant phrase here.', 100)],
      }),
    ];

    expect(searchConversations(conversations, 'token accounting').map((item) => item.id)).toEqual([
      'match',
    ]);
  });

  it('returns the original list for a blank query', () => {
    const conversations = [conversation({ id: 'one' }), conversation({ id: 'two' })];

    expect(searchConversations(conversations, '   ')).toEqual(conversations);
  });
});

describe('summarizeUsage', () => {
  it('sums token usage and ignores messages without usage', () => {
    expect(
      summarizeUsage([
        message('m1', 'user', 'Hello', 100),
        message('m2', 'assistant', 'Hi', 200, {
          promptTokens: 3,
          completionTokens: 5,
          totalTokens: 8,
        }),
        message('m3', 'assistant', 'More', 300, {
          promptTokens: 7,
          completionTokens: 11,
          totalTokens: 18,
        }),
      ]),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 16,
      totalTokens: 26,
      messageCount: 2,
    });
  });
});

describe('serializeConversationMarkdown', () => {
  it('includes title, ISO timestamps, role headings, content, and usage', () => {
    const markdown = serializeConversationMarkdown(
      conversation({
        id: 'export-me',
        title: 'Export Me',
        createdAt: Date.UTC(2026, 5, 4, 10, 0, 0),
        updatedAt: Date.UTC(2026, 5, 4, 10, 5, 0),
        messages: [
          message('m1', 'user', 'Hello **Qwen**', Date.UTC(2026, 5, 4, 10, 1, 0)),
          message('m2', 'assistant', 'Hi there', Date.UTC(2026, 5, 4, 10, 2, 0), {
            promptTokens: 12,
            completionTokens: 8,
            totalTokens: 20,
          }),
        ],
      }),
    );

    expect(markdown).toContain('# Export Me');
    expect(markdown).toContain('Created: 2026-06-04T10:00:00.000Z');
    expect(markdown).toContain('Updated: 2026-06-04T10:05:00.000Z');
    expect(markdown).toContain('## User');
    expect(markdown).toContain('Hello **Qwen**');
    expect(markdown).toContain('## Assistant');
    expect(markdown).toContain('Hi there');
    expect(markdown).toContain('Usage: prompt 12, completion 8, total 20');
  });
});

describe('buildConversationExport', () => {
  it('builds a versioned JSON export envelope', () => {
    const conversations = [conversation({ id: 'one' }), conversation({ id: 'two' })];

    expect(buildConversationExport(conversations, 1_800_000_000_000)).toEqual({
      version: 1,
      exportedAt: 1_800_000_000_000,
      conversations,
    });
  });
});
