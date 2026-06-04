import { contextBridge, ipcRenderer } from 'electron';
import type { QwenApi } from '../shared/api';

function subscribe(channel: string) {
  return (cb: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  };
}

const api: QwenApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
  testConnection: (patch) => ipcRenderer.invoke('diagnostics:testConnection', patch),

  listConversations: () => ipcRenderer.invoke('convo:list'),
  createConversation: (title) => ipcRenderer.invoke('convo:create', title),
  renameConversation: (id, title) => ipcRenderer.invoke('convo:rename', id, title),
  deleteConversation: (id) => ipcRenderer.invoke('convo:delete', id),
  saveMessages: (id, messages) => ipcRenderer.invoke('convo:saveMessages', id, messages),
  setConversationPinned: (id, pinned) => ipcRenderer.invoke('convo:setPinned', id, pinned),
  setConversationArchived: (id, archived) => ipcRenderer.invoke('convo:setArchived', id, archived),
  exportConversationMarkdown: (id) => ipcRenderer.invoke('convo:exportMarkdown', id),
  exportConversationsJson: () => ipcRenderer.invoke('convo:exportJson'),

  chatStream: (payload) => ipcRenderer.invoke('chat:stream', payload),
  abortChat: (requestId) => ipcRenderer.invoke('chat:abort', requestId),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  onChatDelta: subscribe('chat:delta') as QwenApi['onChatDelta'],
  onChatUsage: subscribe('chat:usage') as QwenApi['onChatUsage'],
  onChatDone: subscribe('chat:done') as QwenApi['onChatDone'],
  onChatError: subscribe('chat:error') as QwenApi['onChatError'],
};

contextBridge.exposeInMainWorld('qwen', api);
