import { create } from 'zustand';
import { type AppSettings, DEFAULT_SETTINGS } from '../../shared/types';
import type { SettingsPatch } from '../../shared/api';

interface SettingsState {
  settings: AppSettings;
  hasKey: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  save: (patch: SettingsPatch) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  hasKey: false,
  loaded: false,
  load: async () => {
    const [settings, hasKey] = await Promise.all([
      window.qwen.getSettings(),
      window.qwen.hasApiKey(),
    ]);
    set({ settings, hasKey, loaded: true });
  },
  save: async (patch) => {
    await window.qwen.saveSettings(patch);
    const [settings, hasKey] = await Promise.all([
      window.qwen.getSettings(),
      window.qwen.hasApiKey(),
    ]);
    set({ settings, hasKey });
  },
}));
