import { ApplicationError } from './errors.js';

export function requireClaimIds(value: unknown): readonly [string, string, ...string[]] {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    return value as [string, string, ...string[]];
  }
  throw new ApplicationError('claimIds must be an array of at least two non-empty strings', 400);
}
