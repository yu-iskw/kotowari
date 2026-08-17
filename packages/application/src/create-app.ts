import { assembleContext } from '@kotowari/capability-context';
import { ingestDocuments } from '@kotowari/capability-ingestion';
import { resolveClaimConflict } from '@kotowari/capability-knowledge';
import { recordMemory, searchMemory } from '@kotowari/capability-memory';
import { uniquePredicates } from '@kotowari/capability-ontology';
import { putPolicy, whatIfPolicy } from '@kotowari/capability-policy';
import { decisionToProvO } from '@kotowari/capability-provenance';
import { DEFAULT_RETRIEVAL_PLAN, retrieve } from '@kotowari/capability-retrieval';
import {
  asDecisionId,
  assertAllowed,
  assertNoChainOfThought,
  buildDecisionRecorded,
  compactProvenance,
} from '@kotowari/kernel';

import type { IngestDocument, IngestResult } from '@kotowari/capability-ingestion';
import type { ProvODocument } from '@kotowari/capability-provenance';
import type { RetrievalResult } from '@kotowari/capability-retrieval';
import type {
  ConflictResolution,
  ContextSnapshot,
  Decision,
  Evidence,
  MemoryRecord,
  PolicyRecord,
  Principal,
  Resource,
} from '@kotowari/kernel';
import type {
  BlobStore,
  CanonicalStore,
  EmbeddingProvider,
  ExtractionProvider,
  IdentityProvider,
  Queue,
  RerankerProvider,
} from '@kotowari/plugin-sdk';

function scopeResource(principal: Principal, kind: Resource['kind']): Resource {
  const namespaceId = principal.namespaceIds[0];
  if (namespaceId === undefined) {
    throw new Error('Principal has no namespace');
  }
  return {
    kind,
    id: namespaceId,
    metadata: {
      tenantId: principal.tenantId,
      namespaceId,
      principalId: principal.id,
      classification: 'internal',
      visibility: 'workspace',
      policyTags: [],
    },
  };
}

export type KotowariPorts = {
  store: CanonicalStore;
  blobs: BlobStore;
  identity: IdentityProvider;
  queue: Queue;
  extraction: ExtractionProvider;
  embeddings: EmbeddingProvider;
  reranker?: RerankerProvider;
};

export type KotowariApp = {
  ingestDocuments: (documents: readonly IngestDocument[]) => Promise<IngestResult>;
  ingestPath?: (target: string) => Promise<IngestResult>;
  searchKnowledge: (input: {
    query: string;
    purpose?: string;
    asOf?: string;
  }) => Promise<RetrievalResult>;
  buildContext: (input: { purpose: string; query?: string }) => Promise<ContextSnapshot>;
  recordDecision: (input: {
    purpose: string;
    query?: string;
    selectedOutcome: string;
    alternatives?: readonly string[];
    confidence: number;
    rationale?: string;
    chainOfThought?: unknown;
    hiddenCoT?: unknown;
  }) => Promise<Decision>;
  getDecision: (id: string) => Promise<Decision | undefined>;
  listDecisions: () => Promise<readonly Decision[]>;
  recordMemory: (input: { body: string; kind?: MemoryRecord['kind'] }) => Promise<MemoryRecord>;
  searchMemory: (input: { query: string }) => Promise<readonly MemoryRecord[]>;
  putPolicy: (input: {
    name: string;
    version: number;
    rules: PolicyRecord['rules'];
  }) => Promise<PolicyRecord>;
  whatIfPolicy: (
    policy: PolicyRecord,
  ) => Promise<
    readonly { decisionId: string; wouldFail: boolean; violations: readonly string[] }[]
  >;
  resolveConflict: (input: {
    claimIds: readonly [string, string, ...string[]];
    preferredClaimId: string;
    reason: string;
  }) => Promise<ConflictResolution>;
  exportProvO: (decisionId: string) => Promise<ProvODocument | undefined>;
  listPredicates: () => Promise<readonly string[]>;
  listPolicies: () => Promise<readonly PolicyRecord[]>;
  health: () => { ok: true; profile: 'standalone' };
  currentPrincipal: () => Promise<Principal>;
};

