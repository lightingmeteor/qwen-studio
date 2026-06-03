import type { Usage } from '../shared/types';
import { streamQwenChat, type QwenMessage } from './qwenService';

export interface StreamChatInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  messages: QwenMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onUsage?: (usage: Usage) => void;
}

export interface LLMProvider {
  streamChat(input: StreamChatInput): Promise<void>;
}

export class QwenChatProvider implements LLMProvider {
  async streamChat(input: StreamChatInput): Promise<void> {
    await streamQwenChat(input);
  }
}

export const defaultProvider: LLMProvider = new QwenChatProvider();
