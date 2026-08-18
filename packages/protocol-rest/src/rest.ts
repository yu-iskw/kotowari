import { ApplicationError, dispatchIngest, requireClaimIds } from '@kotowari/application';

import type { KotowariApp } from '@kotowari/application';

export const OPENAPI_SNAPSHOT = {
  openapi: '3.1.0',
  info: { title: 'Kotowari REST', version: 'v1' },
  paths: {
    '/v1/health': { get: {} },
    '/v1/ingest': { post: {} },
    '/v1/knowledge/search': { post: {} },
    '/v1/context/build': { post: {} },
    '/v1/decisions': { get: {}, post: {} },
    '/v1/conflicts': { get: {}, post: {} },
    '/v1/jobs': { get: {} },
    '/v1/me': { get: {} },
    '/v1/memory': { get: {}, post: {} },
    '/v1/evidence/{id}': { get: {} },
    '/v1/evidence/{id}/content': { get: {} },
    '/v1/decisions/{id}': { get: {} },
    '/v1/decisions/{id}/prov': { get: {} },
    '/v1/decisions/{id}/export': { get: {} },
  },
} as const;

export type RestRequest = {
  method: string;
  pathname: string;
  body: unknown;
  headers?: Record<string, string | undefined>;
};

export type RestResponse = {
  status: number;
  json: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === 'string');
}

async function handleIngest(
  app: KotowariApp,
  body: Record<string, unknown>,
): Promise<RestResponse> {
  const dispatched = await dispatchIngest(app, body);
  if (!dispatched.ok) {
    return { status: 400, json: { error: dispatched.error } };
  }
  return { status: 202, json: dispatched.result };
}

type RouteHandler = (
  app: KotowariApp,
  body: Record<string, unknown>,
) => RestResponse | Promise<RestResponse>;

const ROUTES: Record<string, RouteHandler> = {
  'GET /v1/health': (app) => ({ status: 200, json: app.health() }),
  'GET /openapi.json': () => ({ status: 200, json: OPENAPI_SNAPSHOT }),
  'POST /v1/knowledge/search': async (app, body) => ({
    status: 200,
    json: await app.searchKnowledge({
      query: asString(body['query']),
      purpose: typeof body['purpose'] === 'string' ? body['purpose'] : undefined,
      asOf: typeof body['asOf'] === 'string' ? body['asOf'] : undefined,
    }),
  }),
  'POST /v1/context/build': async (app, body) => ({
    status: 200,
    json: await app.buildContext({
      purpose: asString(body['purpose'], 'general'),
      query: typeof body['query'] === 'string' ? body['query'] : undefined,
    }),
  }),
  'POST /v1/decisions': async (app, body) => ({
    status: 201,
    json: await app.recordDecision({
      purpose: asString(body['purpose'], 'general'),
      query: typeof body['query'] === 'string' ? body['query'] : undefined,
      selectedOutcome: asString(body['selectedOutcome']),
      alternatives: asStringArray(body['alternatives']),
      confidence: asNumber(body['confidence'], 0.5),
      rationale: typeof body['rationale'] === 'string' ? body['rationale'] : undefined,
    }),
  }),
  'GET /v1/decisions': async (app, body) => {
    const query = asString(body['query']);
    if (query.length > 0) {
      return { status: 200, json: await app.searchDecisions({ query }) };
    }
    return { status: 200, json: await app.listDecisions() };
  },
  'GET /v1/conflicts': async (app) => ({ status: 200, json: await app.listConflicts() }),
  'POST /v1/conflicts': async (app, body) => ({
    status: 201,
    json: await app.resolveConflict({
      claimIds: requireClaimIds(body['claimIds']),
      preferredClaimId: asString(body['preferredClaimId']),
      reason: asString(body['reason']),
    }),
  }),
  'GET /v1/jobs': async (app) => ({ status: 200, json: await app.listJobs() }),
  'GET /v1/me': async (app) => {
    const principal = await app.currentPrincipal();
    return { status: 200, json: principal };
  },
  'POST /v1/memory': async (app, body) => ({
    status: 201,
    json: await app.recordMemory({ body: asString(body['body']) }),
  }),
  'GET /v1/memory': async (app, body) => ({
    status: 200,
    json: await app.searchMemory({ query: asString(body['query']) }),
  }),
  'POST /v1/ingest': async (app, body) => handleIngest(app, body),
};

function evidenceIdFromPath(pathname: string): { id: string; content: boolean } | undefined {
  if (!pathname.startsWith('/v1/evidence/')) {
    return undefined;
  }
  const rest = pathname.slice('/v1/evidence/'.length);
  if (rest.endsWith('/content')) {
    return { id: rest.slice(0, -'/content'.length), content: true };
  }
  return { id: rest, content: false };
}

function decisionPath(
  pathname: string,
): { id: string; kind: 'get' | 'prov' | 'export' } | undefined {
  if (!pathname.startsWith('/v1/decisions/')) {
    return undefined;
  }
  const rest = pathname.slice('/v1/decisions/'.length);
  if (rest.endsWith('/prov')) {
    return { id: rest.slice(0, -'/prov'.length), kind: 'prov' };
  }
  if (rest.endsWith('/export')) {
    return { id: rest.slice(0, -'/export'.length), kind: 'export' };
  }
  return { id: rest, kind: 'get' };
}

async function handleDynamicGet(
  app: KotowariApp,
  pathname: string,
): Promise<RestResponse | undefined> {
  const evidence = evidenceIdFromPath(pathname);
  if (evidence !== undefined) {
    if (evidence.content) {
      const content = await app.getEvidenceContent(evidence.id);
      return content === undefined
        ? { status: 404, json: { error: 'not found' } }
        : {
            status: 200,
            json: {
              id: content.evidence.id,
              uri: content.evidence.uri,
              mimeType: content.contentType,
              title: content.evidence.title,
              byteLength: content.bytes.byteLength,
              text: content.text,
            },
          };
    }
    const item = await app.getEvidence(evidence.id);
    return item === undefined
      ? { status: 404, json: { error: 'not found' } }
      : { status: 200, json: item };
  }
  const decision = decisionPath(pathname);
  if (decision !== undefined) {
    if (decision.kind === 'prov') {
      const prov = await app.exportProvO(decision.id);
      return prov === undefined
        ? { status: 404, json: { error: 'not found' } }
        : { status: 200, json: prov };
    }
    const record = await app.getDecision(decision.id);
    if (record === undefined) {
      return { status: 404, json: { error: 'not found' } };
    }
    return { status: 200, json: record };
  }
  return undefined;
}

async function dispatch(app: KotowariApp, request: RestRequest): Promise<RestResponse> {
  const key = `${request.method} ${request.pathname}`;
  const exact = ROUTES[key];
  if (exact !== undefined) {
    return exact(app, asRecord(request.body));
  }
  if (request.method === 'GET') {
    const dynamic = await handleDynamicGet(app, request.pathname);
    if (dynamic !== undefined) {
      return dynamic;
    }
  }
  return { status: 404, json: { error: `No route for ${request.method} ${request.pathname}` } };
}

export async function handleRest(app: KotowariApp, request: RestRequest): Promise<RestResponse> {
  try {
    return await app.runAsRequest(request.headers ?? {}, () => dispatch(app, request));
  } catch (error) {
    if (error instanceof ApplicationError) {
      return { status: error.status, json: { error: error.message } };
    }
    throw error;
  }
}
