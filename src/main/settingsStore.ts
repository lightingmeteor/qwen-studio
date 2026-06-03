import { safeStorage } from 'electron';
import Store from 'electron-store';
import { type AppSettings, DEFAULT_SETTINGS } from '../shared/types';

interface Persisted {
  settings: AppSettings;
  apiKeyEnc?: string; // base64 of encrypted (or, as fallback, plain) key bytes
}

const store = new Store<Persisted>({
  name: 'qwen-studio-config',
  defaults: { settings: DEFAULT_SETTINGS },
});

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...store.get('settings') };
}

export function saveSettings(patch: Partial<AppSettings>): void {
  store.set('settings', { ...getSettings(), ...patch });
}

export function setApiKey(key: string): void {
  if (!key) {
    store.delete('apiKeyEnc');
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    store.set('apiKeyEnc', safeStorage.encryptString(key).toString('base64'));
  } else {
    // Fallback when OS encryption is unavailable; the UI warns about this.
    store.set('apiKeyEnc', Buffer.from(key, 'utf-8').toString('base64'));
  }
}

export function getApiKey(): string {
  const enc = store.get('apiKeyEnc');
  if (!enc) return '';
  const buf = Buffer.from(enc, 'base64');
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      // Data was written via the plaintext fallback; read it back as utf-8.
      return buf.toString('utf-8');
    }
  }
  return buf.toString('utf-8');
}

export function hasApiKey(): boolean {
  return !!store.get('apiKeyEnc');
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}
