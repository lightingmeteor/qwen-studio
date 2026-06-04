import { describe, expect, it } from 'vitest';
import { BASE_URL_PRESETS, DEFAULT_SETTINGS } from '../types';

describe('BASE_URL_PRESETS', () => {
  it('includes regional DashScope compatible-mode endpoints while keeping China Beijing as the default', () => {
    expect(BASE_URL_PRESETS).toEqual(
      expect.arrayContaining([
        {
          label: 'China Beijing',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        },
        {
          label: 'Singapore',
          baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        },
        {
          label: 'US Virginia',
          baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
        },
        {
          label: 'Hong Kong China',
          baseUrl: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
        },
      ]),
    );
    expect(DEFAULT_SETTINGS.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(BASE_URL_PRESETS[0].baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
  });
});
