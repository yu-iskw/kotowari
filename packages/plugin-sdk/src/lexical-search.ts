import { claimText, claimVisibleAt, normalizeTemporalPerspective } from './contracts.js';

import type { Claim, NamespaceId, TemporalPerspective, TenantId } from './contracts.js';

export function lexicalTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1);
}

export function lexicalScore(queryTokens: readonly string[], text: string): number {
  if (queryTokens.length === 0) {
    return 0;
  }
  const blob = text.toLowerCase();
  return queryTokens.filter((token) => blob.includes(token)).length;
}

export function rankClaimsLexically(input: {
  claims: readonly Claim[];
  query: string;
  tenantId: TenantId;
  namespaceId?: NamespaceId;
  temporal?: TemporalPerspective;
  /** @deprecated Use temporal.validAt. */
  asOf?: string;
  limit: number;
}): readonly Claim[] {
  const tokens = lexicalTokens(input.query);
  const temporal = normalizeTemporalPerspective(input.temporal, input.asOf);
  const ranked = input.claims
    .filter(
      (claim) =>
        claim.tenantId === input.tenantId &&
        (input.namespaceId === undefined || claim.namespaceId === input.namespaceId) &&
        claimVisibleAt(claim, temporal),
    )
    .map((claim) => ({ claim, score: lexicalScore(tokens, claimText(claim)) }))
    .filter((row) => tokens.length === 0 || row.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked.slice(0, input.limit).map((row) => row.claim);
}

export function ftsMatchQuery(query: string): string {
  const tokens = lexicalTokens(query);
  if (tokens.length === 0) {
    return '';
  }
  return tokens.map((token) => `"${token.replaceAll('"', '')}"`).join(' OR ');
}

export function postgresFtsQuery(query: string): string {
  return lexicalTokens(query)
    .map((token) => token.replaceAll("'", ''))
    .join(' | ');
}
