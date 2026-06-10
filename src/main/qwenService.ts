import type {
  BuiltInTool,
  ChatErrorCode,
  ChatRole,
  ConnectionDiagnostic,
  ToolEvent,
  Usage,
} from '../shared/types';
import {
  classifyDiagnosticError,
  diagnosticFromStatus,
  sanitizeDiagnosticDetail,
} from '../shared/diagnostics';
import { parseResponsesStream, parseSSEStream } from './sse';

export interface QwenMessage {
  role: ChatRole;
  content: string;
}

export type QwenResponsesInput = string | QwenMessage[];

export interface StreamChatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: QwenMessage[];
  temperature?: number;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  onDelta: (text: string) => void;
  onUsage?: (usage: Usage) => void;
  fetchImpl?: typeof fetch;
}

export interface StreamResponsesOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  input: QwenResponsesInput;
  previousResponseId?: string;
  tools?: BuiltInTool[];
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  onDelta: (text: string) => void;
  onUsage?: (usage: Usage) => void;
  onResponseId?: (responseId: string) => void;
  onToolEvent?: (event: ToolEvent) => void;
  fetchImpl?: typeof fetch;
}

export interface TestQwenConnectionOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 15_000;
const RESPONSES_COMPATIBLE_PATH = '/api/v2/apps/protocols/compatible-mode/v1';
const CHAT_COMPATIBLE_PATH = '/compatible-mode/v1';
const KNOWN_DASHSCOPE_HOSTS = new Set([
  'dashscope.aliyuncs.com',
  'dashscope-intl.aliyuncs.com',
  'dashscope-us.aliyuncs.com',
  'cn-hongkong.dashscope.aliyuncs.com',
]);
const GERMANY_WORKSPACE_HOST_SUFFIX = '.eu-central-1.maas.aliyuncs.com';

export class QwenApiError extends Error {
  status: number;
  body: string;
  detail: string;
  code?: ChatErrorCode;
  constructor(status: number, body: string) {
    super(friendlyMessage(status, body));
    this.name = 'QwenApiError';
    this.status = status;
    this.body = body;
    this.detail = sanitizeDiagnosticDetail(`HTTP ${status}${body ? `: ${body}` : ''}`) ?? `HTTP ${status}`;
  }
}

export function buildEndpoint(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
}

function isKnownResponsesHost(hostname: string): boolean {
  return KNOWN_DASHSCOPE_HOSTS.has(hostname) || hostname.endsWith(GERMANY_WORKSPACE_HOST_SUFFIX);
}

