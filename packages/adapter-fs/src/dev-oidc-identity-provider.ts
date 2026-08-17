import { asPrincipalId, localStandalonePrincipal } from '@kotowari/kernel';

import type { IdentityProvider, Principal } from '@kotowari/plugin-sdk';

export const DEV_OIDC_LOCAL_TOKEN = 'dev-local';
export const DEV_OIDC_GUEST_TOKEN = 'dev-guest';

function headerValue(
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

export function bearerTokenFromHeaders(
  headers: Record<string, string | undefined>,
): string | undefined {
  const raw = headerValue(headers, 'authorization');
  if (raw === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return match?.[1];
}

function guestPrincipal(): Principal {
  return {
    ...localStandalonePrincipal(),
    id: asPrincipalId('dev-guest'),
    clearance: 'public',
    roles: ['guest'],
  };
}

class DevOidcIdentityProvider implements IdentityProvider {
  async currentPrincipal(): Promise<Principal> {
    return localStandalonePrincipal();
  }

  async authenticate(headers: Record<string, string | undefined>): Promise<Principal> {
    const token = bearerTokenFromHeaders(headers);
    if (token === undefined || token === DEV_OIDC_LOCAL_TOKEN) {
      return localStandalonePrincipal();
    }
    // Dev tokens are well-known local fixtures, not secrets.
    // eslint-disable-next-line security/detect-possible-timing-attacks -- dummy Bearer tokens
    if (token === DEV_OIDC_GUEST_TOKEN) {
      return guestPrincipal();
    }
    return guestPrincipal();
  }
}

export function createDevOidcIdentityProvider(): IdentityProvider {
  return new DevOidcIdentityProvider();
}
