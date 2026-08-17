import { describe, expect, it } from 'vitest';

import type { EmbeddingProvider, ModelProvider } from '../ports.js';

export function modelProviderComplianceTests(
  factory: () => ModelProvider | Promise<ModelProvider>,
): void {
  describe('ModelProvider compliance', () => {
    it('exposes id and capabilities', async () => {
      const provider = await factory();
      expect(provider.id).toBeTruthy();
      expect(typeof provider.capabilities.tools).toBe('boolean');
      expect(typeof provider.capabilities.structuredOutput).toBe('boolean');
    });

    it('generate returns text for a prompt', async () => {
      const provider = await factory();
      const result = await provider.generate({ prompt: 'Say hello.' });
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
    });
  });
}

export function embeddingProviderComplianceTests(
  factory: () => EmbeddingProvider | Promise<EmbeddingProvider>,
): void {
  describe('EmbeddingProvider compliance', () => {
    it('embed returns one vector per input text', async () => {
      const provider = await factory();
      const texts = ['first', 'second'] as const;
      const { vectors } = await provider.embed({ texts });
      expect(vectors).toHaveLength(texts.length);
      for (const vector of vectors) {
        expect(vector.length).toBeGreaterThan(0);
      }
    });
  });
}
