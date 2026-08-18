import { MCP_OPERATIONS, type McpOperationName } from './operation-registry.js';

export const MCP_STANDALONE_PRESETS = ['readonly', 'personal', 'advanced'] as const;

export type McpStandalonePreset = (typeof MCP_STANDALONE_PRESETS)[number];

export const DEFAULT_MCP_STANDALONE_PRESET: McpStandalonePreset = 'personal';

const ALL_OPERATIONS = Object.keys(MCP_OPERATIONS) as McpOperationName[];

export const MCP_STANDALONE_PRESET_TOOLS: Record<
  McpStandalonePreset,
  readonly McpOperationName[]
> = {
  readonly: ['search_knowledge', 'search_memory', 'replay_decision', 'audit_decision'],
  personal: [
    'search_knowledge',
    'search_memory',
    'record_memory',
    'record_decision',
    'replay_decision',
    'audit_decision',
  ],
  advanced: ALL_OPERATIONS,
};

export function isMcpStandalonePreset(value: string): value is McpStandalonePreset {
  return (MCP_STANDALONE_PRESETS as readonly string[]).includes(value);
}
