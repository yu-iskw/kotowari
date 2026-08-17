import { describe, expect, it } from 'vitest';

import { assertPackageBoundaries, findRepoRoot } from './boundary.js';

describe('ADR-0001 kernel must not import protocol, Vertex, or Postgres', () => {
  it('ADR-0001 kernel must not import protocol, Vertex, or Postgres', () => {
    const repoRoot = findRepoRoot();
    const result = assertPackageBoundaries(repoRoot);
    const kernelViolations = result.violations.filter((violation) =>
      violation.startsWith('kernel:'),
    );
    expect(kernelViolations).toEqual([]);
  });
});
