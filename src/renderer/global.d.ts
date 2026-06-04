import type { QwenApi } from '../shared/api';

declare global {
  interface Window {
    qwen: QwenApi;
  }
}

export {};
