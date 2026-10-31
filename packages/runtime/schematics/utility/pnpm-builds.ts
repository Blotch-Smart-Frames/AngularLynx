import type { Rule, Tree } from '@angular-devkit/schematics';
import { getWorkspace } from '@schematics/angular/utility/workspace';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The dependencies of a new Angular app that have install scripts: Angular's
 * build tools. `esbuild` and `@parcel/watcher` are `@angular/build`'s,
 * `lmdb` is an optional one of it, and `msgpackr-extract` comes with `lmdb`.
 *
 * None of the scripts has anything to do. Each package gets its native binary
 * from a prebuilt package for the platform, one of its optional dependencies.
 * esbuild's script only checks that binary; @parcel/watcher's builds one from
 * source only when asked to, and lmdb's and msgpackr-extract's only when no
 * prebuilt one fits. Angular's own pnpm workspace denies all four.
 */
const ANGULAR_BUILD_SCRIPTS = [
  '@parcel/watcher',
  'esbuild',
  'lmdb',
  'msgpackr-extract',
] as const;

const WORKSPACE_FILE = '/pnpm-workspace.yaml';

/**
 * The value pnpm writes for a dependency whose build it's waiting for someone
 * to allow or deny. It denies the build, but still fails the install.
 */
const UNDECIDED = /^(['"]?)set this to true or false\1$/;

/**
 * `@parcel/watcher` needs quotes in YAML, since `@` can't start a plain key.
 */
const yamlKey = (name: string) => (name.startsWith('@') ? `'${name}'` : name);

/**
 * The `allowBuilds` entries this sets, indented by `indent`.
 */
const entries = (names: readonly string[], indent: string) =>
  names.map((name) => `${indent}${yamlKey(name)}: false`);

/**
 * What a pnpm-workspace.yaml without `allowBuilds` gets, with a comment that
 * says why it's there.
 */
const ALLOW_BUILDS_BLOCK = [
  "# Angular's build tools come with their binaries prebuilt, so their install",
  '# scripts have nothing to do. pnpm fails installs until each script is',
  '# allowed (true) or denied (false).',
  'allowBuilds:',
  ...entries(ANGULAR_BUILD_SCRIPTS, '  '),
];

/** An `allowBuilds` key at the top level, in any style. */
const ALLOW_BUILDS_KEY = /^allowBuilds[ \t]*:/;

/** An `allowBuilds` key whose entries follow on their own lines. */
const ALLOW_BUILDS_BLOCK_KEY = /^allowBuilds[ \t]*:[ \t]*(#.*)?$/;

/** One entry of a block mapping: its indent, quote, key and value. */
const ENTRY = /^([ \t]+)(['"]?)([^'"\s#][^'":#]*?)\2[ \t]*:[ \t]*(.*?)[ \t]*$/;

/**
 * pnpm-workspace.yaml's text with Angular's build scripts denied in
 * `allowBuilds`. Entries the app already decided on stay; ones pnpm left
 * undecided become `false`. Undefined when `allowBuilds` is written in a
 * style this doesn't edit, such as `allowBuilds: { esbuild: true }`.
 */
export const withAngularBuildsDenied = (text: string): string | undefined => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => ALLOW_BUILDS_KEY.test(line));
  if (start === -1) {
    // Keep a blank line between the app's settings and the new block.
    const body = text.trimEnd();
    return [...(body ? [body, ''] : []), ...ALLOW_BUILDS_BLOCK, ''].join(eol);
  }
  if (!ALLOW_BUILDS_BLOCK_KEY.test(lines[start]!)) {
    return undefined;
  }

  // The block runs over the indented lines after the key; new entries go
  // after its last one, with its indent.
  let end = start + 1;
  let indent = '  ';
  const decided = new Set<string>();
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === '' || /^[ \t]+#/.test(line)) {
      continue;
    }
    if (!/^[ \t]/.test(line)) {
      break;
    }
    end = index + 1;
    const match = ENTRY.exec(line);
    if (!match) {
      continue;
    }
    const [, entryIndent, quote, name, value] = match;
    indent = entryIndent!;
    if (UNDECIDED.test(value!)) {
      lines[index] = `${entryIndent}${quote}${name}${quote}: false`;
    }
    decided.add(name!);
  }
  const missing = ANGULAR_BUILD_SCRIPTS.filter((name) => !decided.has(name));
  lines.splice(end, 0, ...entries(missing, indent));
  return lines.join(eol);
};

/**
 * The pnpm version in package.json's `packageManager` field (`pnpm@12.15.0`,
 * maybe with a `+sha512...` hash), which `ng new --package-manager pnpm`
 * writes. Undefined when the app uses pnpm at an unknown version; null when
 * it uses another package manager.
 */
const pnpmVersionOf = async (
  tree: Tree,
): Promise<string | undefined | null> => {
  const { packageManager } = tree.exists('/package.json')
    ? (tree.readJson('/package.json') as { packageManager?: unknown })
    : {};
  if (typeof packageManager === 'string') {
    const [name, version] = packageManager.split('@');
    return name === 'pnpm' ? version : null;
  }
  // Without the field, the same signs Angular CLI goes by: angular.json's
  // `cli.packageManager`, else the lockfile.
  const workspace = await getWorkspace(tree);
  const cli = workspace.extensions['cli'] as
    | { packageManager?: unknown }
    | undefined;
  if (typeof cli?.packageManager === 'string') {
    return cli.packageManager === 'pnpm' ? undefined : null;
  }
  return tree.exists('/pnpm-lock.yaml') || tree.exists(WORKSPACE_FILE)
    ? undefined
    : null;
};

/**
 * The version `pnpm --version` prints here, the way Angular's own workspace
 * schematic reads it for `packageManager`. Undefined when pnpm doesn't run.
 */
const installedPnpmVersion = (): string | undefined => {
  try {
    return execSync('pnpm --version', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
};

/**
 * Whether this pnpm reads `allowBuilds`, which it does from 10.26. Older
 * pnpm doesn't fail an install over build scripts, and pnpm 9 and early
 * pnpm 10 fail on a pnpm-workspace.yaml without `packages`, so they're better
 * left without one.
 */
const readsAllowBuilds = (version: string) => {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 10 || (major === 10 && minor >= 26);
};

/**
 * The pnpm-workspace.yaml of a pnpm workspace above this one, as when the
 * app was made inside a monorepo. pnpm takes its settings from there, and a
 * file of the app's own would split the app off into a workspace of its own.
 */
const enclosingWorkspaceFile = (): string | undefined => {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const file = join(dir, 'pnpm-workspace.yaml');
    if (existsSync(file)) {
      return file;
    }
    if (dirname(dir) === dir) {
      return undefined;
    }
  }
};

/**
 * Denies the install scripts of Angular's build tools in a pnpm app's
 * pnpm-workspace.yaml, in `allowBuilds`.
 *
 * pnpm 11 and later fail `pnpm install` and `pnpm add` while any
 * dependency's build script is neither allowed nor denied there
 * (`strictDepBuilds`). `ng new` and `ng add` install with `--ignore-scripts`,
 * so they pass, and the app's first `pnpm add` fails. pnpm 11 reads its
 * settings only from pnpm-workspace.yaml, not package.json.
 *
 * Apps on npm, Yarn or bun, and on pnpm older than 10.26, are left alone.
 */
export const denyAngularBuildScripts = (): Rule => async (tree, context) => {
  const pinned = await pnpmVersionOf(tree);
  if (pinned === null) {
    return;
  }
  const version = pinned ?? installedPnpmVersion();
  if (version === undefined || !readsAllowBuilds(version)) {
    return;
  }

  if (!tree.exists(WORKSPACE_FILE)) {
    const enclosing = enclosingWorkspaceFile();
    if (enclosing) {
      context.logger.warn(
        `This app is in the pnpm workspace of ${enclosing}. Add this to it, or pnpm will fail installs over Angular's build scripts:\n${ALLOW_BUILDS_BLOCK.join('\n')}`,
      );
      return;
    }
  }

  const text = tree.exists(WORKSPACE_FILE) ? tree.readText(WORKSPACE_FILE) : '';
  const updated = withAngularBuildsDenied(text);
  if (updated === undefined) {
    context.logger.warn(
      `pnpm-workspace.yaml's allowBuilds isn't a block mapping, so it was left as it is. Set these in it, or pnpm will fail installs over Angular's build scripts: ${ANGULAR_BUILD_SCRIPTS.map((name) => `${name}: false`).join(', ')}.`,
    );
  } else if (!tree.exists(WORKSPACE_FILE)) {
    tree.create(WORKSPACE_FILE, updated);
  } else if (updated !== text) {
    tree.overwrite(WORKSPACE_FILE, updated);
  }
};
