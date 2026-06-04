import { safeStorage } from 'electron';
import Store from 'electron-store';
import { type AppSettings, DEFAULT_SETTINGS } from '../shared/types';

interface Persisted {
  settings: AppSettings;
  apiKey?: ApiKeyStorage;
  apiKeyEnc?: string;
}

type ApiKeyStorage =
  | { mode: 'safeStorage'; value: string }
  | { mode: 'plaintextFallback'; value: string };

function clearLegacyApiKey(): void {
  store.delete('apiKeyEnc');
}

function isApiKeyStorage(value: unknown): value is ApiKeyStorage {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as { mode?: unknown; value?: unknown };
  return (
    (candidate.mode === 'safeStorage' || candidate.mode === 'plaintextFallback') &&
    typeof candidate.value === 'string' &&
    candidate.value.length > 0
  );
}

function clearMalformedApiKey(): void {
  store.delete('apiKey');
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
    clearLegacyApiKey();
    store.delete('apiKey');
    return;
  }

  clearLegacyApiKey();

  if (!isEncryptionAvailable()) {
    throw new Error('无法安全保存 API Key：当前系统的安全存储不可用。');
  }

  try {
    const encryptedApiKey: ApiKeyStorage = {
      mode: 'safeStorage',
      value: safeStorage.encryptString(key).toString('base64'),
    };
    store.set('apiKey', encryptedApiKey);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`保存 API Key 失败：安全存储加密失败。${reason}`);
  }
}

export function getApiKey(): string {
  clearLegacyApiKey();

  const apiKey = store.get('apiKey');
  if (!apiKey) return '';

  if (!isApiKeyStorage(apiKey)) {
    clearMalformedApiKey();
    return '';
  }

  if (apiKey.mode === 'plaintextFallback') {
    clearMalformedApiKey();
    return '';
  }

  if (!isEncryptionAvailable()) {
    return '';
  }

  try {
    const buf = Buffer.from(apiKey.value, 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    clearMalformedApiKey();
    return '';
  }
}

export function hasApiKey(): boolean {
  clearLegacyApiKey();

  const apiKey = store.get('apiKey');
  if (!apiKey) return false;

  if (!isApiKeyStorage(apiKey)) {
    clearMalformedApiKey();
    return false;
  }

  if (apiKey.mode === 'plaintextFallback') {
    clearMalformedApiKey();
    return false;
  }

  if (!isEncryptionAvailable()) {
    return false;
  }

  try {
    safeStorage.decryptString(Buffer.from(apiKey.value, 'base64'));
    return true;
  } catch {
    clearMalformedApiKey();
    return false;
  }
}

export function isEncryptionAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) {
    return false;
  }

  if (process.platform === 'linux') {
    return safeStorage.getSelectedStorageBackend() !== 'basic_text';
  }

  return true;
}
