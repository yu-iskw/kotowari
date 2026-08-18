export const MCP_PROFILES = ['retrieve', 'knowledge', 'memory', 'ingestion', 'admin'] as const;

export type McpProfile = (typeof MCP_PROFILES)[number];

export const PROFILE_TOOLS: Record<McpProfile, readonly string[]> = {
  retrieve: ['search_knowledge', 'search_memory', 'record_decision'],
  knowledge: ['search_knowledge', 'record_decision', 'resolve_conflict'],
  memory: ['search_memory', 'record_memory'],
  ingestion: ['ingest_path'],
  admin: ['list_policies', 'what_if_policy', 'replay_decision', 'audit_decision', 'export_prov'],
};

export function isMcpProfile(value: string): value is McpProfile {
  return (MCP_PROFILES as readonly string[]).includes(value);
}
