import type { Decision, Evidence, Provenance } from '@kotowari/kernel';

export type ProvODocument = {
  '@context': { prov: string };
  '@type': string;
  'prov:generated': string;
  'prov:wasAssociatedWith': string;
  'prov:used': readonly string[];
  'prov:wasInformedBy': Provenance;
  evidence: readonly Pick<Evidence, 'id' | 'uri' | 'contentHash'>[];
};

export function decisionToProvO(decision: Decision, evidence: readonly Evidence[]): ProvODocument {
  return {
    '@context': { prov: 'http://www.w3.org/ns/prov#' },
    '@type': 'prov:Activity',
    'prov:generated': decision.id,
    'prov:wasAssociatedWith': decision.actor,
    'prov:used': decision.consideredEvidenceIds,
    'prov:wasInformedBy': decision.provenance,
    evidence: evidence.map((item) => ({
      id: item.id,
      uri: item.uri,
      contentHash: item.contentHash,
    })),
  };
}
