import type { ModelProvider } from '@kotowari/plugin-sdk';

export function createFakeModelProvider(): ModelProvider {
  return {
    id: 'fake-model',
    capabilities: {
      tools: false,
      structuredOutput: true,
      images: false,
      audio: false,
      reasoning: false,
      embeddings: false,
      maxContextTokens: 8192,
    },
    async generate(request) {
      return { text: `FAKE:${request.prompt.slice(0, 200)}` };
    },
  };
}
