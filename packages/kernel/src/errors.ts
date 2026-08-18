export const KERNEL_ERROR_CODES = [
  'INVALID_ID',
  'PROVENANCE_REQUIRED',
  'PROVENANCE_INVALID',
  'MISSING_CONTEXT_SNAPSHOT',
  'CHAIN_OF_THOUGHT_REJECTED',
  'BITEMPORAL_INVALID',
  'INVALID_STATUS_TRANSITION',
  'EVIDENCE_REQUIRED',
  'INVALID_CONFIDENCE',
  'NAMESPACE_MISMATCH',
  'CROSS_TENANT_DENIED',
  'CLASSIFICATION_DENIED',
  'VISIBILITY_DENIED',
  'DELEGATION_DENIED',
  'NAMESPACE_DENIED',
  'ACTION_DENIED',
  'ALLOW',
] as const;

export type KernelErrorCode = (typeof KERNEL_ERROR_CODES)[number];

export class KernelError extends Error {
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.name = 'KernelError';
    this.code = code;
  }
}
