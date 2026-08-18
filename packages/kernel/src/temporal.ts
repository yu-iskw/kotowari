export type TemporalPerspective = {
  /** Business/real-world time: what was true at this instant? */
  validAt?: string;
  /** Knowledge/system time: what had Kotowari recorded by this instant? */
  knownAt?: string;
};

export function normalizeTemporalPerspective(
  temporal: TemporalPerspective | undefined,
  legacyAsOf?: string,
): TemporalPerspective {
  if (temporal !== undefined) {
    return temporal;
  }
  return legacyAsOf === undefined ? {} : { validAt: legacyAsOf };
}
