import { asIsoTimestamp } from './branded-ids.js';
import { KernelError } from './errors.js';

import type { IsoTimestamp, PrincipalId, ProvenanceId } from './branded-ids.js';

export type Provenance = {
  source: string;
  sourceVersion?: string;
  actor: PrincipalId;
  process: string;
  model?: string;
  promptVersion?: string;
  extractorVersion?: string;
  timestamp: IsoTimestamp;
  parentIds: readonly ProvenanceId[];
};

export function nowIso(): IsoTimestamp {
  return asIsoTimestamp(new Date().toISOString());
}

export function compactProvenance(input: {
  source: string;
  actor: PrincipalId;
  process: string;
  parentIds?: readonly ProvenanceId[];
}): Provenance {
  return {
    source: input.source,
    actor: input.actor,
    process: input.process,
    timestamp: nowIso(),
    parentIds: input.parentIds ?? [],
  };
}

export function assertProvenance(provenance: Provenance | undefined): asserts provenance is Provenance {
  if (provenance === undefined) {
    throw new KernelError('PROVENANCE_REQUIRED', 'ADR-0007 rejects a semantic write without provenance');
  }
  const required = [provenance.source, provenance.actor, provenance.process, provenance.timestamp];
  if (required.some((field) => String(field).trim().length === 0)) {
    throw new KernelError(
      'PROVENANCE_INVALID',
      'Provenance requires source, actor, process, and timestamp',
    );
  }
}

const FORBIDDEN_COT_KEYS = ['chainOfThought', 'hiddenCoT', 'privateReasoning', 'hiddenChainOfThought'];

export function assertNoChainOfThought(payload: Record<string, unknown>): void {
  for (const key of FORBIDDEN_COT_KEYS) {
    if (key in payload && payload[key] !== undefined) {
      throw new KernelError(
        'CHAIN_OF_THOUGHT_REJECTED',
        `ADR-0008 rejects hidden chain-of-thought field ${key}`,
      );
    }
  }
}
