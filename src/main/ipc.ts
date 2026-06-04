import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  getSettings,
  saveSettings,
  setApiKey,
  getApiKey,
  hasApiKey,
} from './settingsStore';
import * as convo from './conversationStore';
import {
  exportConversationMarkdown,
  exportConversationsJson,
} from './conversationExport';
import { defaultProvider } from './llmProvider';
import { testQwenConnection } from './qwenService';
import {
  hasUnresolvedBaseUrlTemplate,
  type ChatStreamRequest,
  type ChatMessage,
  type ApiMode,
  type BuiltInTool,
  type ToolEvent,
} from '../shared/types';
import type { SettingsPatch } from '../shared/api';
import { normalizeExternalUrl } from '../shared/externalLinks';
import { sanitizeDiagnosticDetail } from '../shared/diagnostics';

interface StreamControllerEntry {
  senderId: number;
  requestId: string;
  controller: AbortController;
}

const controllers = new Map<string, StreamControllerEntry>();
const CHAT_ROLES = ['system', 'user', 'assistant'] as const;
const MESSAGE_STATUSES = ['pending', 'streaming', 'done', 'error'] as const;
const API_MODES = ['chat_completions', 'responses'] as const;
const BUILT_IN_TOOLS = ['web_search'] as const;
const TOOL_STATUSES = ['started', 'completed', 'failed'] as const;

let registered = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isChatRole(value: unknown): value is ChatMessage['role'] {
  return typeof value === 'string' && CHAT_ROLES.includes(value as ChatMessage['role']);
}

function isMessageStatus(value: unknown): value is NonNullable<ChatMessage['status']> {
  return (
    typeof value === 'string' &&
    MESSAGE_STATUSES.includes(value as NonNullable<ChatMessage['status']>)
  );
}

function isApiMode(value: unknown): value is ApiMode {
  return typeof value === 'string' && API_MODES.includes(value as ApiMode);
}

function isBuiltInTool(value: unknown): value is BuiltInTool {
  return typeof value === 'string' && BUILT_IN_TOOLS.includes(value as BuiltInTool);
}

function isToolStatus(value: unknown): value is ToolEvent['status'] {
  return typeof value === 'string' && TOOL_STATUSES.includes(value as ToolEvent['status']);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }

  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a string`);
  }

  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (text.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }

  return text;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${field} must be a boolean`);
  }

  return value;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (!isFiniteNumber(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }

  return value;
}

function validateSettingsPatch(value: unknown): SettingsPatch {
  const input = requireRecord(value, 'settings patch');
  const patch: SettingsPatch = {};

  if (hasOwn(input, 'baseUrl') && input.baseUrl !== undefined) {
    const baseUrl = requireString(input.baseUrl, 'baseUrl').trim();
    if (baseUrl) patch.baseUrl = baseUrl;
  }
  if (hasOwn(input, 'model') && input.model !== undefined) {
    const model = requireString(input.model, 'model').trim();
    if (model) patch.model = model;
  }
  if (hasOwn(input, 'systemPrompt') && input.systemPrompt !== undefined) {
    patch.systemPrompt = requireString(input.systemPrompt, 'systemPrompt');
  }
  if (hasOwn(input, 'temperature') && input.temperature !== undefined) {
    patch.temperature = requireFiniteNumber(input.temperature, 'temperature');
  }
  if (hasOwn(input, 'apiKey') && input.apiKey !== undefined) {
    const apiKey = requireString(input.apiKey, 'apiKey').trim();
    if (apiKey) patch.apiKey = apiKey;
  }

  return patch;
}

function validateOptionalSettingsPatch(value: unknown): SettingsPatch {
  return value === undefined ? {} : validateSettingsPatch(value);
}

function validateUsage(
  value: unknown,
  field: string,
): NonNullable<ChatMessage['usage']> {
  const input = requireRecord(value, field);

  return {
    promptTokens: requireFiniteNumber(input.promptTokens, `${field}.promptTokens`),
    completionTokens: requireFiniteNumber(input.completionTokens, `${field}.completionTokens`),
    totalTokens: requireFiniteNumber(input.totalTokens, `${field}.totalTokens`),
  };
}

