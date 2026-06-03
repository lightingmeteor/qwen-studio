import { describe, it, expect } from 'vitest';
import { parseSSEStream } from '../sse';
import type { Usage } from '../../shared/types';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
}

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function crlfFrame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;
}

describe('parseSSEStream', () => {
  it('emits deltas in order', async () => {
    const out: string[] = [];
    await parseSSEStream(streamFromChunks([frame('Hello'), frame(' world'), 'data: [DONE]\n\n']), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('Hello world');
  });

  it('stops at [DONE] and ignores anything after', async () => {
    const out: string[] = [];
    await parseSSEStream(streamFromChunks([frame('A'), 'data: [DONE]\n\n', frame('B')]), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('A');
  });

  it('reassembles an event split across chunk boundaries', async () => {
    const f = frame('split');
    const mid = Math.floor(f.length / 2);
    const out: string[] = [];
    await parseSSEStream(streamFromChunks([f.slice(0, mid), f.slice(mid), 'data: [DONE]\n\n']), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('split');
  });

  it('emits deltas from CRLF-delimited frames', async () => {
    const out: string[] = [];
    await parseSSEStream(streamFromChunks([crlfFrame('Hello'), crlfFrame(' CRLF'), 'data: [DONE]\r\n\r\n']), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('Hello CRLF');
  });

  it('ignores malformed json chunks without throwing', async () => {
    const out: string[] = [];
    await parseSSEStream(streamFromChunks(['data: {not json}\n\n', frame('ok'), 'data: [DONE]\n\n']), {
      onDelta: (t) => out.push(t),
    });
    expect(out.join('')).toBe('ok');
  });

  it('propagates onDelta handler exceptions', async () => {
    await expect(parseSSEStream(streamFromChunks([frame('boom'), 'data: [DONE]\n\n']), {
      onDelta: () => { throw new Error('handler failed'); },
    })).rejects.toThrow('handler failed');
  });

  it('maps usage from snake_case to camelCase', async () => {
    let usage: Usage | undefined;
    const usageFrame = `data: ${JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    })}\n\n`;
    await parseSSEStream(streamFromChunks([usageFrame, 'data: [DONE]\n\n']), {
      onDelta: () => {},
      onUsage: (u) => { usage = u; },
    });
    expect(usage).toEqual({ promptTokens: 3, completionTokens: 5, totalTokens: 8 });
  });
});
