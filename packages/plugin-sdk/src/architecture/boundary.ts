import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type PackageBoundary = {
  name: string;
  allowedDependencies: readonly string[];
  forbiddenDependencies: readonly string[];
};

export type BoundaryResult = {
  ok: boolean;
  violations: string[];
};

function globToRegExp(pattern: string): RegExp {
  let regex = '^';
  for (const char of pattern) {
    if (char === '*') {
      regex += '.*';
    } else if ('\\^$+?.()|{}[]'.includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  regex += '$';
  return new RegExp(regex, 'u');
}

function parseSimpleYaml(content: string): PackageBoundary {
  const lines = content.split('\n');
  let name = '';
  let section: 'allowed' | 'forbidden' | undefined;
  const allowedDependencies: string[] = [];
  const forbiddenDependencies: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('name:')) {
      name = line.slice('name:'.length).trim();
      continue;
    }
    if (line === 'allowedDependencies:') {
      section = 'allowed';
      continue;
    }
    if (line === 'forbiddenDependencies:') {
      section = 'forbidden';
      continue;
    }
    if (line.startsWith('- ')) {
      let value = line.slice(2).trim();
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1);
      }
      if (section === 'allowed') {
        allowedDependencies.push(value);
      } else if (section === 'forbidden') {
        forbiddenDependencies.push(value);
      }
    }
  }

  return { name, allowedDependencies, forbiddenDependencies };
}

function dependencyMatchesPattern(dependency: string, pattern: string): boolean {
  return globToRegExp(pattern).test(dependency);
}

function dependencyMatchesAny(dependency: string, patterns: readonly string[]): string | undefined {
  return patterns.find((pattern) => dependencyMatchesPattern(dependency, pattern));
}

function normalizeAllowedToken(token: string): string {
  if (token.startsWith('@')) {
    return token;
  }
  return `@kotowari/${token}`;
}

function isAllowedDependency(dependency: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) {
    return true;
  }
  return allowed.some((token) => {
    const normalized = normalizeAllowedToken(token);
    return dependency === normalized || dependency.endsWith(`/${token}`) || dependency === token;
  });
}

function collectPackageJsonDependencies(packageJsonPath: string): string[] {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
}

const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gu;

function collectSourceImports(srcDir: string): { file: string; specifier: string }[] {
  const imports: { file: string; specifier: string }[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) {
        continue;
      }
      const content = readFileSync(fullPath, 'utf8');
      for (const match of content.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1];
        if (specifier !== undefined && !specifier.startsWith('.') && !specifier.startsWith('node:')) {
          imports.push({ file: fullPath, specifier });
        }
      }
    }
  }

  if (existsSync(srcDir)) {
    walk(srcDir);
  }

  return imports;
}

function findPackageDirs(repoRoot: string): string[] {
  const roots = ['packages', 'apps', 'plugins'].map((segment) => join(repoRoot, segment));
  const dirs: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (existsSync(join(dir, 'package-boundary.yaml'))) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
}

export function assertPackageBoundaries(repoRoot: string): BoundaryResult {
  const violations: string[] = [];

  for (const packageDir of findPackageDirs(repoRoot)) {
    const boundaryPath = join(packageDir, 'package-boundary.yaml');
    const boundary = parseSimpleYaml(readFileSync(boundaryPath, 'utf8'));
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageName = boundary.name || JSON.parse(readFileSync(packageJsonPath, 'utf8')).name;
    const dependencies = collectPackageJsonDependencies(packageJsonPath);

    for (const dependency of dependencies) {
      const forbidden = dependencyMatchesAny(dependency, boundary.forbiddenDependencies);
      if (forbidden !== undefined) {
        violations.push(
          `${packageName}: package.json declares forbidden dependency ${dependency} (matches ${forbidden})`,
        );
      }
      if (!isAllowedDependency(dependency, boundary.allowedDependencies)) {
        violations.push(
          `${packageName}: package.json dependency ${dependency} is not in allowedDependencies`,
        );
      }
    }

    const srcDir = join(packageDir, 'src');
    for (const { file, specifier } of collectSourceImports(srcDir)) {
      const forbidden = dependencyMatchesAny(specifier, boundary.forbiddenDependencies);
      if (forbidden !== undefined) {
        violations.push(
          `${packageName}: ${relative(repoRoot, file)} imports forbidden module ${specifier} (matches ${forbidden})`,
        );
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = join(dir, '..');
    if (parent === dir) {
      throw new Error('Could not find pnpm-workspace.yaml');
    }
    dir = parent;
  }
}
