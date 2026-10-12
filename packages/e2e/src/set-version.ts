import { execFileSync } from 'node:child_process';

import { PUBLISHABLE_PACKAGES, REPO_ROOT } from './packages.ts';

/**
 * Stamps one version on every publishable package:
 *
 *   node packages/e2e/src/set-version.ts 22.3.0
 *
 * The publish workflow runs this with the tag's version before building, and
 * so does the E2E release gate, so the tarballs it tests carry the version
 * that will be published.
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
