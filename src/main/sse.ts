import type { Usage } from '../shared/types';

export interface SSEHandlers {
  onDelta: (text: string) => void;
  onUsage?: (usage: Usage) => void;
}

function mapUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, number>;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

export async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  handlers: SSEHandlers,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const data = line.replace(/^data:\s*/, '').trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) handlers.onDelta(delta);
        const usage = mapUsage(json?.usage);
        if (usage && handlers.onUsage) handlers.onUsage(usage);
      } catch {
        // Skip a single malformed chunk rather than aborting the whole stream.
      }
    }
  }
}
