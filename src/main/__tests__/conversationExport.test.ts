import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '../../shared/types';
import {
  exportConversationMarkdown,
  exportConversationsJson,
  type ConversationExportDeps,
} from '../conversationExport';

function conversation(overrides: Partial<Conversation> & Pick<Conversation, 'id'>): Conversation {
  return {
    id: overrides.id,
    title: overrides.title ?? `Conversation ${overrides.id}`,
    messages: overrides.messages ?? [],
    createdAt: overrides.createdAt ?? Date.UTC(2026, 5, 4, 10, 0, 0),
    updatedAt: overrides.updatedAt ?? Date.UTC(2026, 5, 4, 10, 5, 0),
    ...(overrides.pinned === undefined ? {} : { pinned: overrides.pinned }),
    ...(overrides.archived === undefined ? {} : { archived: overrides.archived }),
    ...(overrides.forkedFrom === undefined ? {} : { forkedFrom: overrides.forkedFrom }),
  };
}

function deps(
  result: { canceled: boolean; filePath?: string },
  now = Date.UTC(2026, 5, 4, 11, 0, 0),
): ConversationExportDeps {
  return {
    showSaveDialog: vi.fn(async () => result),
    writeFile: vi.fn(async () => undefined),
    now: vi.fn(() => now),
  };
}

describe('exportConversationMarkdown', () => {
  it('returns canceled without writing when the save dialog is canceled', async () => {
    const testDeps = deps({ canceled: true });

    await expect(
      exportConversationMarkdown(conversation({ id: 'c1', title: 'Export Me' }), testDeps),
    ).resolves.toEqual({ canceled: true });
    expect(testDeps.writeFile).not.toHaveBeenCalled();
  });

  it('serializes a single conversation to Markdown at the dialog-selected path', async () => {
    const testDeps = deps({ canceled: false, filePath: '/tmp/export.md' });

    await expect(
      exportConversationMarkdown(
        conversation({
          id: 'c1',
          title: 'Export Me',
          messages: [{ id: 'm1', role: 'user', content: 'Hello', createdAt: 100 }],
        }),
        testDeps,
      ),
    ).resolves.toEqual({ canceled: false, filePath: '/tmp/export.md' });

    expect(testDeps.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringContaining('Export Me.md'),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      }),
    );
    expect(testDeps.writeFile).toHaveBeenCalledWith(
      '/tmp/export.md',
      expect.stringContaining('# Export Me'),
      'utf-8',
    );
  });

  it('adds a fork-origin note to the Markdown header for forked conversations', async () => {
    const testDeps = deps({ canceled: false, filePath: '/tmp/forked.md' });

    await exportConversationMarkdown(
      conversation({
        id: 'c2',
        title: '排错记录（分叉）',
        messages: [{ id: 'm1', role: 'user', content: 'Hello', createdAt: 100, status: 'done' }],
        forkedFrom: {
          conversationId: 'c1',
          messageId: 'm-source',
          sourceTitle: '排错记录',
          messageIndex: 10,
        },
      }),
      testDeps,
    );

    expect(testDeps.writeFile).toHaveBeenCalledWith(
      '/tmp/forked.md',
      expect.stringContaining('> 分叉自 排错记录 第 10 条'),
      'utf-8',
    );
  });

  it('omits the fork-origin note for conversations without forkedFrom', async () => {
    const testDeps = deps({ canceled: false, filePath: '/tmp/plain.md' });

    await exportConversationMarkdown(conversation({ id: 'c1', title: 'Plain' }), testDeps);

    const written = vi.mocked(testDeps.writeFile).mock.calls[0][1];
    expect(written).not.toContain('分叉自');
  });
});

describe('exportConversationsJson', () => {
  it('serializes all conversations as a versioned JSON envelope', async () => {
    const testDeps = deps({ canceled: false, filePath: '/tmp/conversations.json' });
    const conversations = [conversation({ id: 'one' }), conversation({ id: 'two', pinned: true })];

    await expect(exportConversationsJson(conversations, testDeps)).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/conversations.json',
    });

    expect(testDeps.writeFile).toHaveBeenCalledWith(
      '/tmp/conversations.json',
      `${JSON.stringify(
        {
          version: 1,
          exportedAt: Date.UTC(2026, 5, 4, 11, 0, 0),
          conversations,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
  });

  it('carries forkedFrom through the JSON export with envelope version 1', async () => {
    const testDeps = deps({ canceled: false, filePath: '/tmp/forked.json' });
    const forked = conversation({
      id: 'fork',
      forkedFrom: {
        conversationId: 'origin',
        messageId: 'm-source',
        sourceTitle: '原会话',
        messageIndex: 3,
      },
    });

    await exportConversationsJson([forked], testDeps);

    const written = vi.mocked(testDeps.writeFile).mock.calls[0][1];
    const parsed = JSON.parse(written) as {
      version: number;
      conversations: Conversation[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.conversations[0].forkedFrom).toEqual({
      conversationId: 'origin',
      messageId: 'm-source',
      sourceTitle: '原会话',
      messageIndex: 3,
    });
  });
});
