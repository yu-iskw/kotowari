import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './public.js';

describe('S1 kotowari init', () => {
  it('S1 init creates a workspace config without Docker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'kotowari-init-'));
    const code = await runCli(['init', directory]);
    expect(code).toBe(0);
    const config = JSON.parse(readFileSync(join(directory, '.kotowari', 'kotowari.json'), 'utf8')) as {
      profile: string;
    };
    expect(config.profile).toBe('standalone');
  });
});
