import { defineProject } from 'vitest/config';

import { kotowariAliases } from '../../dev/vitest-aliases.ts';

export default defineProject({
  resolve: { alias: kotowariAliases },
  test: {
    name: '@kotowari/model-vertex',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**'],
  },
});
