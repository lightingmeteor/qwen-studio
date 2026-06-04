import { describe, it, expect } from 'vitest';
import {
  parseChatCompletionsStream,
  parseResponsesStream,
  parseSSEDataStream,
  parseSSEStream,
} from '../sse';
import type { ApiMode, BuiltInTool, ToolEvent, Usage } from '../../shared/types';

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

  it('notifies activity whenever a chunk is read', async () => {
    let activityCount = 0;
    await parseSSEStream(streamFromChunks([frame('A'), frame('B'), 'data: [DONE]\n\n']), {
      onDelta: () => {},
      onActivity: () => { activityCount += 1; },
    });

    expect(activityCount).toBe(3);
  });
});

describe('parseSSEDataStream', () => {
  it('joins multiple data lines for one event', async () => {
    const data: string[] = [];
    await parseSSEDataStream(streamFromChunks(['data: first\ndata: second\n\n', 'data: [DONE]\n\n']), {
      onData: (value) => data.push(value),
    });

    expect(data).toEqual(['first\nsecond']);
  });

  it('stops at [DONE] and ignores later frames', async () => {
    const data: string[] = [];
    await parseSSEDataStream(streamFromChunks(['data: before\n\n', 'data: [DONE]\n\n', 'data: after\n\n']), {
      onData: (value) => data.push(value),
    });

    expect(data).toEqual(['before']);
  });
});

describe('parseChatCompletionsStream', () => {
  it('keeps existing delta and usage mapping', async () => {
    const out: string[] = [];
    let usage: Usage | undefined;
    const usageFrame = `data: ${JSON.stringify({
      choices: [{ delta: { content: '!' } }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    })}\n\n`;

    await parseChatCompletionsStream(streamFromChunks([frame('Hello'), usageFrame, 'data: [DONE]\n\n']), {
      onDelta: (t) => out.push(t),
      onUsage: (u) => { usage = u; },
    });

    expect(out.join('')).toBe('Hello!');
    expect(usage).toEqual({ promptTokens: 3, completionTokens: 5, totalTokens: 8 });
  });

  it('skips malformed json chunks', async () => {
    const out: string[] = [];
    await parseChatCompletionsStream(streamFromChunks(['data: {not json}\n\n', frame('ok'), 'data: [DONE]\n\n']), {
      onDelta: (t) => out.push(t),
    });

    expect(out.join('')).toBe('ok');
  });
});

describe('parseResponsesStream', () => {
  it('emits text deltas from response.output_text.delta events', async () => {
    const out: string[] = [];
    const responseFrame = `data: ${JSON.stringify({
      type: 'response.output_text.delta',
      delta: 'Hello responses',
    })}\n\n`;

    await parseResponsesStream(streamFromChunks([responseFrame, 'data: [DONE]\n\n']), {
      onDelta: (text) => out.push(text),
    });

    expect(out).toEqual(['Hello responses']);
  });

  it('emits response id and usage from response.completed events', async () => {
    let responseId: string | undefined;
    let usage: Usage | undefined;
    const responseFrame = `data: ${JSON.stringify({
      type: 'response.completed',
      response: {
        id: 'resp_123',
        usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
      },
    })}\n\n`;

    await parseResponsesStream(streamFromChunks([responseFrame, 'data: [DONE]\n\n']), {
      onDelta: () => {},
      onResponseId: (id) => { responseId = id; },
      onUsage: (u) => { usage = u; },
    });

    expect(responseId).toBe('resp_123');
    expect(usage).toEqual({ promptTokens: 4, completionTokens: 6, totalTokens: 10 });
  });

  it('emits web_search tool events from response web search call events', async () => {
    const toolEvents: ToolEvent[] = [];
    const responseFrame = `data: ${JSON.stringify({
      type: 'response.web_search_call.in_progress',
      item_id: 'ws_1',
    })}\n\n`;

    await parseResponsesStream(streamFromChunks([responseFrame, 'data: [DONE]\n\n']), {
      onDelta: () => {},
      onToolEvent: (event) => toolEvents.push(event),
    });

    expect(toolEvents).toEqual([
      {
        id: 'ws_1',
        type: 'web_search',
        status: 'started',
        title: 'Web search',
      },
    ]);
  });

  it('skips malformed json chunks and counts unknown events as activity', async () => {
    const out: string[] = [];
    let activityCount = 0;
    const unknownFrame = `data: ${JSON.stringify({ type: 'response.some_new_event', value: true })}\n\n`;
    const deltaFrame = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'ok' })}\n\n`;

    await parseResponsesStream(streamFromChunks(['data: {not json}\n\n', unknownFrame, deltaFrame, 'data: [DONE]\n\n']), {
      onDelta: (text) => out.push(text),
      onActivity: () => { activityCount += 1; },
    });

    expect(out).toEqual(['ok']);
    expect(activityCount).toBeGreaterThanOrEqual(3);
  });

  it('accepts shared Responses API types', () => {
    const apiMode: ApiMode = 'responses';
    const tool: BuiltInTool = 'web_search';
    const toolEvent: ToolEvent = {
      id: 'ws_1',
      type: tool,
      status: 'started',
      title: 'Web search',
    };

    expect(apiMode).toBe('responses');
    expect(toolEvent.type).toBe('web_search');
  });
});
