import { AsyncLocalStorage } from 'node:async_hooks';

import { assembleContext } from '@kotowari/capability-context';
import {
  buildDecisionAuditBundleCapability,
  findDecisionPrecedentsCapability,
  recordDecisionCapability,
  replayDecisionCapability,
} from '@kotowari/capability-decision';
import {
  evidenceBlobKey,
  ingestDocuments,
  reextractFromStoredEvidence,
} from '@kotowari/capability-ingestion';
import {
  detectClaimConflicts,
  findEntityResolutionCandidates,
  resolveClaimConflict,
} from '@kotowari/capability-knowledge';
import { recordMemory, searchMemory } from '@kotowari/capability-memory';
import { semanticContractConflictRules, uniquePredicates } from '@kotowari/capability-ontology';
import {
  policyVersionRef,
  putPolicy,
  putPolicyVersion,
  selectApplicablePolicies,
  whatIfPolicy,
} from '@kotowari/capability-policy';
import { decisionToProvO } from '@kotowari/capability-provenance';
import { DEFAULT_RETRIEVAL_PLAN, retrieve } from '@kotowari/capability-retrieval';
import { asDecisionId, asEvidenceId, assertAllowed } from '@kotowari/kernel';

import type {
  DecisionPrecedent,
  DecisionRecordRequest,
  DecisionReplay,
} from '@kotowari/capability-decision';
import type { IngestDocument, IngestResult } from '@kotowari/capability-ingestion';
import type { EntityResolutionCandidate } from '@kotowari/capability-knowledge';
import type { SemanticContract } from '@kotowari/capability-ontology';
import type { ProvODocument } from '@kotowari/capability-provenance';
import type { RetrievalResult } from '@kotowari/capability-retrieval';
import type {
  Conflict,
  ConflictResolution,
  ContextSnapshot,
  Decision,
  DecisionAuditBundle,
  Evidence,
  MemoryRecord,
  PolicyId,
  PolicyRecord,
  PolicyVersion,
  Principal,
  Resource,
  TemporalPerspective,
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

function assertDecisionAllowed(
  principal: Principal,
  action: 'decision.read' | 'audit.read',
  decision: Decision,
): void {
  assertAllowed(
    principal,
    action,
    { kind: 'decision', id: decision.id, metadata: decision },
    { tenantId: principal.tenantId },
  );
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

export type KotowariAppOptions = {
  profile?: string;
};

type KnowledgeSearchInput = {
  query: string;
  purpose?: string;
  temporal?: TemporalPerspective;
  /** @deprecated Use temporal.validAt. */
  asOf?: string;
};

type ContextBuildInput = {
  purpose: string;
  query?: string;
  temporal?: TemporalPerspective;
};

export type KotowariApp = {
  ingestDocuments: (documents: readonly IngestDocument[]) => Promise<IngestResult>;
  ingestPath?: (target: string) => Promise<IngestResult>;
  searchKnowledge: (input: KnowledgeSearchInput) => Promise<RetrievalResult>;
  buildContext: (input: ContextBuildInput) => Promise<ContextSnapshot>;
  recordDecision: (input: DecisionRecordRequest) => Promise<Decision>;
  getDecision: (id: string) => Promise<Decision | undefined>;
  listDecisions: () => Promise<readonly Decision[]>;
  replayDecision?: (id: string) => Promise<DecisionReplay | undefined>;
  findDecisionPrecedents?: (id: string, limit?: number) => Promise<readonly DecisionPrecedent[]>;
  getDecisionAuditBundle?: (id: string) => Promise<DecisionAuditBundle | undefined>;
  recordMemory: (input: { body: string; kind?: MemoryRecord['kind'] }) => Promise<MemoryRecord>;
  searchMemory: (input: { query: string }) => Promise<readonly MemoryRecord[]>;
  putPolicy: (input: {
    name: string;
    version: number;
    rules: PolicyRecord['rules'];
  }) => Promise<PolicyRecord>;
  putPolicyVersion?: (input: {
    policyId?: PolicyId;
    name: string;
    version: number;
    rules: PolicyRecord['rules'];
    status?: PolicyVersion['status'];
    effectiveFrom?: PolicyVersion['effectiveFrom'];
    effectiveTo?: PolicyVersion['effectiveTo'];
    applicability?: PolicyVersion['applicability'];
  }) => Promise<PolicyVersion>;
  whatIfPolicy: (
    policy: PolicyRecord,
  ) => Promise<
    readonly { decisionId: string; wouldFail: boolean; violations: readonly string[] }[]
  >;
  detectSemanticConflicts?: (contract: SemanticContract) => Promise<readonly Conflict[]>;
  resolveConflict: (input: {
    conflictId?: string;
    claimIds: readonly [string, string, ...string[]];
    preferredClaimId: string;
    reason: string;
  }) => Promise<ConflictResolution>;
  findEntityCandidates?: (input: {
    label: string;
    limit?: number;
  }) => Promise<readonly EntityResolutionCandidate[]>;
  exportProvO: (decisionId: string) => Promise<ProvODocument | undefined>;
  listPredicates: () => Promise<readonly string[]>;
  listPolicies: () => Promise<readonly PolicyRecord[]>;
  getEvidence: (id: string) => Promise<Evidence | undefined>;
  getEvidenceContent: (id: string) => Promise<
    | {
        evidence: Evidence;
        bytes: Uint8Array;
        contentType: string;
        text?: string;
      }
    | undefined
  >;
  reextractFromEvidence: (evidenceIds: readonly string[]) => Promise<IngestResult>;
  processQueuedJobs: () => Promise<number>;
  health: () => { ok: true; profile: string };
  currentPrincipal: () => Promise<Principal>;
  runAsRequest: <T>(
    headers: Record<string, string | undefined>,
    fn: () => Promise<T>,
  ) => Promise<T>;
};

function stringArrayFromUnknown(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === 'string');
}

async function runRetrieve(
  ports: KotowariPorts,
  actor: Principal,
  input: KnowledgeSearchInput,
): Promise<RetrievalResult> {
  return retrieve({
    store: ports.store,
    embeddings: ports.embeddings,
    reranker: ports.reranker,
    principal: actor,
    authz: { tenantId: actor.tenantId, purpose: input.purpose },
    query: input.query,
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.temporal === undefined ? {} : { temporal: input.temporal }),
    ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
    plan: DEFAULT_RETRIEVAL_PLAN,
  });
}

