import type { ClaimId } from '@kotowari/kernel';
import type { RetrievalCandidate, RetrievalCandidateStrategy } from '@kotowari/plugin-sdk';

export const DEFAULT_RRF_K = 60;

export type RankedCandidateList = {
  strategy: RetrievalCandidateStrategy;
  candidates: readonly RetrievalCandidate[];
};

export type FusedCandidate = {
  claimId: ClaimId;
  score: number;
  scoreComponents: Partial<Record<RetrievalCandidateStrategy, number>>;
  graphRoute?: readonly string[];
};

export function reciprocalRankFuse(
  lists: readonly RankedCandidateList[],
  k = DEFAULT_RRF_K,
): readonly FusedCandidate[] {
  const fused = new Map<ClaimId, FusedCandidate>();
  for (const list of lists) {
    list.candidates.forEach((candidate, index) => {
      const contribution = 1 / (k + index + 1);
      const existing = fused.get(candidate.claimId);
      fused.set(candidate.claimId, {
        claimId: candidate.claimId,
        score: (existing?.score ?? 0) + contribution,
        scoreComponents: {
          ...(existing?.scoreComponents ?? {}),
          [list.strategy]: contribution,
        },
        ...(candidate.graphRoute === undefined
          ? existing?.graphRoute === undefined
            ? {}
            : { graphRoute: existing.graphRoute }
          : { graphRoute: candidate.graphRoute }),
      });
    });
  }
  return [...fused.values()].sort(
    (left, right) => right.score - left.score || left.claimId.localeCompare(right.claimId),
  );
}
