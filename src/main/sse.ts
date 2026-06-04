import type { ToolEvent, Usage } from '../shared/types';

export interface SSEDataHandlers {
  onData: (data: string) => void;
  onActivity?: () => void;
}

export interface SSEHandlers {
  onDelta: (text: string) => void;
  onUsage?: (usage: Usage) => void;
  onActivity?: () => void;
}

export interface ResponsesSSEHandlers extends SSEHandlers {
  onResponseId?: (responseId: string) => void;
  onToolEvent?: (event: ToolEvent) => void;
}

function mapUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  return {
    promptTokens: readNumber(u.prompt_tokens) ?? readNumber(u.input_tokens) ?? 0,
    completionTokens: readNumber(u.completion_tokens) ?? readNumber(u.output_tokens) ?? 0,
    totalTokens: readNumber(u.total_tokens) ?? 0,
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseJsonObject(data: string): Record<string, unknown> | undefined {
  try {
    const json = JSON.parse(data) as unknown;
    return json && typeof json === 'object' ? json as Record<string, unknown> : undefined;
  } catch {
    // Skip a single malformed chunk rather than aborting the whole stream.
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function dataValue(line: string): string {
  const value = line.slice('data:'.length);
  return value.startsWith(' ') ? value.slice(1) : value;
}

function emitSSEEvent(event: string, handlers: SSEDataHandlers): boolean {
  const data = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map(dataValue)
    .join('\n');
  if (data.length === 0) return false;
  if (data.trim() === '[DONE]') return true;
  handlers.onData(data);
  return false;
}

export async function parseSSEDataStream(
  stream: ReadableStream<Uint8Array>,
  handlers: SSEDataHandlers,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    handlers.onActivity?.();
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      if (emitSSEEvent(event, handlers)) return;
    }
  }

  buffer = buffer.replace(/\r\n/g, '\n').trimEnd();
  if (buffer.length > 0) emitSSEEvent(buffer, handlers);
}

export async function parseChatCompletionsStream(
  stream: ReadableStream<Uint8Array>,
  handlers: SSEHandlers,
): Promise<void> {
  await parseSSEDataStream(stream, {
    onActivity: handlers.onActivity,
    onData: (data) => {
      const json = parseJsonObject(data);
      if (!json) return;

      const choices = Array.isArray(json.choices) ? json.choices : undefined;
      const firstChoice = readRecord(choices?.[0]);
      const deltaObject = readRecord(firstChoice?.delta);
      const delta = deltaObject?.content;
      if (typeof delta === 'string' && delta.length > 0) handlers.onDelta(delta);

      const usage = mapUsage(json.usage);
      if (usage && handlers.onUsage) handlers.onUsage(usage);
    },
  });
}

function statusFromResponsesEvent(eventType: string, status?: string): ToolEvent['status'] | undefined {
  if (status === 'completed' || eventType.endsWith('.completed') || eventType.endsWith('.done')) return 'completed';
  if (status === 'failed' || eventType.endsWith('.failed')) return 'failed';
  if (
    status === 'in_progress' ||
    status === 'searching' ||
    eventType.endsWith('.in_progress') ||
    eventType.endsWith('.searching') ||
    eventType.endsWith('.added')
  ) {
    return 'started';
  }
  return undefined;
}

function detailFromToolPayload(payload: Record<string, unknown>, item?: Record<string, unknown>): string | undefined {
  const error = readRecord(payload.error) ?? readRecord(item?.error);
  return readString(error?.message) ?? readString(payload.detail) ?? readString(item?.detail);
}

function mapResponsesToolEvent(payload: Record<string, unknown>): ToolEvent | undefined {
  const eventType = readString(payload.type) ?? '';
  const item = readRecord(payload.item) ?? readRecord(payload.output_item);
  const itemType = readString(item?.type);
  const isWebSearchEvent = eventType.startsWith('response.web_search_call.');
  const isWebSearchItem = itemType === 'web_search_call';
  if (!isWebSearchEvent && !isWebSearchItem) return undefined;

  const status = statusFromResponsesEvent(eventType, readString(item?.status) ?? readString(payload.status));
  if (!status) return undefined;

  return {
    id: readString(payload.item_id) ?? readString(payload.call_id) ?? readString(payload.id) ?? readString(item?.id) ?? 'web_search',
    type: 'web_search',
    status,
    title: 'Web search',
    detail: detailFromToolPayload(payload, item),
  };
}

export async function parseResponsesStream(
  stream: ReadableStream<Uint8Array>,
  handlers: ResponsesSSEHandlers,
): Promise<void> {
  await parseSSEDataStream(stream, {
    onActivity: handlers.onActivity,
    onData: (data) => {
      const json = parseJsonObject(data);
      if (!json) return;

      const eventType = readString(json.type);
      if (eventType === 'response.output_text.delta') {
        const delta = readString(json.delta);
        if (delta) handlers.onDelta(delta);
        return;
      }

      if (eventType === 'response.completed') {
        const response = readRecord(json.response);
        const responseId = readString(response?.id) ?? readString(json.response_id) ?? readString(json.id);
        if (responseId) handlers.onResponseId?.(responseId);

        const usage = mapUsage(response?.usage ?? json.usage);
        if (usage && handlers.onUsage) handlers.onUsage(usage);
        return;
      }

      const toolEvent = mapResponsesToolEvent(json);
      if (toolEvent) handlers.onToolEvent?.(toolEvent);
    },
  });
}

export async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  handlers: SSEHandlers,
): Promise<void> {
  await parseChatCompletionsStream(stream, handlers);
}
