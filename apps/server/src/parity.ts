export type ParitySnapshot = {
  healthOk: boolean;
  profile: string;
  claimCount: number;
  evidenceLinked: boolean;
  whySelectedPresent: boolean;
  claimHasProvenance: boolean;
  decisionHasSnapshot: boolean;
  decisionHasPolicyIds: boolean;
  decisionHasProvenance: boolean;
  decisionRoundTrip: boolean;
  evidenceHasBytes: boolean;
};

type SearchHit = {
  claimId?: string;
  whySelected?: string;
  evidenceIds?: string[];
  claim?: { provenance?: { source?: string } };
};

type SearchJson = {
  hits?: SearchHit[];
  omitted?: { reason?: string; count?: number }[];
};

type DecisionRecord = {
  id?: string;
  inputContextSnapshot?: { purpose?: string };
  applicablePolicyIds?: string[];
  consideredEvidenceIds?: string[];
  selectedOutcome?: string;
  provenance?: { source?: string };
};

async function postJson(baseUrl: string, pathname: string, body: unknown, bearer?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer !== undefined) {
    headers.authorization = `Bearer ${bearer}`;
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function getJson(baseUrl: string, pathname: string, bearer?: string) {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) {
    headers.authorization = `Bearer ${bearer}`;
  }
  const response = await fetch(`${baseUrl}${pathname}`, { headers });
  return { status: response.status, json: await response.json() };
}

export async function collectParitySnapshot(
  baseUrl: string,
  options: { ingestPath: string; bearer?: string },
): Promise<ParitySnapshot> {
  const health = await getJson(baseUrl, '/v1/health', options.bearer);
  const healthJson = health.json as { ok?: boolean; profile?: string };
  const ingested = await postJson(
    baseUrl,
    '/v1/ingest',
    { path: options.ingestPath },
    options.bearer,
  );
  const ingestJson = ingested.json as { claimIds?: string[]; evidenceIds?: string[] };
  const search = await postJson(
    baseUrl,
    '/v1/knowledge/search',
    { query: 'Vendor X CEO', purpose: 'search' },
    options.bearer,
  );
  const searchJson = search.json as SearchJson;
  const hit = searchJson.hits?.[0];
  const decision = await postJson(
    baseUrl,
    '/v1/decisions',
    {
      purpose: 'parity',
      query: 'Vendor X',
      selectedOutcome: 'use_vendor_x',
      confidence: 0.8,
    },
    options.bearer,
  );
  const decisionJson = decision.json as DecisionRecord;
  const reloaded =
    decisionJson.id === undefined
      ? { status: 404, json: {} }
      : await getJson(baseUrl, `/v1/decisions/${decisionJson.id}`, options.bearer);
  const reloadedJson = reloaded.json as DecisionRecord;
  const evidenceId = hit?.evidenceIds?.[0] ?? ingestJson.evidenceIds?.[0];
  const evidence =
    evidenceId === undefined
      ? { status: 404, json: {} }
      : await getJson(baseUrl, `/v1/evidence/${evidenceId}/content`, options.bearer);
  const evidenceJson = evidence.json as { text?: string; byteLength?: number };

  return {
    healthOk: healthJson.ok === true,
    profile: healthJson.profile ?? '',
    claimCount: ingestJson.claimIds?.length ?? 0,
    evidenceLinked: (hit?.evidenceIds?.length ?? 0) > 0,
    whySelectedPresent: typeof hit?.whySelected === 'string' && hit.whySelected.length > 0,
    claimHasProvenance:
      typeof hit?.claim?.provenance?.source === 'string' && hit.claim.provenance.source.length > 0,
    decisionHasSnapshot: decisionJson.inputContextSnapshot?.purpose === 'parity',
    decisionHasPolicyIds: (decisionJson.applicablePolicyIds?.length ?? 0) > 0,
    decisionHasProvenance:
      typeof decisionJson.provenance?.source === 'string' &&
      decisionJson.provenance.source.length > 0,
    decisionRoundTrip:
      reloadedJson.id === decisionJson.id && reloadedJson.selectedOutcome !== undefined,
    evidenceHasBytes:
      typeof evidenceJson.text === 'string'
        ? evidenceJson.text.length > 0
        : (evidenceJson.byteLength ?? 0) > 0,
  };
}

export async function collectGuestOmitSnapshot(
  baseUrl: string,
  options: { bearer: string },
): Promise<{ omittedHasPolicyFilter: boolean; hitCount: number }> {
  const search = await postJson(
    baseUrl,
    '/v1/knowledge/search',
    { query: 'Vendor X CEO', purpose: 'search' },
    options.bearer,
  );
  const searchJson = search.json as SearchJson;
  const omitted = searchJson.omitted ?? [];
  return {
    hitCount: searchJson.hits?.length ?? 0,
    omittedHasPolicyFilter: omitted.some((item) => item.reason === 'policy_filter'),
  };
}

export function semanticParityEqual(left: ParitySnapshot, right: ParitySnapshot): boolean {
  return (
    left.healthOk === right.healthOk &&
    left.claimCount === right.claimCount &&
    left.evidenceLinked === right.evidenceLinked &&
    left.whySelectedPresent === right.whySelectedPresent &&
    left.claimHasProvenance === right.claimHasProvenance &&
    left.decisionHasSnapshot === right.decisionHasSnapshot &&
    left.decisionHasPolicyIds === right.decisionHasPolicyIds &&
    left.decisionHasProvenance === right.decisionHasProvenance &&
    left.decisionRoundTrip === right.decisionRoundTrip &&
    left.evidenceHasBytes === right.evidenceHasBytes
  );
}
