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
  if (isEncryptionAvailable()) {
    try {
      store.set('apiKey', { mode: 'safeStorage', value: safeStorage.encryptString(key).toString('base64') });
      return;
    } catch {
      // Fall through to plaintext fallback; the UI should warn about this.
    }
  }

  store.set('apiKey', {
    mode: 'plaintextFallback',
    value: Buffer.from(key, 'utf-8').toString('base64'),
  });
}

export function getApiKey(): string {
  clearLegacyApiKey();

  const apiKey = store.get('apiKey');
  if (!apiKey) return '';

  if (!isApiKeyStorage(apiKey)) {
    clearMalformedApiKey();
    return '';
  }

  const buf = Buffer.from(apiKey.value, 'base64');
  if (apiKey.mode === 'plaintextFallback') {
    return buf.toString('utf-8');
  }

  if (!isEncryptionAvailable()) {
    return '';
  }

  try {
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
    return true;
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
