export type ChatRole = 'system' | 'user' | 'assistant';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status?: MessageStatus;
  aborted?: boolean;
  error?: string;
  usage?: Usage;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  systemPrompt: string;
}

export interface ChatStreamRequest {
  requestId: string;
  conversationId: string;
  model?: string;
  temperature?: number;
  messages: { role: ChatRole; content: string }[];
}

export interface ChatDeltaEvent { requestId: string; text: string; }
export interface ChatUsageEvent { requestId: string; usage: Usage; }
export interface ChatDoneEvent { requestId: string; aborted?: boolean; }
export interface ChatErrorEvent { requestId: string; message: string; }

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
  temperature: 0.7,
  systemPrompt: 'You are Qwen, a helpful assistant.',
};

export const MODEL_PRESETS = ['qwen-plus', 'qwen-turbo', 'qwen-max'] as const;
