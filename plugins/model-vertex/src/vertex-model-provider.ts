import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ModelProvider } from '@kotowari/plugin-sdk';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadDefaultHelloFixture(): { prompt: string; text: string } {
  const raw = readFileSync(join(packageRoot, 'src/fixtures/generate.json'), 'utf8');
  return JSON.parse(raw) as { prompt: string; text: string };
}

const defaultHello = loadDefaultHelloFixture();

export const DEFAULT_VERTEX_FIXTURES: Record<string, string> = {
  [defaultHello.prompt]: defaultHello.text,
};

export type VertexModelProviderOptions = {
  fixtures?: Record<string, string>;
};

export function createVertexModelProvider(options?: VertexModelProviderOptions): ModelProvider {
  const fixtures = { ...DEFAULT_VERTEX_FIXTURES, ...options?.fixtures };
  const defaultText = fixtures[defaultHello.prompt] ?? defaultHello.text;

  return {
    id: 'vertex-gemini',
    capabilities: {
      tools: true,
      structuredOutput: true,
      images: true,
      audio: false,
      reasoning: true,
      embeddings: true,
      maxContextTokens: 128000,
    },
    async generate(request) {
      const text = fixtures[request.prompt] ?? defaultText;
      return { text };
    },
  };
}
