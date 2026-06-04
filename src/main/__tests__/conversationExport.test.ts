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
});
