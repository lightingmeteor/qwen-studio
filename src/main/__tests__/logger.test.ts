import { afterEach, describe, expect, it, vi } from 'vitest';
import { logError, logInfo } from '../logger';

describe('main logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts secrets before writing structured fields', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logInfo('settings.saved', {
      apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
      authorization: 'Bearer sk-abcdefghijklmnopqrstuvwxyz',
      model: 'qwen-plus',
    });

    const payload = JSON.stringify(spy.mock.calls[0][1]);
    expect(payload).toContain('[REDACTED]');
    expect(payload).toContain('qwen-plus');
    expect(payload).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('sanitizes error messages before logging failures', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logError('chat.failed', {
      error: new Error('Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz'),
    });

    const payload = JSON.stringify(spy.mock.calls[0][1]);
    expect(payload).toContain('Authorization: [REDACTED]');
    expect(payload).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });
});
