import type { ChatMessage, Conversation, ConversationExport, UsageSummary } from './types';

export function summarizeUsage(messages: ChatMessage[]): UsageSummary {
  return messages.reduce<UsageSummary>(
    (summary, message) => {
      if (!message.usage) {
        return summary;
      }

      return {
        promptTokens: summary.promptTokens + message.usage.promptTokens,
        completionTokens: summary.completionTokens + message.usage.completionTokens,
        totalTokens: summary.totalTokens + message.usage.totalTokens,
        messageCount: summary.messageCount + 1,
      };
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      messageCount: 0,
    },
  );
}

export function sortConversationsForDisplay(
  conversations: Conversation[],
  options: { includeArchived?: boolean } = {},
): Conversation[] {
  const visible = options.includeArchived
    ? [...conversations]
    : conversations.filter((conversation) => !isArchived(conversation));

  return visible.sort((left, right) => {
    const pinnedDelta = Number(isPinned(right)) - Number(isPinned(left));
    if (pinnedDelta !== 0) {
      return pinnedDelta;
    }

    return right.updatedAt - left.updatedAt;
  });
}

export function filterConversations(
  conversations: Conversation[],
  options: { filter: 'all' | 'pinned' | 'archived'; query?: string },
): Conversation[] {
  const includeArchived = options.filter === 'archived';
  const sorted = sortConversationsForDisplay(conversations, { includeArchived });

  const filtered = sorted.filter((conversation) => {
    if (options.filter === 'pinned') {
      return isPinned(conversation) && !isArchived(conversation);
    }

    if (options.filter === 'archived') {
      return isArchived(conversation);
    }

    return !isArchived(conversation);
  });

  return searchConversations(filtered, options.query ?? '');
}

export function searchConversations(conversations: Conversation[], query: string): Conversation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return conversations;
  }

  return conversations.filter((conversation) => {
    if (conversation.title.toLocaleLowerCase().includes(normalizedQuery)) {
      return true;
    }

    return conversation.messages.some((message) =>
      message.content.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
}

export function serializeConversationMarkdown(conversation: Conversation): string {
  const lines = [
    `# ${conversation.title}`,
    '',
    `ID: ${conversation.id}`,
    `Created: ${formatTimestamp(conversation.createdAt)}`,
    `Updated: ${formatTimestamp(conversation.updatedAt)}`,
  ];

  if (conversation.forkedFrom) {
    lines.push(
      '',
      `> 分叉自 ${conversation.forkedFrom.sourceTitle} 第 ${conversation.forkedFrom.messageIndex} 条`,
    );
  }

  const summary = summarizeUsage(conversation.messages);
  if (summary.messageCount > 0) {
    lines.push(
      `Usage: prompt ${summary.promptTokens}, completion ${summary.completionTokens}, total ${summary.totalTokens}`,
    );
  }

  for (const message of conversation.messages) {
    lines.push('', `## ${formatRole(message.role)}`, '', `Created: ${formatTimestamp(message.createdAt)}`);

    if (message.usage) {
      lines.push(
        `Usage: prompt ${message.usage.promptTokens}, completion ${message.usage.completionTokens}, total ${message.usage.totalTokens}`,
      );
    }

    lines.push('', message.content);
  }

  return `${lines.join('\n')}\n`;
}

export function buildConversationExport(
  conversations: Conversation[],
  exportedAt: number = Date.now(),
): ConversationExport {
  return {
    version: 1,
    exportedAt,
    conversations,
  };
}

function formatRole(role: ChatMessage['role']): string {
  return role.charAt(0).toLocaleUpperCase() + role.slice(1);
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function isPinned(conversation: Conversation): boolean {
  return conversation.pinned === true;
}

function isArchived(conversation: Conversation): boolean {
  return conversation.archived === true;
}