export function buildResponsesBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');

  try {
    const url = new URL(trimmed);
    if (url.pathname === RESPONSES_COMPATIBLE_PATH) return url.toString().replace(/\/+$/, '');
    if (isKnownResponsesHost(url.hostname) && url.pathname === CHAT_COMPATIBLE_PATH) {
      url.pathname = RESPONSES_COMPATIBLE_PATH;
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

export function buildResponsesEndpoint(baseUrl: string): string {
  return `${buildResponsesBaseUrl(baseUrl)}/responses`;
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

export function buildResponsesRequestBody(o: {
  model: string;
  input: QwenResponsesInput;
  previousResponseId?: string;
  tools?: BuiltInTool[];
}) {
  const body: {
    model: string;
    input: QwenResponsesInput;
    stream: true;
    previous_response_id?: string;
    tools?: Array<{ type: BuiltInTool }>;
  } = {
    model: o.model,
    input: o.input,
    stream: true,
  };

  if (o.previousResponseId) body.previous_response_id = o.previousResponseId;
  if (o.tools && o.tools.length > 0) body.tools = o.tools.map((type) => ({ type }));

  return body;
}

export function buildConnectionTestBody(model: string) {
  return {
    model,
    messages: [{ role: 'user' as const, content: 'ping' }],
    stream: false,
    max_tokens: 1,
  };
}

function truncate(s: string, n = 200): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function friendlyMessage(status: number, body: string): string {
  const safeBody = sanitizeDiagnosticDetail(body, 200) ?? '';

  if (status === 401 || status === 403) return 'API Key 无效或无权限，请检查设置里的 API Key。';
  if (status === 404) return '接口或模型不存在，请检查 Base URL 和模型名。';
  if (status === 400) return `请求被拒绝（400），可能是模型名或参数有误。${truncate(safeBody)}`;
  if (status === 429) return '请求过于频繁或额度不足（429），请稍后再试。';
  if (status >= 500) return `服务端错误（${status}），请稍后再试。`;
  return `请求失败（${status}）。${truncate(safeBody)}`;
}

// 启发式识别服务端对失效/过期 previous_response_id 的 4xx 拒绝：
// 错误体提到 previous_response_id，或 response 不存在/已过期类标识。
const PREVIOUS_RESPONSE_INVALID_PATTERNS = [
  /previous[_\s]?response/i,
  /response\b[^]{0,80}?(not\s+found|does\s+not\s+exist|not\s+exist|expired|invalid)/i,
];

export function isPreviousResponseInvalidError(status: number, body: string): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    PREVIOUS_RESPONSE_INVALID_PATTERNS.some((pattern) => pattern.test(body))
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) || (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function isFetchNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function createIdleTimeoutSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  resetActivity: () => void;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const abortFromCaller = (): void => {
    controller.abort(signal?.reason);
  };

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const resetActivity = (): void => {
    clearTimer();
    if (timeoutMs > 0 && !controller.signal.aborted) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException('The request timed out.', 'TimeoutError'));
      }, timeoutMs);
    }
  };

  if (signal?.aborted) {
    abortFromCaller();
  } else if (signal) {
    signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  resetActivity();

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    resetActivity,
    cleanup: () => {
      clearTimer();
      signal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

export async function streamQwenChat(options: StreamChatOptions): Promise<void> {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    temperature = 0.7,
    signal,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    onDelta,
    onUsage,
  } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const requestSignal = createIdleTimeoutSignal(signal, requestTimeoutMs);

  try {
    const resp = await doFetch(buildEndpoint(baseUrl), {
      method: 'POST',
      signal: requestSignal.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildRequestBody({ model, messages, temperature })),
    });
    requestSignal.resetActivity();

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new QwenApiError(resp.status, text);
    }
    if (!resp.body) throw new Error('服务没有返回可读取的流，请稍后重试或检查网关配置。');

    await parseSSEStream(resp.body, { onDelta, onUsage, onActivity: requestSignal.resetActivity });
  } catch (error) {
    if (requestSignal.didTimeout()) {
      throw new Error('请求超时，请检查网络后重试。');
    }
    if (isAbortError(error)) throw error;
    if (isFetchNetworkError(error)) {
      throw new Error('网络连接失败，请检查网络后重试。');
    }
    throw error;
  } finally {
    requestSignal.cleanup();
  }
}

export async function streamQwenResponses(options: StreamResponsesOptions): Promise<void> {
  const {
    apiKey,
    baseUrl,
    model,
    input,
    previousResponseId,
    tools,
    signal,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    onDelta,
    onUsage,
    onResponseId,
    onToolEvent,
  } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const requestSignal = createIdleTimeoutSignal(signal, requestTimeoutMs);

  try {
    const resp = await doFetch(buildResponsesEndpoint(baseUrl), {
      method: 'POST',
      signal: requestSignal.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildResponsesRequestBody({
        model,
        input,
        previousResponseId,
        tools,
      })),
    });
    requestSignal.resetActivity();

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const error = new QwenApiError(resp.status, text);
      if (previousResponseId && isPreviousResponseInvalidError(resp.status, text)) {
        error.code = 'previous_response_invalid';
      }
      throw error;
    }
    if (!resp.body) throw new Error('服务没有返回可读取的流，请稍后重试或检查网关配置。');

    await parseResponsesStream(resp.body, {
      onDelta,
      onUsage,
      onResponseId,
      onToolEvent,
      onActivity: requestSignal.resetActivity,
    });
  } catch (error) {
    if (requestSignal.didTimeout()) {
      throw new Error('请求超时，请检查网络后重试。');
    }
    if (isAbortError(error)) throw error;
    if (isFetchNetworkError(error)) {
      throw new Error('网络连接失败，请检查网络后重试。');
    }
    throw error;
  } finally {
    requestSignal.cleanup();
  }
}

export async function testQwenConnection(
  options: TestQwenConnectionOptions,
): Promise<ConnectionDiagnostic> {
  const {
    apiKey,
    baseUrl,
    model,
    requestTimeoutMs = DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
  } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const requestSignal = createIdleTimeoutSignal(undefined, requestTimeoutMs);

  try {
    const resp = await doFetch(buildEndpoint(baseUrl), {
      method: 'POST',
      signal: requestSignal.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildConnectionTestBody(model)),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return diagnosticFromStatus(resp.status, text);
    }

    return {
      ok: true,
      category: 'ok',
      message: 'Connection test succeeded.',
    };
  } catch (error) {
    if (requestSignal.didTimeout()) {
      return classifyDiagnosticError(new DOMException('The connection test timed out.', 'TimeoutError'));
    }

    return classifyDiagnosticError(error);
  } finally {
    requestSignal.cleanup();
  }
}
