import type { ChatRole, Usage } from '../shared/types';
import { parseSSEStream } from './sse';

export interface QwenMessage {
  role: ChatRole;
  content: string;
}

export interface StreamChatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: QwenMessage[];
  temperature?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onUsage?: (usage: Usage) => void;
  fetchImpl?: typeof fetch;
}

export class QwenApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(friendlyMessage(status, body));
    this.name = 'QwenApiError';
    this.status = status;
  }
}

export function buildEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export function buildRequestBody(o: {
  model: string;
  messages: QwenMessage[];
  temperature: number;
}) {
  return {
    model: o.model,
    messages: o.messages,
    temperature: o.temperature,
    stream: true,
    stream_options: { include_usage: true },
  };
}

function truncate(s: string, n = 200): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function friendlyMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或无权限，请检查设置里的 API Key。';
  if (status === 404) return '接口或模型不存在，请检查 Base URL 和模型名。';
  if (status === 400) return `请求被拒绝（400），可能是模型名或参数有误。${truncate(body)}`;
  if (status === 429) return '请求过于频繁或额度不足（429），请稍后再试。';
  if (status >= 500) return `服务端错误（${status}），请稍后再试。`;
  return `请求失败（${status}）。${truncate(body)}`;
}

export async function streamQwenChat(options: StreamChatOptions): Promise<void> {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    temperature = 0.7,
    signal,
    onDelta,
    onUsage,
  } = options;
  const doFetch = options.fetchImpl ?? fetch;

  const resp = await doFetch(buildEndpoint(baseUrl), {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRequestBody({ model, messages, temperature })),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    throw new QwenApiError(resp.status, text);
  }

  await parseSSEStream(resp.body, { onDelta, onUsage });
}
