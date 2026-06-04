import { describe, it, expect } from 'vitest';
import {
  buildEndpoint,
  buildRequestBody,
  friendlyMessage,
  streamQwenChat,
  QwenApiError,
} from '../qwenService';

function sseResponse(body: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function delayedSseResponse(
  chunks: string[],
  delayMs: number,
  signal: AbortSignal | undefined,
): Response {
  const encoder = new TextEncoder();
  let index = 0;
  let timer: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => {
        if (timer) clearTimeout(timer);
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      };

      signal?.addEventListener('abort', abort, { once: true });

      const push = () => {
        if (signal?.aborted) {
          abort();
          return;
        }

        if (index >= chunks.length) {
          signal?.removeEventListener('abort', abort);
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(chunks[index++]));
        timer = setTimeout(push, delayMs);
      };

      timer = setTimeout(push, delayMs);
    },
  });

  return new Response(stream, { status: 200 });
}

function idleSseResponse(signal: AbortSignal | undefined): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      });
    },
  });

  return new Response(stream, { status: 200 });
}

describe('buildEndpoint', () => {
  it('appends /chat/completions and strips trailing slashes', () => {
    expect(buildEndpoint('https://x.com/v1/')).toBe('https://x.com/v1/chat/completions');
    expect(buildEndpoint('https://x.com/v1')).toBe('https://x.com/v1/chat/completions');
  });

  it('trims copy/pasted whitespace before appending path', () => {
    expect(buildEndpoint(' https://x.com/v1/ ')).toBe('https://x.com/v1/chat/completions');
  });
});

describe('buildRequestBody', () => {
  it('enables streaming and usage', () => {
    const body = buildRequestBody({ model: 'qwen-plus', messages: [], temperature: 0.5 });
    expect(body).toMatchObject({
      model: 'qwen-plus',
      temperature: 0.5,
      stream: true,
      stream_options: { include_usage: true },
    });
  });
});

describe('friendlyMessage', () => {
  it('maps auth errors', () => {
    expect(friendlyMessage(401, '')).toContain('API Key');
    expect(friendlyMessage(403, '')).toContain('API Key');
  });
  it('maps rate limit and server errors', () => {
    expect(friendlyMessage(429, '')).toContain('频繁');
    expect(friendlyMessage(500, '')).toContain('服务端');
  });
});

describe('streamQwenChat', () => {
  it('streams deltas via injected fetch and sends request options', async () => {
    const out: string[] = [];
    const signal = new AbortController().signal;
    let calledUrl: RequestInfo | URL | undefined;
    let calledInit: RequestInit | undefined;
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = url;
      calledInit = init;
      return sseResponse(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n` +
          'data: [DONE]\n\n',
      );
    };
    await streamQwenChat({
      apiKey: 'k',
      baseUrl: ' https://x.com/v1/ ',
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hello' }],
      signal,
      onDelta: (t) => out.push(t),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.join('')).toBe('hi');
    expect(calledUrl).toBe('https://x.com/v1/chat/completions');
    expect(calledInit).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer k',
        'Content-Type': 'application/json',
      },
    });
    expect(calledInit?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(calledInit?.body as string)).toMatchObject({
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('throws QwenApiError on non-ok response', async () => {
    const fetchImpl = async () => new Response('bad key', { status: 401 });
    await expect(
      streamQwenChat({
        apiKey: 'k',
        baseUrl: 'https://x.com/v1',
        model: 'qwen-plus',
        messages: [],
        onDelta: () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(QwenApiError);
  });

  it('throws a readable-stream error on ok response without body', async () => {
    const fetchImpl = async () => new Response(null, { status: 200 });
    let thrown: unknown;
    try {
      await streamQwenChat({
        apiKey: 'k',
        baseUrl: 'https://x.com/v1',
        model: 'qwen-plus',
        messages: [],
        onDelta: () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(QwenApiError);
    expect((thrown as Error).message).toBe('服务没有返回可读取的流，请稍后重试或检查网关配置。');
  });

  it('maps fetch network failures to a retryable Chinese message', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };

    await expect(
      streamQwenChat({
        apiKey: 'k',
        baseUrl: 'https://x.com/v1',
        model: 'qwen-plus',
        messages: [],
        onDelta: () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('网络连接失败，请检查网络后重试。');
  });

  it('passes a timeout signal to fetch when no external signal is provided', async () => {
    let calledSignal: AbortSignal | undefined;
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
      calledSignal = init?.signal as AbortSignal | undefined;
      return sseResponse('data: [DONE]\n\n');
    };

    await streamQwenChat({
      apiKey: 'k',
      baseUrl: 'https://x.com/v1',
      model: 'qwen-plus',
      messages: [],
      onDelta: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(calledSignal).toBeInstanceOf(AbortSignal);
  });

  it('aborts timed out requests with a retryable Chinese message', async () => {
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });

    await expect(
      streamQwenChat({
        apiKey: 'k',
        baseUrl: 'https://x.com/v1',
        model: 'qwen-plus',
        messages: [],
        onDelta: () => {},
        requestTimeoutMs: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('请求超时，请检查网络后重试。');
  });

  it('does not time out while the SSE stream keeps producing chunks', async () => {
    const out: string[] = [];
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'b' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'c' } }] })}\n\n`,
      'data: [DONE]\n\n',
    ];
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) =>
      delayedSseResponse(chunks, 8, init?.signal as AbortSignal | undefined);

    await streamQwenChat({
      apiKey: 'k',
      baseUrl: 'https://x.com/v1',
      model: 'qwen-plus',
      messages: [],
      onDelta: (text) => out.push(text),
      requestTimeoutMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(out.join('')).toBe('abc');
  });

  it('aborts idle streams after the request timeout', async () => {
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) =>
      idleSseResponse(init?.signal as AbortSignal | undefined);

    await expect(
      streamQwenChat({
        apiKey: 'k',
        baseUrl: 'https://x.com/v1',
        model: 'qwen-plus',
        messages: [],
        onDelta: () => {},
        requestTimeoutMs: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('请求超时，请检查网络后重试。');
  });

  it('preserves caller abort errors instead of mapping them to timeout', async () => {
    const controller = new AbortController();
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
        controller.abort();
      });

    await expect(
      streamQwenChat({
        apiKey: 'k',
        baseUrl: 'https://x.com/v1',
        model: 'qwen-plus',
        messages: [],
        signal: controller.signal,
        onDelta: () => {},
        requestTimeoutMs: 60_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
