import { validateSemanticContract } from './semantic-contract.js';

import type { SemanticContract, SemanticContractStatus } from './semantic-contract.js';

export type SemanticContractFilter = {
  id?: string;
  status?: SemanticContractStatus;
};

export interface SemanticContractRegistry {
  put(contract: SemanticContract): Promise<void>;
  get(id: string, version: number): Promise<SemanticContract | undefined>;
  list(filter?: SemanticContractFilter): Promise<readonly SemanticContract[]>;
}

export function semanticContractKey(contract: Pick<SemanticContract, 'id' | 'version'>): string {
  return `${contract.id}@${String(contract.version)}`;
}

function stableContractJson(contract: SemanticContract): string {
  return JSON.stringify(contract);
}

function putContract(contracts: Map<string, SemanticContract>, contract: SemanticContract): void {
  const issues = validateSemanticContract(contract);
  if (issues.length > 0) {
    throw new Error(`Invalid semantic contract: ${issues.map((issue) => issue.code).join(', ')}`);
  }
  const key = semanticContractKey(contract);
  const existing = contracts.get(key);
  if (existing !== undefined && stableContractJson(existing) !== stableContractJson(contract)) {
    throw new Error(`Semantic contract versions are immutable: ${key}`);
  }
  contracts.set(key, contract);
}

function listContracts(
  contracts: Map<string, SemanticContract>,
  filter: SemanticContractFilter,
): readonly SemanticContract[] {
  return [...contracts.values()]
    .filter((contract) => filter.id === undefined || contract.id === filter.id)
    .filter((contract) => filter.status === undefined || contract.status === filter.status)
    .sort((left, right) => {
      const byId = left.id.localeCompare(right.id);
      return byId === 0 ? left.version - right.version : byId;
    });
}

export function createInMemorySemanticContractRegistry(): SemanticContractRegistry {
  const contracts = new Map<string, SemanticContract>();
  return {
    put(contract) {
      try {
        putContract(contracts, contract);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    get(id, version) {
      return Promise.resolve(contracts.get(`${id}@${String(version)}`));
    },

    list(filter = {}) {
      return Promise.resolve(listContracts(contracts, filter));
    },
  };
}

export async function latestActiveSemanticContract(
  registry: SemanticContractRegistry,
  id: string,
): Promise<SemanticContract | undefined> {
  const active = await registry.list({ id, status: 'active' });
  return active.reduce<SemanticContract | undefined>(
    (latest, contract) =>
      latest === undefined || contract.version > latest.version ? contract : latest,
    undefined,
  );
}
