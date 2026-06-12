import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Sidebar rename interaction', () => {
  it('uses an in-app rename editor instead of window.prompt', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/components/Sidebar.tsx'), 'utf8');

    expect(source).not.toContain('window.prompt');
  });
});