async function captureContext(
  ports: KotowariPorts,
  actor: Principal,
  input: ContextBuildInput,
  policies: readonly PolicyRecord[],
): Promise<ContextSnapshot> {
  const retrieval = await runRetrieve(ports, actor, {
    query: input.query ?? input.purpose,
    purpose: input.purpose,
    ...(input.temporal === undefined ? {} : { temporal: input.temporal }),
  });
  return assembleContext({
    store: ports.store,
    principal: actor,
    purpose: input.purpose,
    temporal: retrieval.receipt.temporal,
    retrievalReceiptId: retrieval.receipt.id,
    policyVersions: policies.map(policyVersionRef),
    items: retrieval.hits.map((hit) => ({
      claimId: hit.claim.id,
      evidenceIds: hit.evidenceIds,
    })),
    budget: DEFAULT_RETRIEVAL_PLAN.budget,
  });
}

export function createKotowariApp(
  ports: KotowariPorts,
  options: KotowariAppOptions = {},
): KotowariApp {
  const principalSlot = new AsyncLocalStorage<Principal>();

  async function current(): Promise<Principal> {
    return principalSlot.getStore() ?? ports.identity.currentPrincipal();
  }

  const profile = options.profile ?? 'standalone';

  const app: KotowariApp = {
    async ingestDocuments(documents) {
      const actor = await current();
      assertAllowed(actor, 'ingestion.write', scopeResource(actor, 'namespace'), {
        tenantId: actor.tenantId,
      });
      const result = await ingestDocuments(
        {
          store: ports.store,
          blobs: ports.blobs,
          extraction: ports.extraction,
          embeddings: ports.embeddings,
          principal: actor,
        },
        documents,
      );
      await ports.queue.enqueue({
        kind: 'ingest.documents',
        payload: { evidenceIds: [...result.evidenceIds], claimIds: [...result.claimIds] },
      });
      return result;
    },

    async searchKnowledge(input) {
      return runRetrieve(ports, await current(), input);
    },

    async buildContext(input) {
      const actor = await current();
      const allPolicies = await ports.store.listPolicies({ tenantId: actor.tenantId });
      const policies = selectApplicablePolicies(allPolicies, {
        purpose: input.purpose,
        namespaceId: actor.namespaceIds[0],
        classification: 'internal',
        at: input.temporal?.knownAt ?? input.temporal?.validAt,
      });
      return captureContext(ports, actor, input, policies);
    },

    async recordDecision(input) {
      return recordDecisionCapability({
        store: ports.store,
        principal: await current(),
        request: input,
        captureContext: (actor, request, policies) =>
          captureContext(ports, actor, request, policies),
      });
    },

    async getDecision(id) {
      const actor = await current();
      const decision = await ports.store.getDecision(asDecisionId(id));
      if (decision === undefined) {
        return undefined;
      }
      assertDecisionAllowed(actor, 'decision.read', decision);
      return decision;
    },

    async listDecisions() {
      const actor = await current();
      return ports.store.listDecisions({
        tenantId: actor.tenantId,
        namespaceId: actor.namespaceIds[0],
      });
    },

    async replayDecision(id) {
      return replayDecisionCapability({
        store: ports.store,
        principal: await current(),
        decisionId: id,
      });
    },

    async findDecisionPrecedents(id, limit) {
      return findDecisionPrecedentsCapability({
        store: ports.store,
        principal: await current(),
        decisionId: id,
        ...(limit === undefined ? {} : { limit }),
      });
    },

    async getDecisionAuditBundle(id) {
      return buildDecisionAuditBundleCapability({
        store: ports.store,
        principal: await current(),
        decisionId: id,
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
      const actor = await current();
      assertAllowed(actor, 'policy.manage', scopeResource(actor, 'policy'), {
        tenantId: actor.tenantId,
      });
      return putPolicy({ store: ports.store, principal: actor, ...input });
    },

    async putPolicyVersion(input) {
      const actor = await current();
      assertAllowed(actor, 'policy.manage', scopeResource(actor, 'policy'), {
        tenantId: actor.tenantId,
      });
      return putPolicyVersion({ store: ports.store, principal: actor, ...input });
    },

    async whatIfPolicy(policy) {
      const actor = await current();
      assertAllowed(actor, 'policy.evaluate', scopeResource(actor, 'policy'), {
        tenantId: actor.tenantId,
      });
      return whatIfPolicy({ store: ports.store, principal: actor, policy });
    },

    async detectSemanticConflicts(contract) {
      return detectClaimConflicts({
        store: ports.store,
        principal: await current(),
        rules: semanticContractConflictRules(contract),
      });
    },

    async resolveConflict(input) {
      const actor = await current();
      assertAllowed(actor, 'conflict.resolve', scopeResource(actor, 'conflict'), {
        tenantId: actor.tenantId,
      });
      return resolveClaimConflict({ store: ports.store, principal: actor, ...input });
    },

    async findEntityCandidates(input) {
      return findEntityResolutionCandidates({
        store: ports.store,
        principal: await current(),
        label: input.label,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
    },

    async exportProvO(decisionId) {
      const actor = await current();
      const decision = await ports.store.getDecision(asDecisionId(decisionId));
      if (decision === undefined) {
        return undefined;
      }
      assertDecisionAllowed(actor, 'audit.read', decision);
      const evidence = (
        await Promise.all(decision.consideredEvidenceIds.map((id) => app.getEvidence(id)))
      ).filter((item): item is Evidence => item !== undefined);
      return decisionToProvO(decision, evidence);
    },

    async listPredicates() {
      const actor = await current();
      const claims = await ports.store.listClaims({
        tenantId: actor.tenantId,
        namespaceId: actor.namespaceIds[0],
      });
      return uniquePredicates(claims);
    },

    async listPolicies() {
      const actor = await current();
      assertAllowed(actor, 'policy.evaluate', scopeResource(actor, 'policy'), {
        tenantId: actor.tenantId,
      });
      return (await ports.store.listPolicies({ tenantId: actor.tenantId })).filter(
        (policy) => policy.namespaceId === actor.namespaceIds[0],
      );
    },

    async getEvidence(id) {
      const actor = await current();
      const evidence = await ports.store.getEvidence(asEvidenceId(id));
      if (evidence === undefined) {
        return undefined;
      }
      assertAllowed(
        actor,
        'knowledge.read',
        { kind: 'evidence', id: evidence.id, metadata: evidence },
        { tenantId: actor.tenantId },
      );
      return evidence;
    },

    async getEvidenceContent(id) {
      const evidence = await app.getEvidence(id);
      if (evidence === undefined) {
        return undefined;
      }
      const loaded = await ports.blobs.get(evidenceBlobKey(evidence));
      if (loaded === undefined) {
        return undefined;
      }
      const text = loaded.contentType.startsWith('text/')
        ? new TextDecoder().decode(loaded.bytes)
        : undefined;
      return {
        evidence,
        bytes: loaded.bytes,
        contentType: loaded.contentType,
        text,
      };
    },

    async reextractFromEvidence(evidenceIds) {
      const actor = await current();
      assertAllowed(actor, 'ingestion.write', scopeResource(actor, 'namespace'), {
        tenantId: actor.tenantId,
      });
      return reextractFromStoredEvidence(
        {
          store: ports.store,
          blobs: ports.blobs,
          extraction: ports.extraction,
          embeddings: ports.embeddings,
          principal: actor,
        },
        evidenceIds,
      );
    },

    async processQueuedJobs() {
      const jobs = await ports.queue.drain();
      for (const job of jobs) {
        if (job.kind === 'ingest.extract') {
          await app.reextractFromEvidence(stringArrayFromUnknown(job.payload['evidenceIds']));
        } else if (job.kind === 'ingest.path' && typeof job.payload['path'] === 'string') {
          const ingestPath = app.ingestPath;
          if (ingestPath !== undefined) {
            await ingestPath(job.payload['path']);
          }
        } else if (job.kind === 'ingest.documents') {
          await ports.store.rebuildLexicalProjection();
        }
      }
      return jobs.length;
    },

    health() {
      return { ok: true as const, profile };
    },

    currentPrincipal() {
      return current();
    },

    async runAsRequest(headers, fn) {
      const principal =
        ports.identity.authenticate === undefined
          ? await ports.identity.currentPrincipal()
          : await ports.identity.authenticate(headers);
      return principalSlot.run(principal, fn);
    },
  };
  return app;
}
