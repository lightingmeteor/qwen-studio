import type { ApiMode, BuiltInTool, ToolEvent, Usage } from '../shared/types';
import {
  streamQwenChat,
  streamQwenResponses,
  type QwenMessage,
  type QwenResponsesInput,
} from './qwenService';

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

export interface StreamTurnInput extends StreamChatInput {
  apiMode?: ApiMode;
  input?: QwenResponsesInput;
  tools?: BuiltInTool[];
  previousResponseId?: string;
  onResponseId?: (responseId: string) => void;
  onToolEvent?: (event: ToolEvent) => void;
}

export interface LLMProvider {
  streamChat(input: StreamChatInput): Promise<void>;
  streamTurn(input: StreamTurnInput): Promise<void>;
}

export class QwenChatProvider implements LLMProvider {
  async streamChat(input: StreamChatInput): Promise<void> {
    await streamQwenChat(input);
  }

  async streamTurn(input: StreamTurnInput): Promise<void> {
    if (input.apiMode === 'responses') {
      await streamQwenResponses({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model: input.model,
        input: input.input ?? input.messages,
        previousResponseId: input.previousResponseId,
        tools: input.tools,
        signal: input.signal,
        onDelta: input.onDelta,
        onUsage: input.onUsage,
        onResponseId: input.onResponseId,
        onToolEvent: input.onToolEvent,
      });
      return;
    }

    await this.streamChat(input);
  }
}

export const defaultProvider: LLMProvider = new QwenChatProvider();
