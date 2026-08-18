import { describe, expect, it } from 'vitest';

import {
  PACKAGE_NAME,
  createInMemorySemanticContractRegistry,
  semanticContractJsonLdContext,
  semanticContractJsonSchema,
  validateClaimAgainstContract,
  validateSemanticContract,
} from './public.js';

describe('public', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('@kotowari/capability-ontology');
  });

  it('exports the semantic contracts v1 surface', () => {
    expect(validateSemanticContract).toBeTypeOf('function');
    expect(validateClaimAgainstContract).toBeTypeOf('function');
    expect(semanticContractJsonSchema).toBeTypeOf('function');
    expect(semanticContractJsonLdContext).toBeTypeOf('function');
    expect(createInMemorySemanticContractRegistry).toBeTypeOf('function');
  });
});
