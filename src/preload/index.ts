import { contextBridge } from 'electron';

// Real API is wired in a later task. Expose a placeholder so the renderer loads.
contextBridge.exposeInMainWorld('qwen', {});
