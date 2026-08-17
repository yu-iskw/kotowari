import type { NamespaceId, PrincipalId, TenantId } from './branded-ids.js';

export const CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'tlp:amber',
  'tlp:red',
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export const VISIBILITIES = ['public', 'workspace', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export type ScopedMetadata = {
  tenantId: TenantId;
  namespaceId: NamespaceId;
  principalId?: PrincipalId;
  classification: Classification;
  visibility: Visibility;
  policyTags: readonly string[];
};

const CLASSIFICATION_RANK: Record<Classification, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  'tlp:amber': 3,
  'tlp:red': 4,
};

export function classificationRank(classification: Classification): number {
  return CLASSIFICATION_RANK[classification];
}

export function isClassification(value: string): value is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(value);
}
