import { describe, expect, it } from 'vitest';
import { highlightLanguages } from '../highlightLanguages';

describe('highlightLanguages', () => {
  it('exposes the curated subset as language functions', () => {
    const expected = [
      'javascript',
      'typescript',
      'python',
      'json',
      'bash',
      'shell',
      'xml',
      'css',
      'sql',
      'go',
      'rust',
      'java',
      'c',
      'cpp',
      'markdown',
      'yaml',
      'diff',
    ];

    expect(Object.keys(highlightLanguages).sort()).toEqual([...expected].sort());
    for (const fn of Object.values(highlightLanguages)) {
      expect(typeof fn).toBe('function');
    }
  });
});
