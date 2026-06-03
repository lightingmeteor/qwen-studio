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
      signal,
      headers: {
        Authorization: 'Bearer k',
        'Content-Type': 'application/json',
      },
    });
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
});
