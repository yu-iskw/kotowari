import {
  embeddingProviderComplianceTests,
  modelProviderComplianceTests,
} from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  createVertexEmbeddingProvider,
  createVertexModelProvider,
  PACKAGE_NAME,
} from './public.js';

describe('public', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('@kotowari/model-vertex');
  });
});

describe('ADR-0006 fake/recorded Vertex model provider', () => {
  modelProviderComplianceTests(() => createVertexModelProvider());
});

describe('ADR-0006 fake/recorded Vertex embedding provider', () => {
  embeddingProviderComplianceTests(() => createVertexEmbeddingProvider());
});

describe('ADR-0006 recorded Vertex fixtures', () => {
  it('returns recorded hello response for Say hello. prompt', async () => {
    const provider = createVertexModelProvider();
    const result = await provider.generate({ prompt: 'Say hello.' });
    expect(result.text).toBe('Hello from recorded Vertex Gemini.');
  });

  it('falls back to default recorded fixture for unknown prompts', async () => {
    const provider = createVertexModelProvider();
    const result = await provider.generate({ prompt: 'Unknown prompt.' });
    expect(result.text).toBe('Hello from recorded Vertex Gemini.');
  });
});
