import type { ExtractionProvider } from '@kotowari/plugin-sdk';

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const VERB_PATTERN = /\b(is|are|was|were)\b/i;

export function createFakeExtractionProvider(): ExtractionProvider {
  return {
    id: 'fake-extract',
    async extract(request) {
      const drafts = [];
      const sentences = request.text.split(SENTENCE_SPLIT).filter((s) => s.length > 0);

      for (const sentence of sentences) {
        const match = VERB_PATTERN.exec(sentence);
        if (match) {
          const verbIndex = match.index;
          drafts.push({
            subjectLabel: sentence.slice(0, verbIndex).trim(),
            predicate: 'is',
            objectLiteral: sentence.slice(verbIndex + match[0].length).trim(),
            confidence: 0.8,
          });
        }
      }

      drafts.push({
        subjectLabel: 'document',
        predicate: 'mentions',
        objectLiteral: request.text.slice(0, 80),
        confidence: 1,
      });

      return { drafts };
    },
  };
}
