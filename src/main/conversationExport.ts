import type { SaveDialogOptions } from 'electron';
import type { Conversation, ExportResult } from '../shared/types';
import {
  buildConversationExport,
  serializeConversationMarkdown,
} from '../shared/conversationUtils';

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export interface ConversationExportDeps {
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>;
  writeFile(filePath: string, data: string, encoding: BufferEncoding): Promise<void>;
  now(): number;
}

const defaultDeps: ConversationExportDeps = {
  async showSaveDialog(options) {
    const { dialog } = await import('electron');
    return dialog.showSaveDialog(options);
  },
  async writeFile(filePath, data, encoding) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(filePath, data, encoding);
  },
  now: () => Date.now(),
};

export async function exportConversationMarkdown(
  conversation: Conversation,
  deps: ConversationExportDeps = defaultDeps,
): Promise<ExportResult> {
  const result = await deps.showSaveDialog({
    title: 'Export Conversation',
    defaultPath: `${safeFileName(conversation.title || conversation.id)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await deps.writeFile(
    result.filePath,
    serializeConversationMarkdown(conversation),
    'utf-8',
  );
  return { canceled: false, filePath: result.filePath };
}

export async function exportConversationsJson(
  conversations: Conversation[],
  deps: ConversationExportDeps = defaultDeps,
): Promise<ExportResult> {
  const exportedAt = deps.now();
  const result = await deps.showSaveDialog({
    title: 'Export Conversations',
    defaultPath: `qwen-studio-conversations-${formatDateForFileName(exportedAt)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await deps.writeFile(
    result.filePath,
    `${JSON.stringify(buildConversationExport(conversations, exportedAt), null, 2)}\n`,
    'utf-8',
  );
  return { canceled: false, filePath: result.filePath };
}

function safeFileName(value: string): string {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return cleaned || 'conversation';
}

function formatDateForFileName(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[:.]/g, '-');
}
