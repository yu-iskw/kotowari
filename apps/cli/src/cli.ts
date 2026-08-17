#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ingestFilesystemPath, startKotowariServer, writeWorkspaceConfig } from '@kotowari/server';

const WORKSPACE_DIR = '.kotowari';
const CONFIG_FILE = 'kotowari.json';

function printHelp(): void {
  process.stdout.write(`kotowari <command>

Commands:
  init [directory]     Create a local workspace
  start                Serve web, REST, and MCP
  ingest <path>        Ingest files into the workspace
  doctor               Check the local workspace
  mcp --profile <name> Reserved for stdio MCP (use HTTP /mcp/<profile>)
`);
}

function dataDirFromCwd(): string {
  const configPath = join(process.cwd(), WORKSPACE_DIR, CONFIG_FILE);
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { dataDir?: string; port?: number };
    return resolve(process.cwd(), config.dataDir ?? WORKSPACE_DIR);
  }
  return join(process.cwd(), WORKSPACE_DIR);
}

function portFromCwd(): number {
  const configPath = join(process.cwd(), WORKSPACE_DIR, CONFIG_FILE);
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { port?: number };
    return config.port ?? 8787;
  }
  return 8787;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const command = argv[0] ?? 'help';
  switch (command) {
    case 'init': {
      const directory = resolve(argv[1] ?? process.cwd());
      writeWorkspaceConfig(directory, 8787);
      process.stdout.write(`Initialized Kotowari workspace in ${directory}\n`);
      return 0;
    }
    case 'start': {
      const started = await startKotowariServer({ dataDir: dataDirFromCwd(), port: portFromCwd() });
      process.stdout.write(`Kotowari listening on ${started.url}\n`);
      await new Promise(() => undefined);
      return 0;
    }
    case 'ingest': {
      const target = argv[1];
      if (target === undefined) {
        process.stderr.write('ingest requires a path\n');
        return 1;
      }
      const started = await startKotowariServer({ dataDir: dataDirFromCwd(), port: 0 });
      const result = await ingestFilesystemPath(started.app, target);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await started.close();
      return 0;
    }
    case 'doctor': {
      const dir = dataDirFromCwd();
      const ok = existsSync(join(dir, 'kotowari.json')) || existsSync(dir);
      process.stdout.write(ok ? `workspace ok: ${dir}\n` : 'run kotowari init\n');
      return ok ? 0 : 1;
    }
    case 'mcp':
      process.stdout.write('Use Streamable HTTP at /mcp/retrieve on kotowari start\n');
      return 0;
    default:
      printHelp();
      return command === 'help' || command === '--help' ? 0 : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