export function createKotowariApp(ports: KotowariPorts): KotowariApp {
  async function current(): Promise<Principal> {
    return ports.identity.currentPrincipal();
  }

  async function runRetrieve(
    actor: Principal,
    input: { query: string; purpose?: string; asOf?: string },
  ): Promise<RetrievalResult> {
    return retrieve({
      store: ports.store,
      embeddings: ports.embeddings,
      reranker: ports.reranker,
      principal: actor,
      authz: { tenantId: actor.tenantId, purpose: input.purpose },
      query: input.query,
      asOf: input.asOf,
      plan: DEFAULT_RETRIEVAL_PLAN,
    });
  }

  return {
    async ingestDocuments(documents) {
      const actor = await current();
      assertAllowed(actor, 'ingestion.write', scopeResource(actor, 'namespace'), {
        tenantId: actor.tenantId,
      });
      return ingestDocuments(
        {
          store: ports.store,
          blobs: ports.blobs,
          extraction: ports.extraction,
          embeddings: ports.embeddings,
          principal: actor,
        },
        documents,
      );
    },

    async searchKnowledge(input) {
      return runRetrieve(await current(), input);
    },

    async buildContext(input) {
      const actor = await current();
      const retrieval = await runRetrieve(actor, {
        query: input.query ?? input.purpose,
        purpose: input.purpose,
      });
      return assembleContext({
        store: ports.store,
        principal: actor,
        purpose: input.purpose,
        items: retrieval.hits.map((hit) => ({
          claimId: hit.claim.id,
          evidenceIds: hit.evidenceIds,
        })),
        budget: DEFAULT_RETRIEVAL_PLAN.budget,
      });
    },

    async recordDecision(input) {
      assertNoChainOfThought(input);
      const actor = await current();
      assertAllowed(actor, 'decision.record', scopeResource(actor, 'decision'), {
        tenantId: actor.tenantId,
      });
      const snapshot = await this.buildContext({ purpose: input.purpose, query: input.query });
      const { decision, event } = buildDecisionRecorded({
        metadata: {
          tenantId: actor.tenantId,
          namespaceId: actor.namespaceIds[0] ?? snapshot.namespaceId,
          principalId: actor.id,
          classification: 'internal',
          visibility: 'workspace',
          policyTags: [input.purpose],
        },
        inputContextSnapshot: snapshot,
        consideredEvidenceIds: snapshot.evidenceIds,
        applicablePolicyIds: [],
        selectedOutcome: input.selectedOutcome,
        alternatives: input.alternatives ?? [],
        confidence: input.confidence,
        actor: actor.id,
        rationale: input.rationale,
        resultingActionIds: [],
        policyEvaluations: [],
        provenance: compactProvenance({
          source: 'decision',
          actor: actor.id,
          process: 'decision.record',
        }),
      });
      await ports.store.withTransaction(async (tx) => {
        await tx.putDecision(decision);
        await tx.appendEvent(event);
        await tx.appendOutbox(event);
      });
      return decision;
    },

    async getDecision(id) {
      return ports.store.getDecision(asDecisionId(id));
    },

    async listDecisions() {
      const actor = await current();
      return ports.store.listDecisions({
        tenantId: actor.tenantId,
        namespaceId: actor.namespaceIds[0],
      });
    },

    async recordMemory(input) {
      const actor = await current();
      assertAllowed(actor, 'memory.write', scopeResource(actor, 'memory'), {
        tenantId: actor.tenantId,
      });
      return recordMemory({ store: ports.store, principal: actor, ...input });
    },

    async searchMemory(input) {
      return searchMemory({ store: ports.store, principal: await current(), query: input.query });
    },

    async putPolicy(input) {
      return putPolicy({ store: ports.store, principal: await current(), ...input });
    },

    async whatIfPolicy(policy) {
      return whatIfPolicy({ store: ports.store, principal: await current(), policy });
    },

    async resolveConflict(input) {
      return resolveClaimConflict({ store: ports.store, principal: await current(), ...input });
    },

    async exportProvO(decisionId) {
      const decision = await ports.store.getDecision(asDecisionId(decisionId));
      if (decision === undefined) {
        return undefined;
      }
      const evidence = (
        await Promise.all(decision.consideredEvidenceIds.map((id) => ports.store.getEvidence(id)))
      ).filter((item): item is Evidence => item !== undefined);
      return decisionToProvO(decision, evidence);
    },

    async listPredicates() {
      const actor = await current();
      const claims = await ports.store.listClaims({ tenantId: actor.tenantId });
      return uniquePredicates(claims);
    },

    async listPolicies() {
      const actor = await current();
      return ports.store.listPolicies({ tenantId: actor.tenantId });
    },

    health() {
      return { ok: true as const, profile: 'standalone' as const };
    },

    currentPrincipal() {
      return current();
    },
  };
}
