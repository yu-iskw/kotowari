import { describe, expect, it } from 'vitest';

import type { Evidence } from '../contracts.js';

export type SourceContext = {
  tenantId: string;
  namespaceId?: string;
  cursor?: string;
};

export type SourceObject = {
  id: string;
  uri: string;
  mimeType: string;
  title?: string;
  contentHash?: string;
};

export interface KnowledgeSource {
  discover(ctx: SourceContext): AsyncIterable<SourceObject>;
  ingest(object: SourceObject): Promise<Evidence>;
}

export function knowledgeSourceComplianceTests(
  factory: () => KnowledgeSource | Promise<KnowledgeSource>,
): void {
  describe('KnowledgeSource compliance', () => {
    it('discovers at least one object and ingests evidence', async () => {
      const source = await factory();
      const ctx: SourceContext = { tenantId: 'local', namespaceId: 'local-workspace' };
      const discovered: SourceObject[] = [];
      for await (const object of source.discover(ctx)) {
        discovered.push(object);
      }
      expect(discovered.length).toBeGreaterThan(0);

      const evidence = await source.ingest(discovered[0]!);
      expect(evidence.id).toBeTruthy();
      expect(evidence.uri).toBe(discovered[0]!.uri);
      expect(evidence.mimeType).toBe(discovered[0]!.mimeType);
    });
  });
}
