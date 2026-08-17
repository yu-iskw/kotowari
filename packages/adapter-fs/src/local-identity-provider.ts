import { localStandalonePrincipal } from '@kotowari/kernel';
import type { IdentityProvider, Principal } from '@kotowari/plugin-sdk';

class LocalIdentityProvider implements IdentityProvider {
  constructor(private readonly principal: Principal) {}

  async currentPrincipal(): Promise<Principal> {
    return this.principal;
  }
}

export function createLocalIdentityProvider(principal?: Principal): IdentityProvider {
  return new LocalIdentityProvider(principal ?? localStandalonePrincipal());
}
