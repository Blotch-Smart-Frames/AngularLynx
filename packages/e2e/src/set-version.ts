import { execFileSync } from 'node:child_process';

import { PUBLISHABLE_PACKAGES, REPO_ROOT } from './packages.ts';

/**
 * Sets one version on every publishable package, to prepare a release:
 *
 *   node packages/e2e/src/set-version.ts 22.3.0
 *
 * Commit the result, then tag that commit `v22.3.0`. The publish workflow
 * never runs this: it refuses a tag that doesn't match the repository (see
 * `check-version.ts`), so the repository always says what was published.
 */
const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('Usage: node packages/e2e/src/set-version.ts <version>');
  process.exit(1);
}

for (const pkg of PUBLISHABLE_PACKAGES) {
  // --allow-same-version: tagging the version already in package.json is
  // normal, and without the flag npm fails with "Version not changed".
  // The runtime is stamped in its source folder, not dist/: ng-packagr copies
  // the source package.json into dist/ when it builds.
  execFileSync(
    'npm',
    [
      'version',
      version,
      '--no-git-tag-version',
      '--allow-same-version',
      '-w',
      pkg.dir,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
  );
}
