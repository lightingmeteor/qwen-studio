import { describe, it, expect } from 'vitest';
import { deriveTitle } from '../title';

describe('deriveTitle', () => {
  it('returns fallback for empty text', () => {
    expect(deriveTitle('   ')).toBe('新会话');
  });
  it('collapses whitespace and trims', () => {
    expect(deriveTitle('  hello\n  world  ')).toBe('hello world');
  });
  it('truncates long text with ellipsis', () => {
    const t = deriveTitle('a'.repeat(50), 24);
    expect(t.length).toBe(25); // 24 chars + ellipsis
    expect(t.endsWith('…')).toBe(true);
  });
});
