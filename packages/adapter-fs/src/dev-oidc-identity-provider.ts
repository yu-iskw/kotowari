import { asPrincipalId, localStandalonePrincipal } from '@kotowari/kernel';
import {
  bearerTokenFromHeaders,
  type IdentityProvider,
  type Principal,
} from '@kotowari/plugin-sdk';

export const DEV_OIDC_LOCAL_TOKEN = 'dev-local';
export const DEV_OIDC_GUEST_TOKEN = 'dev-guest';

export { bearerTokenFromHeaders };

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
    // Dev tokens are well-known local fixtures, not secrets.
    // eslint-disable-next-line security/detect-possible-timing-attacks -- dummy Bearer tokens
    if (token === undefined) {
      return guestPrincipal();
    }
    // eslint-disable-next-line security/detect-possible-timing-attacks -- dummy Bearer tokens
    if (token === DEV_OIDC_LOCAL_TOKEN) {
      return localStandalonePrincipal();
    }
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
