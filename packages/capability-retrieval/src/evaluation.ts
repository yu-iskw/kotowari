export type RetrievalEvaluationCase = {
  id: string;
  relevantClaimIds: readonly string[];
  retrievedClaimIds: readonly string[];
};

export type RetrievalEvaluationMetrics = {
  cases: number;
  precisionAtK: number;
  recallAtK: number;
  hitRateAtK: number;
  meanReciprocalRank: number;
};

export function evaluateRetrieval(
  cases: readonly RetrievalEvaluationCase[],
  k: number,
): RetrievalEvaluationMetrics {
  if (cases.length === 0 || k <= 0) {
    return {
      cases: cases.length,
      precisionAtK: 0,
      recallAtK: 0,
      hitRateAtK: 0,
      meanReciprocalRank: 0,
    };
  }

  let precision = 0;
  let recall = 0;
  let hits = 0;
  let reciprocalRank = 0;

  for (const evaluationCase of cases) {
    const relevant = new Set(evaluationCase.relevantClaimIds);
    const retrieved = evaluationCase.retrievedClaimIds.slice(0, k);
    const relevantRetrieved = retrieved.filter((claimId) => relevant.has(claimId));
    precision += relevantRetrieved.length / k;
    recall += relevant.size === 0 ? 0 : relevantRetrieved.length / relevant.size;
    if (relevantRetrieved.length > 0) {
      hits += 1;
    }
    const firstRelevantIndex = retrieved.findIndex((claimId) => relevant.has(claimId));
    if (firstRelevantIndex >= 0) {
      reciprocalRank += 1 / (firstRelevantIndex + 1);
    }
  }

  return {
    cases: cases.length,
    precisionAtK: precision / cases.length,
    recallAtK: recall / cases.length,
    hitRateAtK: hits / cases.length,
    meanReciprocalRank: reciprocalRank / cases.length,
  };
}
