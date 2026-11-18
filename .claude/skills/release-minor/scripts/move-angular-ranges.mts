// Moves every Angular range in the repository's package.json files to a new
// Angular minor, for the release-minor skill:
//
//   node .claude/skills/release-minor/scripts/move-angular-ranges.mts <major.minor> [--dry-run]
//
// It reads the root package.json and each workspace's (packages/*, examples/*),
// and moves:
//
// - @angular/*, @angular-devkit/*, @schematics/angular and ng-packagr, which
//   Angular releases together: ^22.2.5 becomes ^22.3.0. The ones versioned
//   0.MMmm.p (@angular-devkit/architect, whose 0.2202.x is Angular CLI 22.2.x)
//   move the same way: ^0.2202.5 becomes ^0.2203.0.
// - a published package's peer range on another @blotch package (the testing
//   library's on @blotch/angular-lynx). `npm run set-version` moves only the
//   exact pins between published packages, so without this the testing
//   library X.Y.0 would accept a runtime from the old minor.
//
// It leaves alone a range that isn't a plain ^ or ~ range (the build's
// architect peer, >=0.2200.0 <0.2300.0, covers the whole major and moves with
// the update-angular skill), or that's on another major, and lists each one.
// The benchmark apps aren't workspaces, so it never sees them: they pin exact
// versions on purpose.
//
// Before writing anything it asks npm for every version it would move to, and
// changes nothing if one isn't published yet. Angular and Angular CLI are
// released separately, sometimes days apart, and a minor waits for both.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Section =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

type Move = {
  readonly file: string;
  readonly section: Section;
  readonly name: string;
  readonly from: string;
  readonly to: string;
};

type LeftAlone = Omit<Move, 'to'> & { readonly reason: string };

