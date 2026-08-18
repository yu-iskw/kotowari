import { AsyncLocalStorage } from 'node:async_hooks';

import { assembleContext } from '@kotowari/capability-context';
import { ingestDocuments, reextractFromStoredEvidence } from '@kotowari/capability-ingestion';
import { resolveClaimConflict } from '@kotowari/capability-knowledge';
import { recordMemory, searchMemory } from '@kotowari/capability-memory';
import { uniquePredicates } from '@kotowari/capability-ontology';
import {
  evaluateDecisionAgainstPolicy,
  putPolicy,
  whatIfPolicy,
} from '@kotowari/capability-policy';
import { DEFAULT_RETRIEVAL_PLAN, retrieve } from '@kotowari/capability-retrieval';
import {
  asDecisionId,
  assertAllowed,
  assertNoChainOfThought,
  buildDecisionRecorded,
  compactProvenance,
} from '@kotowari/kernel';
import { bearerTokenFromHeaders } from '@kotowari/plugin-sdk';

import {
  drainQueuedJobs,
  ensureWorkspacePolicies,
  exportProvOFor,
  listDecisionsFor,
  loadEvidence,
  loadEvidenceContent,
  searchDecisionsFor,
} from './create-app-helpers.js';
import { ApplicationError } from './errors.js';

import type { IngestDocument, IngestResult } from '@kotowari/capability-ingestion';
import type { ProvODocument } from '@kotowari/capability-provenance';
import type { RetrievalResult } from '@kotowari/capability-retrieval';
import type {
  Conflict,
  ConflictResolution,
  ContextSnapshot,
  Decision,
  Evidence,
  MemoryRecord,
  PolicyEvaluation,
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
  QueuedJob,
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

export type KotowariAppOptions = {
  profile?: string;
};

type RequestScope = {
  principal: Principal;
  bearerToken: string | undefined;
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
  searchDecisions: (input: { query: string }) => Promise<readonly Decision[]>;
  listConflicts: () => Promise<readonly Conflict[]>;
  listJobs: () => Promise<readonly QueuedJob[]>;
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

export function createKotowariApp(
  ports: KotowariPorts,
  options: KotowariAppOptions = {},
): KotowariApp {
  const requestSlot = new AsyncLocalStorage<RequestScope>();

  async function current(): Promise<Principal> {
    return requestSlot.getStore()?.principal ?? ports.identity.currentPrincipal();
  }

  function denyIfGuest(actor: Principal, message: string): void {
    if (!actor.roles.includes('guest')) {
      return;
    }
    if (requestSlot.getStore()?.bearerToken === undefined) {
      throw new ApplicationError('Sign in required', 401);
    }
    throw new ApplicationError(message, 403);
  }

  function assertWriterMayMutate(actor: Principal): void {
    denyIfGuest(actor, 'Guest cannot write');
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

  const profile = options.profile ?? 'standalone';

  const app: KotowariApp = {
    async ingestDocuments(documents) {
      const actor = await current();
      assertWriterMayMutate(actor);
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
      ).then(async (result) => {
        await ports.queue.enqueue({
          kind: 'ingest.documents',
          payload: { evidenceIds: [...result.evidenceIds], claimIds: [...result.claimIds] },
        });
        return result;
      });
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
      assertWriterMayMutate(actor);
      assertAllowed(actor, 'decision.record', scopeResource(actor, 'decision'), {
        tenantId: actor.tenantId,
      });
      const snapshot = await this.buildContext({ purpose: input.purpose, query: input.query });
      const policies = await ensureWorkspacePolicies(ports.store, actor);
      const candidate = {
        selectedOutcome: input.selectedOutcome,
        confidence: input.confidence,
        classification: 'internal' as const,
      };
      const evaluations: PolicyEvaluation[] = policies.map(
        (policy) => evaluateDecisionAgainstPolicy(actor, policy, candidate).evaluation,
      );
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
        applicablePolicyIds: policies.map((policy) => policy.id),
        selectedOutcome: input.selectedOutcome,
        alternatives: input.alternatives ?? [],
        confidence: input.confidence,
        actor: actor.id,
        rationale: input.rationale,
        query: input.query,
        resultingActionIds: [],
        policyEvaluations: evaluations,
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
      return listDecisionsFor(ports.store, await current());
    },

    async searchDecisions(input) {
      return searchDecisionsFor(ports.store, await current(), input.query);
    },

    async listConflicts() {
      const actor = await current();
      const [conflicts, resolutions] = await Promise.all([
        ports.store.listConflicts({ tenantId: actor.tenantId }),
        ports.store.listResolutions({ tenantId: actor.tenantId }),
      ]);
      const resolvedIds = new Set(resolutions.map((resolution) => resolution.id));
      return conflicts.filter((conflict) => !resolvedIds.has(conflict.id));
    },

    async listJobs() {
      denyIfGuest(await current(), 'Guest cannot list jobs');
      return ports.queue.listPending();
    },

    async recordMemory(input) {
      const actor = await current();
      assertWriterMayMutate(actor);
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
      assertWriterMayMutate(actor);
      return putPolicy({ store: ports.store, principal: actor, ...input });
    },

    async whatIfPolicy(policy) {
      return whatIfPolicy({ store: ports.store, principal: await current(), policy });
    },

    async resolveConflict(input) {
      const actor = await current();
      assertWriterMayMutate(actor);
      return resolveClaimConflict({ store: ports.store, principal: actor, ...input });
    },

    async exportProvO(decisionId) {
      return exportProvOFor(ports, decisionId);
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

    async getEvidence(id) {
      return loadEvidence(ports, await current(), id);
    },

    async getEvidenceContent(id) {
      return loadEvidenceContent(ports, await current(), id);
    },

    async reextractFromEvidence(evidenceIds) {
      const actor = await current();
      assertWriterMayMutate(actor);
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
      return drainQueuedJobs({
        queue: ports.queue,
        store: ports.store,
        reextract: (evidenceIds) => app.reextractFromEvidence(evidenceIds),
        ingestPath: app.ingestPath,
      });
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
      return requestSlot.run({ principal, bearerToken: bearerTokenFromHeaders(headers) }, fn);
    },
  };
  return app;
}
