import { describe, expect, it } from 'vitest';
import {
  BASE_URL_PRESETS,
  DEFAULT_SETTINGS,
  MODEL_PRESETS,
  hasUnresolvedBaseUrlTemplate,
} from '../types';

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
        {
          label: 'Germany Frankfurt',
          baseUrl: 'https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
        },
      ]),
    );
    expect(DEFAULT_SETTINGS.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(BASE_URL_PRESETS[0].baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
  });
});

describe('hasUnresolvedBaseUrlTemplate', () => {
  it('detects unresolved workspace placeholders in Base URLs', () => {
    expect(
      hasUnresolvedBaseUrlTemplate(
        'https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
      ),
    ).toBe(true);
  });

  it('allows Base URLs after the workspace placeholder has been replaced', () => {
    expect(
      hasUnresolvedBaseUrlTemplate(
        'https://my-workspace.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
      ),
    ).toBe(false);
  });
});

describe('MODEL_PRESETS', () => {
  it('includes common current Qwen text and coding model presets', () => {
    expect(MODEL_PRESETS).toEqual(
      expect.arrayContaining([
        'qwen-plus',
        'qwen3.5-plus',
        'qwen-flash',
        'qwen-max',
        'qwen-coder',
      ]),
    );
  });
});
