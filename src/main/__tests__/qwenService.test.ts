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
  it('streams deltas via injected fetch', async () => {
    const out: string[] = [];
    const fetchImpl = async () =>
      sseResponse(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n` +
          'data: [DONE]\n\n',
      );
    await streamQwenChat({
      apiKey: 'k',
      baseUrl: 'https://x.com/v1',
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hello' }],
      onDelta: (t) => out.push(t),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.join('')).toBe('hi');
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
});
