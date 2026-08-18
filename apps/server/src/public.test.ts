import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './public.js';

describe('public', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('@kotowari/server');
  });
});