function validateToolEvent(value: unknown, field: string): ToolEvent {
  const input = requireRecord(value, field);

  if (!isBuiltInTool(input.type)) {
    throw new TypeError(`${field}.type must be web_search`);
  }
  if (!isToolStatus(input.status)) {
    throw new TypeError(`${field}.status must be started, completed, or failed`);
  }

  const event: ToolEvent = {
    id: requireString(input.id, `${field}.id`),
    type: input.type,
    status: input.status,
    title: requireString(input.title, `${field}.title`),
  };

  if (hasOwn(input, 'detail') && input.detail !== undefined) {
    event.detail = requireString(input.detail, `${field}.detail`);
  }

  return event;
}

function validateToolEvents(value: unknown, field: string): ToolEvent[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }

  return value.map((event, index) => validateToolEvent(event, `${field}[${index}]`));
}

function validateChatMessage(value: unknown, field: string): ChatMessage {
  const input = requireRecord(value, field);

  if (!isChatRole(input.role)) {
    throw new TypeError(`${field}.role must be system, user, or assistant`);
  }

  const message: ChatMessage = {
    id: requireString(input.id, `${field}.id`),
    role: input.role,
    content: requireString(input.content, `${field}.content`),
    createdAt: requireFiniteNumber(input.createdAt, `${field}.createdAt`),
  };

  if (hasOwn(input, 'status') && input.status !== undefined) {
    if (!isMessageStatus(input.status)) {
      throw new TypeError(`${field}.status must be pending, streaming, done, or error`);
    }
    message.status = input.status;
  }
  if (hasOwn(input, 'aborted') && input.aborted !== undefined) {
    if (typeof input.aborted !== 'boolean') {
      throw new TypeError(`${field}.aborted must be a boolean`);
    }
    message.aborted = input.aborted;
  }
  if (hasOwn(input, 'error') && input.error !== undefined) {
    message.error = requireString(input.error, `${field}.error`);
  }
  if (hasOwn(input, 'errorDetail') && input.errorDetail !== undefined) {
    message.errorDetail = sanitizeDiagnosticDetail(
      requireString(input.errorDetail, `${field}.errorDetail`),
    );
  }
  if (hasOwn(input, 'usage') && input.usage !== undefined) {
    message.usage = validateUsage(input.usage, `${field}.usage`);
  }
  if (hasOwn(input, 'provider') && input.provider !== undefined) {
    if (!isApiMode(input.provider)) {
      throw new TypeError(`${field}.provider must be chat_completions or responses`);
    }
    message.provider = input.provider;
  }
  if (hasOwn(input, 'providerResponseId') && input.providerResponseId !== undefined) {
    message.providerResponseId = requireString(
      input.providerResponseId,
      `${field}.providerResponseId`,
    );
  }
  if (hasOwn(input, 'toolEvents') && input.toolEvents !== undefined) {
    message.toolEvents = validateToolEvents(input.toolEvents, `${field}.toolEvents`);
  }

  return message;
}

function validateChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    throw new TypeError('messages must be an array');
  }

  return value.map((message, index) => validateChatMessage(message, `messages[${index}]`));
}

function validateStreamMessage(
  value: unknown,
  field: string,
): ChatStreamRequest['messages'][number] {
  const input = requireRecord(value, field);

  if (!isChatRole(input.role)) {
    throw new TypeError(`${field}.role must be system, user, or assistant`);
  }

  return {
    role: input.role,
    content: requireString(input.content, `${field}.content`),
  };
}

function validateStreamMessages(value: unknown): ChatStreamRequest['messages'] {
  if (!Array.isArray(value)) {
    throw new TypeError('messages must be an array');
  }

  return value.map((message, index) => validateStreamMessage(message, `messages[${index}]`));
}

function validateApiMode(value: unknown, field: string): ApiMode {
  if (!isApiMode(value)) {
    throw new TypeError(`${field} must be chat_completions or responses`);
  }

  return value;
}

function validateBuiltInTools(value: unknown): BuiltInTool[] {
  if (!Array.isArray(value)) {
    throw new TypeError('tools must be an array');
  }

  return value.map((tool, index) => {
    if (!isBuiltInTool(tool)) {
      throw new TypeError(`tools[${index}] must be web_search`);
    }
    return tool;
  });
}

