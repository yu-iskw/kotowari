import { McpServer } from '@modelcontextprotocol/server';

import { MCP_PROFILE_DEFINITIONS, type McpProfile } from './mcp-profiles.js';
import { mcpOperation, type McpOperationRisk } from './operation-registry.js';

import type { KotowariApp } from '@kotowari/application';

export type McpAuditEvent = {
  event: 'mcp.tool';
  profile: McpProfile;
  tool: string;
  action: string;
  risk: McpOperationRisk;
  clientId?: string;
  outcome: 'success' | 'denied' | 'error';
  durationMs: number;
};

export type McpAuditSink = (event: McpAuditEvent) => void | Promise<void>;

export type CreateKotowariMcpServerInput = {
  app: KotowariApp;
  profile: McpProfile;
  enforceScopes?: boolean;
  scopes?: readonly string[];
  clientId?: string;
  audit?: McpAuditSink;
};

function hasRequiredScopes(
  granted: readonly string[] | undefined,
  required: readonly string[],
): boolean {
  return granted !== undefined && required.every((scope) => granted.includes(scope));
}

function resultText(output: unknown): string {
  const serialized = JSON.stringify(output);
  const maxChars = 8_000;
  return serialized.length <= maxChars
    ? serialized
    : `${serialized.slice(0, maxChars)}… [truncated; full value is in structuredContent]`;
}

export function createKotowariMcpServer(input: CreateKotowariMcpServerInput): McpServer {
  const server = new McpServer({ name: `kotowari-${input.profile}`, version: '0.1.0' });
  const profile = MCP_PROFILE_DEFINITIONS[input.profile];

  for (const toolName of profile.tools) {
    const operation = mcpOperation(toolName);
    server.registerTool(
      operation.name,
      {
        description: operation.description,
        inputSchema: operation.inputSchema,
        outputSchema: operation.outputSchema,
        annotations: {
          readOnlyHint: operation.risk === 'read',
          destructiveHint: operation.risk === 'privileged',
          idempotentHint: operation.risk === 'read',
          openWorldHint: false,
        },
        _meta: {
          'com.kotowari/security': {
            action: operation.action,
            risk: operation.risk,
            requiredScopes: [...operation.requiredScopes],
          },
        },
      },
      async (rawInput) => {
        const startedAt = Date.now();
        if (
          input.enforceScopes === true &&
          !hasRequiredScopes(input.scopes, operation.requiredScopes)
        ) {
          await input.audit?.({
            event: 'mcp.tool',
            profile: input.profile,
            tool: operation.name,
            action: operation.action,
            risk: operation.risk,
            ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
            outcome: 'denied',
            durationMs: Date.now() - startedAt,
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: `insufficient_scope: ${operation.name} requires ${operation.requiredScopes.join(' ')}`,
              },
            ],
            isError: true,
          };
        }

        try {
          const output = await operation.execute(input.app, rawInput);
          await input.audit?.({
            event: 'mcp.tool',
            profile: input.profile,
            tool: operation.name,
            action: operation.action,
            risk: operation.risk,
            ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
            outcome: 'success',
            durationMs: Date.now() - startedAt,
          });
          return {
            content: [{ type: 'text' as const, text: resultText(output) }],
            structuredContent: output,
          };
        } catch {
          await input.audit?.({
            event: 'mcp.tool',
            profile: input.profile,
            tool: operation.name,
            action: operation.action,
            risk: operation.risk,
            ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
            outcome: 'error',
            durationMs: Date.now() - startedAt,
          });
          return {
            content: [{ type: 'text' as const, text: `${operation.name} failed` }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
