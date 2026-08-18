import { createHash } from 'node:crypto';

import { asNamespaceId, asPrincipalId, asTenantId, isClassification } from '@kotowari/kernel';

import { bearerTokenFromHeaders } from './dev-oidc-identity-provider.js';

import type { Classification, Principal } from '@kotowari/kernel';
import type { IdentityProvider } from '@kotowari/plugin-sdk';

export type VerifiedAccessToken = {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
};

export type OAuthIntrospectionIdentityProvider = IdentityProvider & {
  verifyAccessToken(token: string): Promise<VerifiedAccessToken>;
};

export type OAuthIntrospectionIdentityProviderOptions = {
  introspectionUrl: string;
  authorizationServer: string;
  audience: string;
  clientId: string;
  clientSecret: string;
  cacheTtlMs?: number;
  fetchFn?: typeof fetch;
};

type IntrospectionPayload = Record<string, unknown>;

type CachedIntrospection = {
  payload: IntrospectionPayload;
  expiresAtMs: number;
};

function requireHttps(name: string, value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use https`);
  }
  return url;
}

function requiredString(payload: IntrospectionPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`OAuth introspection response is missing ${key}`);
  }
  return value;
}

function optionalString(payload: IntrospectionPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string') {
    return value.split(/[\s,]+/u).filter((item) => item.length > 0);
  }
  return [];
}

function tokenScopes(payload: IntrospectionPayload): string[] {
  const scopes = stringArray(payload['scope']);
  return scopes.length > 0 ? scopes : stringArray(payload['scp']);
}

function audienceValues(payload: IntrospectionPayload): string[] {
  const audience = payload['aud'];
  if (typeof audience === 'string') {
    return [audience];
  }
  return stringArray(audience);
}

function namespaceValues(payload: IntrospectionPayload): string[] {
  const namespaces = stringArray(payload['namespace_ids']);
  if (namespaces.length > 0) {
    return namespaces;
  }
  const namespace = optionalString(payload, 'namespace_id');
  return namespace === undefined ? [] : [namespace];
}

function clearanceFrom(payload: IntrospectionPayload): Classification {
  const value = payload['classification'];
  return typeof value === 'string' && isClassification(value) ? value : 'public';
}

function principalFrom(payload: IntrospectionPayload): Principal {
  const subject = optionalString(payload, 'sub') ?? requiredString(payload, 'client_id');
  const tenantId = asTenantId(requiredString(payload, 'tenant_id'));
  const namespaceIds = namespaceValues(payload).map(asNamespaceId);
  if (namespaceIds.length === 0) {
    throw new Error('OAuth introspection response is missing namespace_ids');
  }
  const roles = stringArray(payload['roles']);
  const common = {
    id: asPrincipalId(subject),
    tenantId,
    namespaceIds,
    roles,
    clearance: clearanceFrom(payload),
  };

  if (payload['principal_type'] === 'agent') {
    const actingFor = optionalString(payload, 'acting_for');
    return {
      kind: 'agent',
      ...common,
      ...(actingFor === undefined ? {} : { actingFor: asPrincipalId(actingFor) }),
    };
  }
  return { kind: 'human', ...common };
}

export function createOAuthIntrospectionIdentityProvider(
  options: OAuthIntrospectionIdentityProviderOptions,
): OAuthIntrospectionIdentityProvider {
  const introspectionUrl = requireHttps('introspectionUrl', options.introspectionUrl);
  const authorizationServer = requireHttps('authorizationServer', options.authorizationServer).href;
  if (
    options.audience.length === 0 ||
    options.clientId.length === 0 ||
    options.clientSecret.length === 0
  ) {
    throw new Error('audience, clientId, and clientSecret are required for OAuth introspection');
  }
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;
  const cache = new Map<string, CachedIntrospection>();

  async function introspect(token: string): Promise<IntrospectionPayload> {
    if (token.length === 0) {
      throw new Error('Bearer token is empty');
    }
    const cacheKey = createHash('sha256').update(token).digest('hex');
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAtMs > now) {
      return cached.payload;
    }

    const response = await fetchFn(introspectionUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
    });
    if (!response.ok) {
      throw new Error(`OAuth token introspection failed with HTTP ${String(response.status)}`);
    }
    const payload = (await response.json()) as IntrospectionPayload;
    // The OAuth introspection `active` flag is public metadata, not secret material.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (payload['active'] !== true) {
      throw new Error('OAuth access token is inactive');
    }
    const exp = payload['exp'];
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= Math.floor(now / 1000)) {
      throw new Error('OAuth access token is expired or missing exp');
    }
    if (!audienceValues(payload).includes(options.audience)) {
      throw new Error('OAuth access token audience does not match Kotowari');
    }
    const issuer = optionalString(payload, 'iss');
    if (issuer !== undefined && issuer !== authorizationServer) {
      throw new Error(
        'OAuth access token issuer does not match the configured authorization server',
      );
    }

    const expiresAtMs = Math.min(exp * 1000, now + cacheTtlMs);
    cache.set(cacheKey, { payload, expiresAtMs });
    if (cache.size > 2_048) {
      for (const [key, value] of cache) {
        if (value.expiresAtMs <= now) {
          cache.delete(key);
        }
      }
    }
    return payload;
  }

  return {
    async currentPrincipal() {
      throw new Error('OAuth identity requires an authenticated request');
    },
    async authenticate(headers) {
      const token = bearerTokenFromHeaders(headers);
      if (token === undefined) {
        throw new Error('Bearer token is required');
      }
      return principalFrom(await introspect(token));
    },
    async verifyAccessToken(token) {
      const payload = await introspect(token);
      const expiresAt = payload['exp'];
      if (typeof expiresAt !== 'number') {
        throw new Error('OAuth access token is missing exp');
      }
      return {
        token,
        clientId: optionalString(payload, 'client_id') ?? requiredString(payload, 'sub'),
        scopes: tokenScopes(payload),
        expiresAt,
      };
    },
  };
}
