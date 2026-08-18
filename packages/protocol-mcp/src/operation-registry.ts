import { dispatchIngest } from '@kotowari/application';
import { z } from 'zod';

import type { KotowariApp } from '@kotowari/application';

export type McpOperationRisk = 'read' | 'write' | 'privileged';

export type McpOperation = {
  name: string;
  description: string;
  applicationCommand: string;
  action: string;
  risk: McpOperationRisk;
  requiredScopes: readonly string[];
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  execute: (app: KotowariApp, input: unknown) => Promise<unknown>;
};

type OperationConfig<InputSchema extends z.ZodType, OutputSchema extends z.ZodType> = Omit<
  McpOperation,
  'inputSchema' | 'outputSchema' | 'execute'
> & {
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  execute: (app: KotowariApp, input: z.infer<InputSchema>) => Promise<unknown>;
};

function defineOperation<InputSchema extends z.ZodType, OutputSchema extends z.ZodType>(
  config: OperationConfig<InputSchema, OutputSchema>,
): McpOperation {
  return {
    ...config,
    async execute(app, input) {
      const parsedInput = config.inputSchema.parse(input);
      const output = await config.execute(app, parsedInput);
      return config.outputSchema.parse(output);
    },
  };
}

const genericObjectOutput = z.object({}).passthrough();
const decisionIdInput = z.object({ decisionId: z.string().min(1) }).strict();
const DECISION_NOT_FOUND = 'Decision not found';

const searchKnowledge = defineOperation({
  name: 'search_knowledge',
  description:
    'Search claims and evidence in the Kotowari knowledge workspace with sourced explanations.',
  applicationCommand: 'searchKnowledge',
  action: 'knowledge.read',
  risk: 'read',
  requiredScopes: ['kotowari.retrieve'],
  inputSchema: z
    .object({
      query: z.string().min(1),
      purpose: z.string().min(1).optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      hits: z.array(z.unknown()),
      omitted: z.array(z.unknown()),
      plan: z.unknown(),
      receipt: z.unknown(),
    })
    .passthrough(),
  execute: (app, input) => app.searchKnowledge(input),
});

const searchMemory = defineOperation({
  name: 'search_memory',
  description: 'Search agent memory records scoped to the current workspace namespace.',
  applicationCommand: 'searchMemory',
  action: 'memory.read',
  risk: 'read',
  requiredScopes: ['kotowari.retrieve'],
  inputSchema: z.object({ query: z.string().min(1) }).strict(),
  outputSchema: z.array(z.unknown()),
  execute: (app, input) => app.searchMemory(input),
});

const recordMemory = defineOperation({
  name: 'record_memory',
  description: 'Record an agent or user memory note in the current workspace namespace.',
  applicationCommand: 'recordMemory',
  action: 'memory.write',
  risk: 'write',
  requiredScopes: ['kotowari.memory.write'],
  inputSchema: z.object({ body: z.string().min(1) }).strict(),
  outputSchema: genericObjectOutput,
  execute: (app, input) => app.recordMemory(input),
});

const recordDecision = defineOperation({
  name: 'record_decision',
  description:
    'Record a decision with its context snapshot, evidence, alternatives, and selected outcome.',
  applicationCommand: 'recordDecision',
  action: 'decision.record',
  risk: 'write',
  requiredScopes: ['kotowari.decision.write'],
  inputSchema: z
    .object({
      purpose: z.string().min(1).default('general'),
      query: z.string().min(1).optional(),
      selectedOutcome: z.string().min(1),
      rationale: z.string().min(1).optional(),
      alternatives: z.array(z.string().min(1)).optional(),
      confidence: z.number().min(0).max(1).default(0.5),
    })
    .strict(),
  outputSchema: genericObjectOutput,
  execute: (app, input) => app.recordDecision(input),
});

const replayDecision = defineOperation({
  name: 'replay_decision',
  description:
    'Reconstruct the exact context, retrieval receipt, and policy versions used by a decision.',
  applicationCommand: 'replayDecision',
  action: 'decision.read',
  risk: 'read',
  requiredScopes: ['kotowari.decision.read'],
  inputSchema: decisionIdInput,
  outputSchema: genericObjectOutput,
  async execute(app, input) {
    if (app.replayDecision === undefined) {
      throw new Error('Decision replay is unavailable');
    }
    const result = await app.replayDecision(input.decisionId);
    if (result === undefined) {
      throw new Error(DECISION_NOT_FOUND);
    }
    return result;
  },
});

