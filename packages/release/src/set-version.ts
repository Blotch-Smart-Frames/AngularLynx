import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
  readInternalPeers,
  readInternalPins,
} from './packages.ts';

/**
 * Sets one version on every publishable package, to prepare a release:
 *
 *   npm run set-version 22.3.0
 *
 * Commit the result, then tag that commit `v22.3.0`. The publish workflow
 * never runs this: it refuses a tag that doesn't match the repository (see
 * `check-version.ts`), so the repository always says what was published.
 */
const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('Usage: npm run set-version <version>');
  process.exit(1);
}

for (const pkg of PUBLISHABLE_PACKAGES) {
  // --allow-same-version: without it npm fails with "Version not changed"
  // for a package already at the version, so a rerun would stop part-way.
  // --no-workspaces-update: otherwise npm installs after each package, while
  // the others still pin the old version of it, which the workspace no longer
  // provides. npm then looks for that version on the registry and fails
  // (ETARGET); the install below runs once every pin has moved.
  // The runtime is stamped in its source folder, not dist/: ng-packagr copies
  // the source package.json into dist/ when it builds.
  execFileSync(
    'npm',
    [
      'version',
      version,
      '--no-git-tag-version',
      '--allow-same-version',
      '--no-workspaces-update',
      '-w',
      pkg.dir,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
  );
}

// `npm version` leaves other packages' dependencies on the one it versions
// alone, so move each pin and peer floor between published packages here,
// then bring the lockfile in line with them. A peer floor moves to this
// release too: the package imports what this release of its peer exports,
// and an older floor lets npm install it with a peer that lacks them (#774).
for (const pkg of PUBLISHABLE_PACKAGES) {
  const pins = readInternalPins(pkg);
  const peers = readInternalPeers(pkg);
  if (pins.length === 0 && peers.length === 0) {
    continue;
  }
  const file = path.join(REPO_ROOT, pkg.dir, 'package.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  for (const { name } of pins) {
    json.dependencies[name] = version;
  }
  for (const { name } of peers) {
    json.peerDependencies[name] = `^${version}`;
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
execFileSync(
  'npm',
  ['install', '--package-lock-only', '--ignore-scripts', '--no-audit'],
  { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
);
