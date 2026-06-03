import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  getSettings,
  saveSettings,
  setApiKey,
  getApiKey,
  hasApiKey,
} from './settingsStore';
import * as convo from './conversationStore';
import { defaultProvider } from './llmProvider';
import type { ChatStreamRequest, ChatMessage } from '../shared/types';
import type { SettingsPatch } from '../shared/api';

const controllers = new Map<string, AbortController>();

export function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, patch: SettingsPatch) => {
    const { apiKey, ...rest } = patch ?? {};
    if (typeof apiKey === 'string') setApiKey(apiKey);
    saveSettings(rest);
  });
  ipcMain.handle('settings:hasApiKey', () => hasApiKey());

  ipcMain.handle('convo:list', () => convo.listConversations());
  ipcMain.handle('convo:create', (_e, title?: string) => convo.createConversation(title));
  ipcMain.handle('convo:rename', (_e, id: string, title: string) =>
    convo.renameConversation(id, title),
  );
  ipcMain.handle('convo:delete', (_e, id: string) => convo.deleteConversation(id));
  ipcMain.handle('convo:saveMessages', (_e, id: string, messages: ChatMessage[]) =>
    convo.saveMessages(id, messages),
  );

  ipcMain.handle('chat:stream', async (event: IpcMainInvokeEvent, payload: ChatStreamRequest) => {
    const settings = getSettings();
    const apiKey = getApiKey();
    if (!apiKey) {
      event.sender.send('chat:error', {
        requestId: payload.requestId,
        message: '请先在设置里配置 API Key。',
      });
      return;
    }

    const controller = new AbortController();
    controllers.set(payload.requestId, controller);

    try {
      await defaultProvider.streamChat({
        apiKey,
        baseUrl: settings.baseUrl,
        model: payload.model || settings.model,
        temperature: payload.temperature ?? settings.temperature,
        messages: payload.messages,
        signal: controller.signal,
        onDelta: (text) =>
          event.sender.send('chat:delta', { requestId: payload.requestId, text }),
        onUsage: (usage) =>
          event.sender.send('chat:usage', { requestId: payload.requestId, usage }),
      });
      event.sender.send('chat:done', { requestId: payload.requestId });
    } catch (err) {
      if (controller.signal.aborted) {
        event.sender.send('chat:done', { requestId: payload.requestId, aborted: true });
      } else {
        const message = err instanceof Error ? err.message : '未知错误';
        event.sender.send('chat:error', { requestId: payload.requestId, message });
      }
    } finally {
      controllers.delete(payload.requestId);
    }
  });

  ipcMain.handle('chat:abort', (_e, requestId: string) => {
    controllers.get(requestId)?.abort();
    controllers.delete(requestId);
  });
}
