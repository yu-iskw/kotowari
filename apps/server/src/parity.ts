export type ParitySnapshot = {
  healthOk: boolean;
  profile: string;
  claimCount: number;
  evidenceLinked: boolean;
  whySelectedPresent: boolean;
  decisionHasSnapshot: boolean;
  decisionHasPolicyIds: boolean;
  evidenceHasBytes: boolean;
};

type SearchHit = {
  claimId?: string;
  whySelected?: string;
  evidenceIds?: string[];
};

type DecisionRecord = {
  id?: string;
  inputContextSnapshot?: { purpose?: string };
  applicablePolicyIds?: string[];
  consideredEvidenceIds?: string[];
  selectedOutcome?: string;
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
  const searchJson = search.json as { hits?: SearchHit[] };
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
    decisionHasSnapshot: decisionJson.inputContextSnapshot?.purpose === 'parity',
    decisionHasPolicyIds: (decisionJson.applicablePolicyIds?.length ?? 0) > 0,
    evidenceHasBytes:
      typeof evidenceJson.text === 'string'
        ? evidenceJson.text.length > 0
        : (evidenceJson.byteLength ?? 0) > 0,
  };
}

export function semanticParityEqual(left: ParitySnapshot, right: ParitySnapshot): boolean {
  return (
    left.healthOk === right.healthOk &&
    left.claimCount === right.claimCount &&
    left.evidenceLinked === right.evidenceLinked &&
    left.whySelectedPresent === right.whySelectedPresent &&
    left.decisionHasSnapshot === right.decisionHasSnapshot &&
    left.decisionHasPolicyIds === right.decisionHasPolicyIds &&
    left.evidenceHasBytes === right.evidenceHasBytes
  );
}
