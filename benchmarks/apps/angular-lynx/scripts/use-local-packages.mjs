#!/usr/bin/env node
// Installs this repository's own AngularLynx packages into the app, in place
// of the ones on npm.
//
// The benchmark measures the tip of master, not the last release, so the app
// can't take @blotch/* from the registry. This packs every package we publish
// (the list in packages/release/src/packages.ts, which the E2E tests and the
// publish workflow use too) with `npm pack`, as `npm publish` would, into
// .local-packages/ (git-ignored), and points the app at the tarballs: its own
// @blotch/* dependencies, and the ones those bring (@blotch/angular-lynx-build
// brings the rsbuild plugin and the native builder), which it adds as direct
// dependencies. An `overrides` entry for each makes the packages that depend
// on them take the packed ones too, not releases from npm. Then it runs
// `npm install`, which updates the lockfile.
//
// A tarball's name ends in a hash of its bytes (`npm pack` writes the same
// bytes for the same files), so package.json changes whenever a package does,
// and npm installs the new one rather than keeping the copy it has.
//
//   node scripts/use-local-packages.mjs            pack the packages as built
//   node scripts/use-local-packages.mjs --build    `npm run build` at the root first
//   node scripts/use-local-packages.mjs --no-install   pack and rewrite package.json only
//   node scripts/use-local-packages.mjs -- add spinner  run the packed dolan with these arguments
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const REPO_ROOT = path.resolve(APP_DIR, '../../..');
const OUT_DIR = path.join(APP_DIR, '.local-packages');
// Where package.json refers to the tarballs from, relative to the app.
const OUT_SPEC = 'file:.local-packages';

// The scaffolder isn't a dependency of the app: `npm create` runs it once.
const NOT_INSTALLED = new Set(['create-angular-lynx']);

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const flags = separator < 0 ? args : args.slice(0, separator);
const dolanArgs = separator < 0 ? null : args.slice(separator + 1);

const run = (command, commandArgs, cwd) =>
  execFileSync(command, commandArgs, {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });

// Node 24 strips the types of a .ts file it imports, so the one list of
// published packages is read where it's kept rather than copied here.
const { PUBLISHABLE_PACKAGES } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'packages/release/src/packages.ts')).href
);
const packages = PUBLISHABLE_PACKAGES.filter(
  (pkg) => !NOT_INSTALLED.has(pkg.name),
);

if (dolanArgs) {
  // dolan copies @blotch/ui's components from the copy inside its own
  // package, so the packed dolan copies them as they are on this branch.
  const dolan = readdirSync(OUT_DIR).find((file) =>
    file.startsWith('blotch-dolan-'),
  );
  if (!dolan)
    throw new Error(
      'Run this script without `--` first: there is no packed dolan.',
    );
  try {
    execFileSync(
      'npm',
      [
        'exec',
        '--yes',
        `--package=${path.join(OUT_DIR, dolan)}`,
        '--',
        'dolan',
        ...dolanArgs,
      ],
      { cwd: APP_DIR, stdio: 'inherit' },
    );
  } catch (error) {
    // dolan has said what went wrong.
    process.exit(error.status ?? 1);
  }
  process.exit(0);
}

if (flags.includes('--build')) {
  console.log('> npm run build (repository root)');
  execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
}

// A package that hasn't been built packs without its dist/ and installs
// without complaint, so check first, as the E2E tests do.
for (const pkg of packages) {
  const missing = pkg.requiredFiles.filter(
    (file) => !existsSync(path.join(REPO_ROOT, pkg.publishDir, file)),
  );
  if (missing.length > 0) {
    throw new Error(
      `${pkg.name} isn't built (missing ${missing.join(', ')}). ` +
        'Run `npm run build` at the repository root, or pass --build.',
    );
  }
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

/** Each package's name and the spec package.json gives it. */
const specs = new Map();
for (const pkg of packages) {
  const output = run(
    'npm',
    // --ignore-scripts: pack what's built; a prepack script would rebuild.
    ['pack', '--json', '--ignore-scripts', '--pack-destination', OUT_DIR],
    path.join(REPO_ROOT, pkg.publishDir),
  );
  const [{ filename, version }] = JSON.parse(
    output.slice(output.search(/^\[/m)),
  );
  const packed = path.join(OUT_DIR, filename);
  const hash = createHash('sha256')
    .update(readFileSync(packed))
    .digest('hex')
    .slice(0, 8);
  const named = filename.replace(/\.tgz$/, `-${hash}.tgz`);
  renameSync(packed, path.join(OUT_DIR, named));
  specs.set(pkg.name, `${OUT_SPEC}/${named}`);
  console.log(`packed ${pkg.name}@${version} -> .local-packages/${named}`);
}

const packageJsonPath = path.join(APP_DIR, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'];
const direct = new Set(
  DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(packageJson[field] ?? {}),
  ).filter((name) => specs.has(name)),
);

// Every packed package the app gets, whoever brings it: its own @blotch/*
// dependencies and the ones those depend on (@blotch/angular-lynx-build brings
// the rsbuild plugin and the native builder). Peers count too, since npm
// installs them unless they're optional.
const reached = new Set(direct);
for (const name of reached) {
  const pkg = packages.find((candidate) => candidate.name === name);
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, pkg.publishDir, 'package.json'), 'utf8'),
  );
  const optionalPeers = manifest.peerDependenciesMeta ?? {};
  const needs = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}).filter(
      (peer) => !optionalPeers[peer]?.optional,
    ),
  ];
  for (const dependency of needs)
    if (specs.has(dependency)) reached.add(dependency);
}

// The app takes each of them as a direct dependency. npm resolves a `file:`
// override from the package that depends on what it overrides, so for a
// package only @blotch/angular-lynx-build depends on, `file:.local-packages/…`
// means node_modules/@blotch/angular-lynx-build/.local-packages/…, which
// doesn't exist. It installed only while the lockfile already had that tarball
// (#803). An override that matches a direct dependency's spec resolves from the
// app instead, wherever the package is in the tree.
const added = [...reached].filter((name) => !direct.has(name));
if (added.length > 0) {
  const devDependencies = { ...packageJson.devDependencies };
  for (const name of added) devDependencies[name] = specs.get(name);
  // In the order npm writes them, so the new entries sit with the others.
  packageJson.devDependencies = Object.fromEntries(
    Object.entries(devDependencies).sort(([a], [b]) =>
      a.localeCompare(b, 'en'),
    ),
  );
}
for (const field of DEPENDENCY_FIELDS) {
  for (const name of Object.keys(packageJson[field] ?? {})) {
    if (specs.has(name)) packageJson[field][name] = specs.get(name);
  }
}

// The overrides make the packages that depend on these take the packed ones
// too, not releases from npm. npm accepts an override for a direct dependency
// only when it's the dependency's own spec, which it is. A packed package the
// app doesn't get (the testing library) has no override: it would only point
// at a tarball npm can't find, if something brought it later.
const overrides = Object.fromEntries(
  Object.entries(packageJson.overrides ?? {}).filter(
    ([name]) => !specs.has(name),
  ),
);
// In publish order, as `specs` is, so the order doesn't change from run to run.
for (const [name, spec] of specs) if (reached.has(name)) overrides[name] = spec;
packageJson.overrides = overrides;
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log('updated package.json');

if (!flags.includes('--no-install')) {
  console.log('> npm install');
  execFileSync('npm', ['install'], { cwd: APP_DIR, stdio: 'inherit' });
}
