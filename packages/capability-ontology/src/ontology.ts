import type { Claim } from '@kotowari/kernel';

export function uniquePredicates(claims: readonly Claim[]): readonly string[] {
  return [...new Set(claims.map((claim) => claim.predicate))].sort((left, right) =>
    left.localeCompare(right),
  );
}
