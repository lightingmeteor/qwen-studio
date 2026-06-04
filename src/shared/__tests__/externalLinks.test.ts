import { describe, expect, it } from 'vitest';
import { normalizeExternalUrl } from '../externalLinks';

describe('normalizeExternalUrl', () => {
  it('allows absolute http and https URLs', () => {
    expect(normalizeExternalUrl(' https://example.com/docs ')).toBe('https://example.com/docs');
    expect(normalizeExternalUrl('http://example.com')).toBe('http://example.com/');
  });

  it('rejects non-web and relative URLs', () => {
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeExternalUrl('file:///tmp/test.txt')).toBeNull();
    expect(normalizeExternalUrl('/relative/path')).toBeNull();
    expect(normalizeExternalUrl('')).toBeNull();
  });
});
