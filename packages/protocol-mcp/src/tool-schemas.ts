export type JsonSchemaObject = {
  type: 'object';
  properties: Record<string, unknown>;
  required: readonly string[];
  additionalProperties: boolean;
};

export type McpToolSchema = {
  description: string;
  inputSchema: JsonSchemaObject;
};

const DECISION_ID_INPUT: JsonSchemaObject = {
  type: 'object',
  properties: {
    decisionId: { type: 'string', description: 'Recorded decision id.' },
  },
  required: ['decisionId'],
  additionalProperties: false,
};

export const TOOL_SCHEMAS: Record<string, McpToolSchema> = {
  search_knowledge: {
    description:
      'Search claims and evidence in the Kotowari knowledge workspace with sourced explanations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language question or keywords to search knowledge.',
        },
        purpose: {
          type: 'string',
          description: 'Retrieval purpose used for policy filtering and context assembly.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  search_memory: {
    description: 'Search agent memory records scoped to the current workspace namespace.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query for memory recall.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  record_memory: {
    description: 'Record an agent or user memory note in the current workspace namespace.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Memory text to persist.' },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
  record_decision: {
    description:
      'Record a decision with context snapshot, considered evidence, and selected outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        purpose: { type: 'string', description: 'Why this decision is being recorded.' },
        query: { type: 'string', description: 'Question used to assemble the context snapshot.' },
        selectedOutcome: {
          type: 'string',
          description: 'The selected decision outcome label.',
        },
        rationale: {
          type: 'string',
          description: 'Brief rationale for the decision (not hidden chain-of-thought).',
        },
        alternatives: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alternative outcomes that were considered.',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence in the selected outcome.',
        },
      },
      required: ['selectedOutcome'],
      additionalProperties: false,
    },
  },
  replay_decision: {
    description:
      'Reconstruct the exact context, retrieval receipt, and policy versions used by a decision.',
    inputSchema: DECISION_ID_INPUT,
  },
  audit_decision: {
    description:
      'Build a decision audit bundle with context, claims, evidence, policy versions, authorization receipts, events, and content hashes.',
    inputSchema: DECISION_ID_INPUT,
  },
  ingest_path: {
    description: 'Ingest a filesystem path or inline document into the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Filesystem path or relative document name.' },
        text: { type: 'string', description: 'Inline document text when not reading a path.' },
        mimeType: { type: 'string', description: 'MIME type for inline text ingest.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  resolve_conflict: {
    description: 'Record a conflict resolution with a preferred claim and provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        claimIds: { type: 'array', items: { type: 'string' }, minItems: 2 },
        preferredClaimId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['claimIds', 'preferredClaimId', 'reason'],
      additionalProperties: false,
    },
  },
  export_prov: {
    description: 'Export PROV-O for a recorded decision.',
    inputSchema: DECISION_ID_INPUT,
  },
  list_policies: {
    description: 'List named policies in the current tenant.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  what_if_policy: {
    description: 'Simulate a policy against past decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        policy: { type: 'object', description: 'Policy record to evaluate.' },
      },
      required: ['policy'],
      additionalProperties: false,
    },
  },
};

export function toolDescriptor(name: string): { name: string } & McpToolSchema {
  const schema = TOOL_SCHEMAS[name];
  if (schema === undefined) {
    return {
      name,
      description: name,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    };
  }
  return { name, ...schema };
}
