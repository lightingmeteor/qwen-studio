import { describe, it, expect } from 'vitest';
import { genId } from '../id';

describe('genId', () => {
  it('prefixes the id', () => {
    expect(genId('m')).toMatch(/^m_/);
  });
  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => genId('c')));
    expect(ids.size).toBe(1000);
  });
});
