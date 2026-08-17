import { defineProject } from 'vitest/config';

import { kotowariAliases } from '../../dev/vitest-aliases.ts';

export default defineProject({
  resolve: { alias: kotowariAliases },
  test: {
    name: '@kotowari/capability-memory',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**'],
  },
});
