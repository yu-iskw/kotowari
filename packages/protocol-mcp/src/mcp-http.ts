import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
} from '@modelcontextprotocol/server';

import { MCP_PROFILE_DEFINITIONS, type McpProfile } from './mcp-profiles.js';
import { createKotowariMcpServer, type McpAuditSink } from './mcp-server.js';

import type { AuthInfo } from '@modelcontextprotocol/server';
import type { KotowariApp } from '@kotowari/application';

export type McpVerifiedToken = {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
};

export type McpTokenVerifier = {
  verifyAccessToken: (token: string) => Promise<McpVerifiedToken>;
};

export type McpAuthorization = {
  verifier: McpTokenVerifier;
  resourceServerUrl: URL;
  authorizationServers: readonly string[];
};

export type McpFetchHandler = {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
  resourceMetadataUrl?: URL;
};

function requestHeaders(request: Request): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function verifierForSdk(verifier: McpTokenVerifier) {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        return (await verifier.verifyAccessToken(token)) as AuthInfo;
      } catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token');
      }
    },
  };
}

export function protectedResourceMetadata(input: {
  profile: McpProfile;
  resourceServerUrl: URL;
  authorizationServers: readonly string[];
}): Record<string, unknown> {
  return {
    resource: input.resourceServerUrl.href,
    authorization_servers: [...input.authorizationServers],
    scopes_supported: [...MCP_PROFILE_DEFINITIONS[input.profile].requiredScopes],
    bearer_methods_supported: ['header'],
  };
}

export function createMcpHttpHandler(input: {
  profile: McpProfile;
  app: KotowariApp;
  authorization?: McpAuthorization;
  audit?: McpAuditSink;
}): McpFetchHandler {
  const resourceMetadataUrlValue =
    input.authorization === undefined
      ? undefined
      : getOAuthProtectedResourceMetadataUrl(input.authorization.resourceServerUrl);
  const gate =
    input.authorization === undefined
      ? undefined
      : requireBearerAuth({
          verifier: verifierForSdk(input.authorization.verifier),
          requiredScopes: [...MCP_PROFILE_DEFINITIONS[input.profile].requiredScopes],
          resourceMetadataUrl: resourceMetadataUrlValue,
        });

  const handler = createMcpHandler(
    (context) =>
      createKotowariMcpServer({
        app: input.app,
        profile: input.profile,
        enforceScopes: gate !== undefined,
        scopes: context.authInfo?.scopes,
        clientId: context.authInfo?.clientId,
        audit: input.audit,
      }),
    { legacy: 'reject' },
  );

  return {
    ...(resourceMetadataUrlValue === undefined
      ? {}
      : { resourceMetadataUrl: new URL(resourceMetadataUrlValue) }),
    async fetch(request) {
      let authInfo: AuthInfo | undefined;
      if (gate !== undefined) {
        const gated = await gate(request);
        if (gated instanceof Response) {
          return gated;
        }
        authInfo = gated;
      }
      return input.app.runAsRequest(requestHeaders(request), () =>
        authInfo === undefined ? handler.fetch(request) : handler.fetch(request, { authInfo }),
      );
    },
    close: () => handler.close(),
  };
}