const SECTIONS: readonly Section[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args
  .find((arg) => !arg.startsWith('--'))
  ?.match(/^(\d+)\.(\d+)(?:\.0)?$/);
if (!target) {
  console.error(
    'Usage: node .claude/skills/release-minor/scripts/move-angular-ranges.mts <major.minor> [--dry-run]',
  );
  process.exit(1);
}
const major = Number(target[1]);
const minor = Number(target[2]);

const isAngular = (name: string) =>
  name.startsWith('@angular/') ||
  name.startsWith('@angular-devkit/') ||
  name === '@schematics/angular' ||
  name === 'ng-packagr';

const readJson = (file: string) =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8'));

// The workspaces' package.json files, found the way npm finds them, so a new
// example is covered without listing it here.
const workspaces: unknown = readJson('package.json').workspaces;
if (!Array.isArray(workspaces)) {
  console.error('The root package.json has no workspaces array to read.');
  process.exit(1);
}
const files = [
  'package.json',
  ...workspaces.flatMap((pattern: string) => {
    if (!pattern.endsWith('/*')) {
      return [path.join(pattern, 'package.json')];
    }
    const parent = pattern.slice(0, -2);
    return readdirSync(path.join(REPO_ROOT, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name, 'package.json'));
  }),
].filter((file) => existsSync(path.join(REPO_ROOT, file)));

// A plain caret or tilde range on one version, the only kind this moves.
const PLAIN_RANGE = /^([~^])(\d+)\.(\d+)\.\d+$/;

/**
 * The range `range` moves to, or why it stays. `undefined` means it's
 * already on the target minor.
 */
const moveRange = (
  range: string,
): { readonly to: string } | { readonly reason: string } | undefined => {
  const match = PLAIN_RANGE.exec(range);
  if (!match) {
    return { reason: 'not a plain ^ or ~ range' };
  }
  const [, operator, first, second] = match;
  // 0.MMmm.p: Angular CLI's major and minor packed into one number.
  const [lineMajor, lineMinor] =
    first === '0'
      ? [Math.floor(Number(second) / 100), Number(second) % 100]
      : [Number(first), Number(second)];
  if (lineMajor !== major) {
    return { reason: `on major ${lineMajor}, not ${major}` };
  }
  if (lineMinor === minor) {
    return undefined;
  }
  if (lineMinor > minor) {
    return { reason: `already past ${major}.${minor}` };
  }
  return {
    to:
      first === '0'
        ? `${operator}0.${major * 100 + minor}.0`
        : `${operator}${major}.${minor}.0`,
  };
};

const moves: Move[] = [];
const leftAlone: LeftAlone[] = [];
let alreadyThere = 0;
for (const file of files) {
  const json = readJson(file);
  for (const section of SECTIONS) {
    for (const [name, range] of Object.entries<string>(json[section] ?? {})) {
      const blotchPeer =
        section === 'peerDependencies' && name.startsWith('@blotch/');
      if (!isAngular(name) && !blotchPeer) {
        continue;
      }
      const result = moveRange(range);
      if (result === undefined) {
        alreadyThere += 1;
      } else if ('reason' in result) {
        leftAlone.push({
          file,
          section,
          name,
          from: range,
          reason: result.reason,
        });
      } else {
        moves.push({ file, section, name, from: range, to: result.to });
      }
    }
  }
}

// Every version the moves point at must be on npm. Our own @blotch packages
// aren't checked: they're published by this release.
const wanted = new Map<string, Set<string>>();
for (const { name, to } of moves) {
  if (isAngular(name)) {
    const versions = wanted.get(name) ?? new Set<string>();
    versions.add(to.slice(1));
    wanted.set(name, versions);
  }
}
const missing: string[] = [];
for (const [name, versions] of wanted) {
  // The abbreviated packument, which installs read: it lists every version.
  const response = await fetch(`https://registry.npmjs.org/${name}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    cache: 'no-store',
  });
  const packument: { readonly versions?: Readonly<Record<string, unknown>> } =
    response.ok ? await response.json() : {};
  for (const version of versions) {
    if (!packument.versions?.[version]) {
      missing.push(`${name}@${version}`);
    }
  }
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

console.log(
  `Moving Angular ranges to ${major}.${minor}${dryRun ? ' (dry run)' : ''}: ` +
    `${plural(moves.length, 'range')} in ` +
    `${plural(new Set(moves.map((move) => move.file)).size, 'file')}, ` +
    `${alreadyThere} already on ${major}.${minor}.`,
);

// Peer ranges are what apps see, so each one is listed on its own.
const peerMoves = moves.filter((move) => move.section === 'peerDependencies');
console.log(`\nPeer ranges (${peerMoves.length}):`);
for (const { file, name, from, to } of peerMoves) {
  console.log(`  ${file}: ${name} ${from} → ${to}`);
}

// The rest repeat across ~100 examples, so they're counted rather than listed.
const otherMoves = new Map<string, string[]>();
for (const move of moves) {
  if (move.section !== 'peerDependencies') {
    const key = `${move.name} ${move.from} → ${move.to}`;
    otherMoves.set(key, [...(otherMoves.get(key) ?? []), move.file]);
  }
}
console.log('\nOther ranges:');
for (const [key, inFiles] of [...otherMoves].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const where =
    inFiles.length <= 3 ? inFiles.join(', ') : plural(inFiles.length, 'file');
  console.log(`  ${key} (${where})`);
}

if (leftAlone.length > 0) {
  console.log('\nLeft alone:');
  for (const { file, section, name, from, reason } of leftAlone) {
    console.log(`  ${file}: ${section} ${name} ${from} (${reason})`);
  }
}

if (missing.length > 0) {
  console.error(
    `\nNot on npm yet, so nothing was changed: ${missing.join(', ')}`,
  );
  process.exit(1);
}
if (dryRun || moves.length === 0) {
  process.exit(0);
}

// Written the way `npm run set-version` writes them: two-space JSON and a
// final newline, which is how npm itself writes package.json.
for (const file of new Set(moves.map((move) => move.file))) {
  const json = readJson(file);
  for (const move of moves.filter((each) => each.file === file)) {
    json[move.section][move.name] = move.to;
  }
  writeFileSync(
    path.join(REPO_ROOT, file),
    `${JSON.stringify(json, null, 2)}\n`,
  );
}
console.log('\nWritten.');
