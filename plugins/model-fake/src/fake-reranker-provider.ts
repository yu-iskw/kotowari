import type { RerankerProvider } from '@kotowari/plugin-sdk';

export function createFakeRerankerProvider(): RerankerProvider {
  return {
    id: 'fake-rerank',
    async rerank(request) {
      return { ids: request.hits.map((hit) => hit.id) };
    },
  };
}
