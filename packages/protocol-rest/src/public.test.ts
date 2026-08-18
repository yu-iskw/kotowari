import { describe, expect, it } from 'vitest';

import { OPENAPI_SNAPSHOT, PACKAGE_NAME } from './public.js';

describe('public', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('@kotowari/protocol-rest');
  });

  it('keeps a stable OpenAPI path snapshot', () => {
    expect(
      Object.keys(OPENAPI_SNAPSHOT.paths).sort((left, right) => left.localeCompare(right)),
    ).toEqual(
      [
        '/v1/context/build',
        '/v1/decisions',
        '/v1/decisions/{id}',
        '/v1/decisions/{id}/export',
        '/v1/decisions/{id}/prov',
        '/v1/evidence/{id}',
        '/v1/evidence/{id}/content',
        '/v1/health',
        '/v1/ingest',
        '/v1/knowledge/search',
        '/v1/memory',
      ].sort((left, right) => left.localeCompare(right)),
    );
  });
});
