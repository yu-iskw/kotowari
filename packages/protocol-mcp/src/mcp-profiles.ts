import type { McpOperationName, McpOperationRisk } from './operation-registry.js';

export const MCP_PROFILES = [
  'retrieve',
  'decision-read',
  'decision-write',
  'audit',
  'memory-write',
  'curation',
  'ingestion',
  'admin',
] as const;

export type McpProfile = (typeof MCP_PROFILES)[number];

export type McpProfileDefinition = {
  tools: readonly McpOperationName[];
  requiredScopes: readonly string[];
  risk: McpOperationRisk;
};

export const MCP_PROFILE_DEFINITIONS: Record<McpProfile, McpProfileDefinition> = {
  retrieve: {
    tools: ['search_knowledge', 'search_memory'],
    requiredScopes: ['kotowari.retrieve'],
    risk: 'read',
  },
  'decision-read': {
    tools: ['replay_decision'],
    requiredScopes: ['kotowari.decision.read'],
    risk: 'read',
  },
  'decision-write': {
    tools: ['record_decision'],
    requiredScopes: ['kotowari.decision.write'],
    risk: 'write',
  },
  audit: {
    tools: ['audit_decision', 'export_prov'],
    requiredScopes: ['kotowari.audit.read'],
    risk: 'privileged',
  },
  'memory-write': {
    tools: ['record_memory'],
    requiredScopes: ['kotowari.memory.write'],
    risk: 'write',
  },
  curation: {
    tools: ['resolve_conflict'],
    requiredScopes: ['kotowari.curation.write'],
    risk: 'privileged',
  },
  ingestion: {
    tools: ['ingest_path'],
    requiredScopes: ['kotowari.ingestion.write'],
    risk: 'write',
  },
  admin: {
    tools: ['list_policies', 'what_if_policy'],
    requiredScopes: ['kotowari.admin'],
    risk: 'privileged',
  },
};

export const PROFILE_TOOLS: Record<McpProfile, readonly McpOperationName[]> = Object.fromEntries(
  MCP_PROFILES.map((profile) => [profile, MCP_PROFILE_DEFINITIONS[profile].tools]),
) as Record<McpProfile, readonly McpOperationName[]>;

export function isMcpProfile(value: string): value is McpProfile {
  return (MCP_PROFILES as readonly string[]).includes(value);
}