const auditDecision = defineOperation({
  name: 'audit_decision',
  description:
    'Build an authorization-aware decision audit bundle with context, evidence, policies, events, and hashes.',
  applicationCommand: 'getDecisionAuditBundle',
  action: 'audit.read',
  risk: 'privileged',
  requiredScopes: ['kotowari.audit.read'],
  inputSchema: decisionIdInput,
  outputSchema: genericObjectOutput,
  async execute(app, input) {
    if (app.getDecisionAuditBundle === undefined) {
      throw new Error('Decision audit is unavailable');
    }
    const result = await app.getDecisionAuditBundle(input.decisionId);
    if (result === undefined) {
      throw new Error(DECISION_NOT_FOUND);
    }
    return result;
  },
});

const ingestPath = defineOperation({
  name: 'ingest_path',
  description: 'Ingest a filesystem path or inline document into the current workspace.',
  applicationCommand: 'ingestPath',
  action: 'ingestion.write',
  risk: 'write',
  requiredScopes: ['kotowari.ingestion.write'],
  inputSchema: z
    .object({
      path: z.string().min(1),
      text: z.string().optional(),
      mimeType: z.string().min(1).optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      evidenceIds: z.array(z.string()),
      claimIds: z.array(z.string()),
      entityIds: z.array(z.string()),
    })
    .passthrough(),
  async execute(app, input) {
    const dispatched = await dispatchIngest(app, input);
    if (!dispatched.ok) {
      throw new Error(String(dispatched.error));
    }
    return dispatched.result;
  },
});

const resolveConflict = defineOperation({
  name: 'resolve_conflict',
  description: 'Record a conflict resolution with a preferred claim and provenance.',
  applicationCommand: 'resolveConflict',
  action: 'conflict.resolve',
  risk: 'privileged',
  requiredScopes: ['kotowari.curation.write'],
  inputSchema: z
    .object({
      claimIds: z.array(z.string().min(1)).min(2),
      preferredClaimId: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
  outputSchema: genericObjectOutput,
  execute: (app, input) =>
    app.resolveConflict({
      claimIds: input.claimIds as [string, string, ...string[]],
      preferredClaimId: input.preferredClaimId,
      reason: input.reason,
    }),
});

const exportProv = defineOperation({
  name: 'export_prov',
  description: 'Export PROV-O for a recorded decision after application-layer authorization.',
  applicationCommand: 'exportProvO',
  action: 'audit.read',
  risk: 'privileged',
  requiredScopes: ['kotowari.audit.read'],
  inputSchema: decisionIdInput,
  outputSchema: genericObjectOutput,
  async execute(app, input) {
    const result = await app.exportProvO(input.decisionId);
    if (result === undefined) {
      throw new Error(DECISION_NOT_FOUND);
    }
    return result;
  },
});

const listPolicies = defineOperation({
  name: 'list_policies',
  description: 'List named policies in the current tenant and namespace.',
  applicationCommand: 'listPolicies',
  action: 'policy.evaluate',
  risk: 'privileged',
  requiredScopes: ['kotowari.admin'],
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ policies: z.array(z.unknown()) }).strict(),
  async execute(app) {
    return { policies: await app.listPolicies() };
  },
});

const whatIfPolicy = defineOperation({
  name: 'what_if_policy',
  description: 'Simulate a policy against past decisions without persisting the candidate policy.',
  applicationCommand: 'whatIfPolicy',
  action: 'policy.evaluate',
  risk: 'privileged',
  requiredScopes: ['kotowari.admin'],
  inputSchema: z
    .object({
      policy: z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
        })
        .passthrough(),
    })
    .strict(),
  outputSchema: z.object({ results: z.array(z.unknown()) }).strict(),
  async execute(app, input) {
    const results = await app.whatIfPolicy(
      input.policy as Parameters<KotowariApp['whatIfPolicy']>[0],
    );
    return { results };
  },
});

export const MCP_OPERATIONS = {
  search_knowledge: searchKnowledge,
  search_memory: searchMemory,
  record_memory: recordMemory,
  record_decision: recordDecision,
  replay_decision: replayDecision,
  audit_decision: auditDecision,
  ingest_path: ingestPath,
  resolve_conflict: resolveConflict,
  export_prov: exportProv,
  list_policies: listPolicies,
  what_if_policy: whatIfPolicy,
} as const;

export type McpOperationName = keyof typeof MCP_OPERATIONS;

export function mcpOperation(name: McpOperationName): McpOperation {
  return MCP_OPERATIONS[name];
}

export async function invokeMcpOperation(
  app: KotowariApp,
  name: McpOperationName,
  input: unknown,
): Promise<unknown> {
  return mcpOperation(name).execute(app, input);
}