function validateChatStreamRequest(value: unknown): ChatStreamRequest {
  const input = requireRecord(value, 'chat stream request');
  const request: ChatStreamRequest = {
    requestId: requireNonEmptyString(input.requestId, 'requestId'),
    conversationId: requireNonEmptyString(input.conversationId, 'conversationId'),
    messages: validateStreamMessages(input.messages),
  };

  if (hasOwn(input, 'model') && input.model !== undefined) {
    request.model = requireString(input.model, 'model');
  }
  if (hasOwn(input, 'temperature') && input.temperature !== undefined) {
    request.temperature = requireFiniteNumber(input.temperature, 'temperature');
  }
  if (hasOwn(input, 'apiMode') && input.apiMode !== undefined) {
    request.apiMode = validateApiMode(input.apiMode, 'apiMode');
  }
  if (hasOwn(input, 'tools') && input.tools !== undefined) {
    request.tools = validateBuiltInTools(input.tools);
  }
  if (hasOwn(input, 'previousResponseId') && input.previousResponseId !== undefined) {
    request.previousResponseId = requireNonEmptyString(
      input.previousResponseId,
      'previousResponseId',
    );
  }

  return request;
}

function getUsableRequestId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.requestId === 'string' && value.requestId.length > 0
    ? value.requestId
    : undefined;
}

function controllerKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`;
}

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload);
  }
}

function detailFromError(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.detail === 'string' ? sanitizeDiagnosticDetail(error.detail) : undefined;
}

function isDifferentBaseUrl(candidate: string | undefined, saved: string): boolean {
  return candidate !== undefined && candidate.trim() !== saved.trim();
}

export function registerIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, rawPatch: unknown) => {
    const { apiKey, ...rest } = validateSettingsPatch(rawPatch);
    if (typeof apiKey === 'string') setApiKey(apiKey);
    saveSettings(rest);
  });
  ipcMain.handle('settings:hasApiKey', () => hasApiKey());
  ipcMain.handle('diagnostics:testConnection', async (_event, rawPatch?: unknown) => {
    const { apiKey: patchApiKey, ...settingsPatch } = validateOptionalSettingsPatch(rawPatch);
    const savedSettings = getSettings();
    const settings = { ...savedSettings, ...settingsPatch };
    const hasTemporaryApiKey = typeof patchApiKey === 'string' && patchApiKey.length > 0;
    const apiKey = (patchApiKey ?? getApiKey()).trim();

    if (isDifferentBaseUrl(settingsPatch.baseUrl, savedSettings.baseUrl) && !hasTemporaryApiKey) {
      return {
        ok: false,
        category: 'config',
        message: 'Testing an unsaved Base URL requires a temporary API key.',
      };
    }

    if (!apiKey) {
      return {
        ok: false,
        category: 'missing_key',
        message: 'No API key is configured. Save an API key or enter one temporarily.',
      };
    }

    if (hasUnresolvedBaseUrlTemplate(settings.baseUrl)) {
      return {
        ok: false,
        category: 'config',
        message: 'Base URL still contains an unresolved template placeholder.',
        detail: sanitizeDiagnosticDetail(settings.baseUrl),
      };
    }

    return testQwenConnection({
      apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
    });
  });

  ipcMain.handle('shell:openExternal', (_event, rawUrl: unknown) => {
    const url = normalizeExternalUrl(requireString(rawUrl, 'url'));
    if (!url) {
      throw new TypeError('url must be an absolute http(s) URL');
    }

    return shell.openExternal(url);
  });

  ipcMain.handle('convo:list', () => convo.listConversations());
  ipcMain.handle('convo:create', (_e, rawTitle?: unknown) => {
    const title = rawTitle === undefined ? undefined : requireString(rawTitle, 'title');
    return convo.createConversation(title);
  });
  ipcMain.handle('convo:rename', (_e, rawId: unknown, rawTitle: unknown) => {
    const id = requireNonEmptyString(rawId, 'id');
    const title = requireString(rawTitle, 'title');
    return convo.renameConversation(id, title);
  });
  ipcMain.handle('convo:delete', (_e, rawId: unknown) =>
    convo.deleteConversation(requireNonEmptyString(rawId, 'id')),
  );
  ipcMain.handle('convo:saveMessages', (_e, rawId: unknown, rawMessages: unknown) => {
    const id = requireNonEmptyString(rawId, 'id');
    const messages = validateChatMessages(rawMessages);
    return convo.saveMessages(id, messages);
  });
  ipcMain.handle('convo:setPinned', (_e, rawId: unknown, rawPinned: unknown) => {
    const id = requireNonEmptyString(rawId, 'id');
    const pinned = requireBoolean(rawPinned, 'pinned');
    return convo.setConversationPinned(id, pinned);
  });
  ipcMain.handle('convo:setArchived', (_e, rawId: unknown, rawArchived: unknown) => {
    const id = requireNonEmptyString(rawId, 'id');
    const archived = requireBoolean(rawArchived, 'archived');
    return convo.setConversationArchived(id, archived);
  });
  ipcMain.handle('convo:exportMarkdown', (_e, rawId: unknown) => {
    const id = requireNonEmptyString(rawId, 'id');
    const conversation = convo.getConversation(id);
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`);
    }

    return exportConversationMarkdown(conversation);
  });
  ipcMain.handle('convo:exportJson', () => exportConversationsJson(convo.listConversations()));

  ipcMain.handle('chat:stream', async (event: IpcMainInvokeEvent, rawPayload: unknown) => {
    let payload: ChatStreamRequest;
    try {
      payload = validateChatStreamRequest(rawPayload);
    } catch (err) {
      const requestId = getUsableRequestId(rawPayload);
      if (!requestId) throw err;

      const message = err instanceof Error ? err.message : '请求参数无效。';
      safeSend(event.sender, 'chat:error', { requestId, message });
      return;
    }

    const settings = getSettings();
    const apiKey = getApiKey();
    if (!apiKey) {
      safeSend(event.sender, 'chat:error', {
        requestId: payload.requestId,
        message: '请先在设置里配置 API Key。',
      });
      return;
    }

    const key = controllerKey(event.sender.id, payload.requestId);
    if (controllers.has(key)) {
      safeSend(event.sender, 'chat:error', {
        requestId: payload.requestId,
        message: '已有相同请求正在进行。',
      });
      return;
    }

    const controller = new AbortController();
    const entry: StreamControllerEntry = {
      senderId: event.sender.id,
      requestId: payload.requestId,
      controller,
    };
    const onDestroyed = (): void => controller.abort();
    controllers.set(key, entry);
    event.sender.once('destroyed', onDestroyed);

    try {
      const apiMode = payload.apiMode ?? 'chat_completions';
      const streamInput = {
        apiKey,
        baseUrl: settings.baseUrl,
        model: payload.model || settings.model,
        temperature: payload.temperature ?? settings.temperature,
        messages: payload.messages,
        apiMode,
        signal: controller.signal,
        onDelta: (text) =>
          safeSend(event.sender, 'chat:delta', { requestId: payload.requestId, text }),
        onUsage: (usage) =>
          safeSend(event.sender, 'chat:usage', { requestId: payload.requestId, usage }),
        onResponseId: (responseId) =>
          safeSend(event.sender, 'chat:response', {
            requestId: payload.requestId,
            responseId,
          }),
        onToolEvent: (toolEvent) =>
          safeSend(event.sender, 'chat:tool', {
            requestId: payload.requestId,
            event: toolEvent,
          }),
        ...(apiMode === 'responses' && payload.tools ? { tools: payload.tools } : {}),
        ...(apiMode === 'responses' && payload.previousResponseId
          ? { previousResponseId: payload.previousResponseId }
          : {}),
      } satisfies Parameters<typeof defaultProvider.streamTurn>[0];

      await defaultProvider.streamTurn(streamInput);
      safeSend(event.sender, 'chat:done', { requestId: payload.requestId });
    } catch (err) {
      if (controller.signal.aborted) {
        safeSend(event.sender, 'chat:done', { requestId: payload.requestId, aborted: true });
      } else {
        const message = err instanceof Error ? err.message : '未知错误';
        safeSend(event.sender, 'chat:error', {
          requestId: payload.requestId,
          message,
          detail: detailFromError(err),
        });
      }
    } finally {
      if (!event.sender.isDestroyed()) {
        event.sender.off('destroyed', onDestroyed);
      }
      if (controllers.get(key)?.controller === controller) {
        controllers.delete(key);
      }
    }
  });

  ipcMain.handle('chat:abort', (event, rawRequestId: unknown) => {
    const requestId = requireNonEmptyString(rawRequestId, 'requestId');
    const key = controllerKey(event.sender.id, requestId);
    controllers.get(key)?.controller.abort();
    controllers.delete(key);
  });
}
