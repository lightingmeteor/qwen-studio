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
  errorDetail?: string;
  usage?: Usage;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
}

export interface UsageSummary extends Usage {
  messageCount: number;
}

export interface ConversationExport {
  version: 1;
  exportedAt: number;
  conversations: Conversation[];
}

export interface ExportResult {
  canceled: boolean;
  filePath?: string;
  error?: string;
  detail?: string;
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
export interface ChatErrorEvent { requestId: string; message: string; detail?: string; }

export type DiagnosticCategory =
  | 'ok'
  | 'missing_key'
  | 'auth'
  | 'region_or_model'
  | 'network'
  | 'timeout'
  | 'config'
  | 'unknown';

export interface ConnectionDiagnostic {
  ok: boolean;
  category: DiagnosticCategory;
  message: string;
  detail?: string;
}

export interface BaseUrlPreset {
  label: string;
  baseUrl: string;
}

export const BASE_URL_PRESETS = [
  {
    label: 'China Beijing',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: 'Singapore',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: 'US Virginia',
    baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: 'Hong Kong China',
    baseUrl: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: 'Germany Frankfurt',
    baseUrl: 'https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
  },
] as const satisfies readonly BaseUrlPreset[];

export function hasUnresolvedBaseUrlTemplate(baseUrl: string): boolean {
  return /\{[^}]+\}/.test(baseUrl);
}

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: BASE_URL_PRESETS[0].baseUrl,
  model: 'qwen-plus',
  temperature: 0.7,
  systemPrompt: 'You are Qwen, a helpful assistant.',
};

export const MODEL_PRESETS = [
  'qwen-plus',
  'qwen3.5-plus',
  'qwen-flash',
  'qwen-max',
  'qwen-coder',
  'qwen-turbo',
] as const;
