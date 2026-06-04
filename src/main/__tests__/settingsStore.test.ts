import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoreData = Record<string, unknown>;

async function importSettingsStore(options: {
  encryptionAvailable?: boolean;
  backend?: string;
  encryptString?: (value: string) => Buffer;
  decryptString?: (value: Buffer) => string;
  initialData?: StoreData;
}) {
  vi.resetModules();

  const initialData: StoreData = { ...(options.initialData ?? {}) };
  const data: StoreData = { ...initialData };
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => options.encryptionAvailable ?? true),
    getSelectedStorageBackend: vi.fn(() => options.backend ?? 'secret_service'),
    encryptString: vi.fn(options.encryptString ?? ((value: string) => Buffer.from(`enc:${value}`, 'utf-8'))),
    decryptString: vi.fn(options.decryptString ?? ((value: Buffer) => value.toString('utf-8').replace(/^enc:/, ''))),
  };

  vi.doMock('electron', () => ({ safeStorage }));
  vi.doMock('electron-store', () => ({
    default: class MockStore {
      constructor(config: { defaults?: StoreData }) {
        Object.assign(data, config.defaults, initialData);
      }

      get(key: string) {
        return data[key];
      }

      set(key: string, value: unknown) {
        data[key] = value;
      }

      delete(key: string) {
        delete data[key];
      }
    },
  }));

  const mod = await import('../settingsStore');
  return { mod, data, safeStorage };
}

describe('settingsStore api key encryption', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('does not save a plaintext fallback when safeStorage is unavailable', async () => {
    const { mod, data } = await importSettingsStore({ encryptionAvailable: false });

    expect(() => mod.setApiKey('sk-test')).toThrow('无法安全保存 API Key');
    expect(data.apiKey).toBeUndefined();
    expect(mod.hasApiKey()).toBe(false);
    expect(mod.getApiKey()).toBe('');
  });

  it('does not save a plaintext fallback when encryption fails', async () => {
    const { mod, data } = await importSettingsStore({
      encryptString: () => {
        throw new Error('encrypt failed');
      },
    });

    expect(() => mod.setApiKey('sk-test')).toThrow('保存 API Key 失败');
    expect(data.apiKey).toBeUndefined();
    expect(mod.hasApiKey()).toBe(false);
  });

  it('cleans legacy plaintextFallback records and treats them as missing', async () => {
    const { mod, data } = await importSettingsStore({
      initialData: {
        apiKey: {
          mode: 'plaintextFallback',
          value: Buffer.from('sk-legacy', 'utf-8').toString('base64'),
        },
      },
    });

    expect(mod.getApiKey()).toBe('');
    expect(mod.hasApiKey()).toBe(false);
    expect(data.apiKey).toBeUndefined();
  });

  it('keeps an existing encrypted api key when saving a new key fails', async () => {
    const { mod, data } = await importSettingsStore({
      encryptString: () => {
        throw new Error('encrypt failed');
      },
      initialData: {
        apiKey: {
          mode: 'safeStorage',
          value: Buffer.from('enc:sk-old', 'utf-8').toString('base64'),
        },
      },
    });

    expect(() => mod.setApiKey('sk-new')).toThrow('保存 API Key 失败');
    expect(mod.getApiKey()).toBe('sk-old');
    expect(mod.hasApiKey()).toBe(true);
    expect(data.apiKey).toEqual({
      mode: 'safeStorage',
      value: Buffer.from('enc:sk-old', 'utf-8').toString('base64'),
    });
  });
});

describe('settingsStore settings persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses Task 4 defaults when persisted settings do not include responses options', async () => {
    const { mod } = await importSettingsStore({
      initialData: {
        settings: {
          baseUrl: 'https://example.test/v1',
          model: 'qwen-test',
          temperature: 0.3,
          systemPrompt: 'Be brief.',
        },
      },
    });

    expect(mod.getSettings()).toMatchObject({
      baseUrl: 'https://example.test/v1',
      model: 'qwen-test',
      temperature: 0.3,
      systemPrompt: 'Be brief.',
      apiMode: 'chat_completions',
      webSearchEnabled: false,
    });
  });

  it('persists responses mode and web search settings', async () => {
    const { mod, data } = await importSettingsStore({});

    mod.saveSettings({ apiMode: 'responses', webSearchEnabled: true });

    expect(data.settings).toMatchObject({
      apiMode: 'responses',
      webSearchEnabled: true,
    });
    expect(mod.getSettings()).toMatchObject({
      apiMode: 'responses',
      webSearchEnabled: true,
    });
  });

  it('repairs invalid persisted responses option values to defaults', async () => {
    const { mod } = await importSettingsStore({
      initialData: {
        settings: {
          apiMode: 'invalid-mode',
          webSearchEnabled: 'yes',
        },
      },
    });

    expect(mod.getSettings()).toMatchObject({
      apiMode: 'chat_completions',
      webSearchEnabled: false,
    });
  });
});
