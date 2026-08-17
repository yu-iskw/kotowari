import { dispatchIngest } from '@kotowari/application';

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
    '/v1/memory': { get: {}, post: {} },
  },
} as const;

export type RestRequest = {
  method: string;
  pathname: string;
  body: unknown;
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
  'GET /v1/decisions': async (app) => ({ status: 200, json: await app.listDecisions() }),
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

export async function handleRest(app: KotowariApp, request: RestRequest): Promise<RestResponse> {
  const key = `${request.method} ${request.pathname}`;
  const exact = ROUTES[key];
  if (exact !== undefined) {
    return exact(app, asRecord(request.body));
  }
  if (request.method === 'GET' && request.pathname.startsWith('/v1/decisions/')) {
    const id = request.pathname.slice('/v1/decisions/'.length);
    const decision = await app.getDecision(id);
    return decision === undefined
      ? { status: 404, json: { error: 'not found' } }
      : { status: 200, json: decision };
  }
  return { status: 404, json: { error: `No route for ${request.method} ${request.pathname}` } };
}
