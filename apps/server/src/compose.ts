import {
  createDevOidcIdentityProvider,
  createOAuthIntrospectionIdentityProvider,
} from '@kotowari/adapter-fs';
import {
  createPgPoolClient,
  createPgliteClient,
  createPostgresCanonicalStore,
  createPostgresQueue,
  createPostgresRetrievalProjection,
} from '@kotowari/adapter-postgres';
import { createS3BlobStore, startInProcessS3 } from '@kotowari/adapter-s3';
import { createKotowariApp } from '@kotowari/application';
import { createFakeEmbeddingProvider, createFakeExtractionProvider } from '@kotowari/model-fake';

import { listenKotowariHttp } from './http-server.js';
import { ingestFilesystemPath } from './ingest-fs.js';
import { createProjectionServingGate } from './projection-serving.js';
import { retrievalRolloutPolicyFromEnv } from './retrieval-rollout.js';
import { embeddingDimensionsFromEnv, vectorAccelerationFromEnv } from './vector-acceleration.js';

import type { OAuthIntrospectionIdentityProvider } from '@kotowari/adapter-fs';
import type { SqlClient } from '@kotowari/adapter-postgres';
import type { S3BlobStoreOptions } from '@kotowari/adapter-s3';
import type { KotowariApp } from '@kotowari/application';
import type {
  BlobStore,
  IdentityProvider,
  Queue,
  RetrievalCandidateSource,
} from '@kotowari/plugin-sdk';

type ComposeBindings = {
  sql: SqlClient;
  blobs: BlobStore;
  identity?: IdentityProvider;
  queue?: Queue;
  retrievalCandidateSource?: RetrievalCandidateSource;
};

export function createComposeApp(bindings: ComposeBindings): KotowariApp {
  const core = createKotowariApp(
    {
      store: createPostgresCanonicalStore(bindings.sql),
      blobs: bindings.blobs,
      identity: bindings.identity ?? createDevOidcIdentityProvider(),
      queue: bindings.queue ?? createPostgresQueue(bindings.sql),
      extraction: createFakeExtractionProvider(),
      embeddings: createFakeEmbeddingProvider(),
      ...(bindings.retrievalCandidateSource === undefined
        ? {}
        : { retrievalCandidateSource: bindings.retrievalCandidateSource }),
    },
    { profile: 'compose' },
  );
  const app: KotowariApp = {
    ...core,
    ingestPath: async (target: string) => ingestFilesystemPath(app, target),
  };
  return app;
}

function s3OptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3BlobStoreOptions {
  return {
    endpoint: env['S3_ENDPOINT'] ?? 'http://127.0.0.1:9000',
    bucket: env['S3_BUCKET'] ?? 'kotowari',
    accessKeyId: env['S3_ACCESS_KEY'] ?? 'kotowari',
    secretAccessKey: env['S3_SECRET_KEY'] ?? 'kotowari-secret',
    region: env['S3_REGION'] ?? 'us-east-1',
  };
}

function requiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the enterprise profile`);
  }
  return value;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function enterpriseIdentityFromEnv(
  env: Record<string, string | undefined>,
): OAuthIntrospectionIdentityProvider {
  return createOAuthIntrospectionIdentityProvider({
    introspectionUrl: requiredEnv(env, 'OAUTH_INTROSPECTION_URL'),
    authorizationServer: requiredEnv(env, 'OAUTH_AUTHORIZATION_SERVER'),
    audience: requiredEnv(env, 'KOTOWARI_OAUTH_AUDIENCE'),
    clientId: requiredEnv(env, 'OAUTH_CLIENT_ID'),
    clientSecret: requiredEnv(env, 'OAUTH_CLIENT_SECRET'),
  });
}

export function createComposeAppFromEnv(
  env: Record<string, string | undefined> = process.env,
  identity?: IdentityProvider,
): KotowariApp {
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for the compose profile');
  }
  const sql = createPgPoolClient(databaseUrl);
  return createComposeApp({
    sql,
    blobs: createS3BlobStore(s3OptionsFromEnv(env)),
    ...(identity === undefined ? {} : { identity }),
  });
}

export async function createInProcessComposeApp(): Promise<{
  app: KotowariApp;
  close: () => Promise<void>;
}> {
  const sql = await createPgliteClient();
  const s3 = await startInProcessS3();
  const app = createComposeApp({
    sql,
    blobs: createS3BlobStore({
      endpoint: s3.endpoint,
      bucket: 'kotowari',
      accessKeyId: 'kotowari',
      secretAccessKey: 'kotowari-secret',
    }),
  });
  return { app, close: s3.close };
}

export async function startComposeServer(options: {
  port: number;
  webRoot?: string;
  env?: Record<string, string | undefined>;
}): Promise<{
  url: string;
  close: () => Promise<void>;
  app: KotowariApp;
}> {
  const env = options.env ?? process.env;
  const enterprise =
    env['KOTOWARI_PROFILE'] === 'enterprise' || env['KOTOWARI_AUTH_MODE'] === 'oauth';

  if (enterprise) {
    const identity = enterpriseIdentityFromEnv(env);
    const publicBaseUrl = requiredEnv(env, 'KOTOWARI_PUBLIC_URL');
    const authorizationServer = requiredEnv(env, 'OAUTH_AUTHORIZATION_SERVER');
    const publicHost = new URL(publicBaseUrl).hostname;
    const extraHosts = (env['KOTOWARI_ALLOWED_HOSTS'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const databaseUrl = requiredEnv(env, 'DATABASE_URL');
    const sql = createPgPoolClient(databaseUrl);
    const store = createPostgresCanonicalStore(sql);
    const embeddings = createFakeEmbeddingProvider(embeddingDimensionsFromEnv(env));
    const vectorAcceleration = vectorAccelerationFromEnv(env);
    const projection = createPostgresRetrievalProjection({
      sql,
      store,
      embeddings,
      ...(vectorAcceleration === undefined ? {} : { vectorAcceleration }),
    });
    const projectionServing = createProjectionServingGate({
      projection,
      store,
      embeddings,
      policy: retrievalRolloutPolicyFromEnv(env),
    });
    const app = createComposeApp({
      sql,
      blobs: createS3BlobStore(s3OptionsFromEnv(env)),
      identity,
      retrievalCandidateSource: projectionServing.candidateSource,
    });
    return listenKotowariHttp({
      app,
      port: options.port,
      host: env['KOTOWARI_HOST'] ?? '0.0.0.0',
      webRoot: options.webRoot,
      observability: {
        health: async () => ({ ok: true, projection: await projectionServing.status() }),
        ready: async () => {
          const projectionStatus = await projectionServing.status();
          return {
            ready: projectionStatus.servingReady,
            projection: projectionStatus,
          };
        },
        metrics: () => projectionServing.metrics(),
      },
      mcpSecurity: {
        authorization: {
          verifier: identity,
          publicBaseUrl,
          authorizationServers: [authorizationServer],
        },
        allowedHosts: [publicHost, ...extraHosts],
        maxBodyBytes: positiveInt(env['KOTOWARI_MCP_MAX_BODY_BYTES'], 4 * 1024 * 1024),
        requestTimeoutMs: positiveInt(env['KOTOWARI_MCP_TIMEOUT_MS'], 30_000),
        rateLimit: {
          maxRequests: positiveInt(env['KOTOWARI_MCP_RATE_LIMIT'], 120),
          windowMs: positiveInt(env['KOTOWARI_MCP_RATE_WINDOW_MS'], 60_000),
        },
      },
    });
  }

  if (env['DATABASE_URL'] !== undefined && env['DATABASE_URL'].length > 0) {
    return listenKotowariHttp({
      app: createComposeAppFromEnv(env),
      port: options.port,
      host: '127.0.0.1',
      webRoot: options.webRoot,
    });
  }
  const inProcess = await createInProcessComposeApp();
  const started = await listenKotowariHttp({
    app: inProcess.app,
    port: options.port,
    host: '127.0.0.1',
    webRoot: options.webRoot,
  });
  return {
    ...started,
    close: async () => {
      await started.close();
      await inProcess.close();
    },
  };
}
