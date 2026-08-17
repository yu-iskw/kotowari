import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  embeddingProviderComplianceTests,
  knowledgeSourceComplianceTests,
  modelProviderComplianceTests,
} from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  createFakeEmbeddingProvider,
  createFakeExtractionProvider,
  createFakeKnowledgeSource,
  createFakeModelProvider,
  createFakeRerankerProvider,
  PACKAGE_NAME,
} from './public.js';

const packageDir = dirname(fileURLToPath(import.meta.url));

describe('public', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('@kotowari/model-fake');
  });
});

modelProviderComplianceTests(() => createFakeModelProvider());
embeddingProviderComplianceTests(() => createFakeEmbeddingProvider());

knowledgeSourceComplianceTests(() =>
  createFakeKnowledgeSource([
    { id: '1', uri: 'file://a.md', mimeType: 'text/markdown', text: 'hi' },
  ]),
);

describe('fake extraction provider', () => {
  it('extracts Alice Chen and Vendor X from testdata-like sentences', async () => {
    const provider = createFakeExtractionProvider();
    const { drafts } = await provider.extract({
      text: 'Alice Chen is CEO of Vendor X as of 2024.',
      evidenceId: 'evidence:test' as never,
    });

    const aliceDraft = drafts.find((draft) => draft.subjectLabel.includes('Alice'));
    expect(aliceDraft).toBeDefined();
    expect(aliceDraft?.objectLiteral).toMatch(/Vendor X/);

    const vendorDraft = await provider.extract({
      text: 'Vendor X is the payment processor',
      evidenceId: 'evidence:test' as never,
    });
    const vendor = vendorDraft.drafts.find((draft) => draft.subjectLabel.includes('Vendor X'));
    expect(vendor).toBeDefined();
    expect(vendor?.objectLiteral).toMatch(/payment processor/);
  });
});

describe('fake reranker provider', () => {
  it('returns hits in original order', async () => {
    const provider = createFakeRerankerProvider();
    const { ids } = await provider.rerank({
      query: 'test',
      hits: [
        { id: 'a', text: 'first' },
        { id: 'b', text: 'second' },
        { id: 'c', text: 'third' },
      ],
    });
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('fake embedding provider', () => {
  it('returns stable vectors for the same text', async () => {
    const provider = createFakeEmbeddingProvider();
    const first = await provider.embed({ texts: ['stable-text'] });
    const second = await provider.embed({ texts: ['stable-text'] });
    expect(first.vectors[0]).toEqual(second.vectors[0]);
  });
});

describe('ADR-0003 model-fake package has no vendor ML deps', () => {
  it('package.json must NOT include python/torch/openai/vertex deps', () => {
    const packageJson = JSON.parse(readFileSync(join(packageDir, '../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    const forbidden = ['python', 'torch', 'openai', 'vertex'];
    for (const [name] of Object.entries(allDeps)) {
      const lower = name.toLowerCase();
      for (const token of forbidden) {
        expect(lower).not.toContain(token);
      }
    }
  });
});
