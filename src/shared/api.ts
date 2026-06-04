import type {
  AppSettings,
  Conversation,
  ChatMessage,
  ChatStreamRequest,
  ChatDeltaEvent,
  ChatUsageEvent,
  ChatDoneEvent,
  ChatErrorEvent,
} from './types';

/** Settings patch may carry a plaintext apiKey; it is encrypted in main, never returned. */
export type SettingsPatch = Partial<AppSettings> & { apiKey?: string };

export interface QwenApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: SettingsPatch): Promise<void>;
  hasApiKey(): Promise<boolean>;

  listConversations(): Promise<Conversation[]>;
  createConversation(title?: string): Promise<Conversation>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;

  chatStream(payload: ChatStreamRequest): Promise<void>;
  abortChat(requestId: string): Promise<void>;
  openExternal(url: string): Promise<void>;

  onChatDelta(cb: (e: ChatDeltaEvent) => void): () => void;
  onChatUsage(cb: (e: ChatUsageEvent) => void): () => void;
  onChatDone(cb: (e: ChatDoneEvent) => void): () => void;
  onChatError(cb: (e: ChatErrorEvent) => void): () => void;
}
