import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
} from '@modelcontextprotocol/server';

import { MCP_STANDALONE_PRESET_TOOLS, type McpStandalonePreset } from './mcp-presets.js';
import { MCP_PROFILE_DEFINITIONS, type McpProfile } from './mcp-profiles.js';
import { createKotowariMcpServer, type McpAuditSink } from './mcp-server.js';

import type { KotowariApp } from '@kotowari/application';
import type { AuthInfo } from '@modelcontextprotocol/server';

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
        return verifier.verifyAccessToken(token);
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

export function createStandaloneMcpHttpHandler(input: {
  preset: McpStandalonePreset;
  app: KotowariApp;
  audit?: McpAuditSink;
}): McpFetchHandler {
  const handler = createMcpHandler(
    () =>
      createKotowariMcpServer({
        app: input.app,
        name: input.preset,
        operations: MCP_STANDALONE_PRESET_TOOLS[input.preset],
        audit: input.audit,
      }),
    { legacy: 'reject' },
  );

  return {
    fetch: (request) =>
      input.app.runAsRequest(requestHeaders(request), () => handler.fetch(request)),
    close: () => handler.close(),
  };
}

export function createMcpHttpHandler(input: {
  profile: McpProfile;
  app: KotowariApp;
  authorization?: McpAuthorization;
  audit?: McpAuditSink;
}): McpFetchHandler {
  const profile = MCP_PROFILE_DEFINITIONS[input.profile];
  const resourceMetadataUrlValue =
    input.authorization === undefined
      ? undefined
      : getOAuthProtectedResourceMetadataUrl(input.authorization.resourceServerUrl);
  const gate =
    input.authorization === undefined
      ? undefined
      : requireBearerAuth({
          verifier: verifierForSdk(input.authorization.verifier),
          requiredScopes: [...profile.requiredScopes],
          resourceMetadataUrl: resourceMetadataUrlValue,
        });

  const handler = createMcpHandler(
    (context) =>
      createKotowariMcpServer({
        app: input.app,
        name: input.profile,
        operations: profile.tools,
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
