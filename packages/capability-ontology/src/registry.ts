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

export function createInMemorySemanticContractRegistry(): SemanticContractRegistry {
  const contracts = new Map<string, SemanticContract>();
  return {
    async put(contract) {
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
    },

    async get(id, version) {
      return contracts.get(`${id}@${String(version)}`);
    },

    async list(filter = {}) {
      return [...contracts.values()]
        .filter((contract) => filter.id === undefined || contract.id === filter.id)
        .filter((contract) => filter.status === undefined || contract.status === filter.status)
        .sort((left, right) => {
          const byId = left.id.localeCompare(right.id);
          return byId === 0 ? left.version - right.version : byId;
        });
    },
  };
}

export async function latestActiveSemanticContract(
  registry: SemanticContractRegistry,
  id: string,
): Promise<SemanticContract | undefined> {
  const active = await registry.list({ id, status: 'active' });
  return active.reduce<SemanticContract | undefined>(
    (latest, contract) => (latest === undefined || contract.version > latest.version ? contract : latest),
    undefined,
  );
}
