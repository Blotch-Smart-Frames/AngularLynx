import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { PUBLISHABLE_PACKAGES, REPO_ROOT } from './packages.ts';

/**
 * Publishes the tarballs the E2E release gate tested, so what users install
 * is byte-for-byte what passed:
 *
 *   node packages/e2e/src/publish-tarballs.ts <dir> [--dry-run]
 *
 * Packages are published in PUBLISHABLE_PACKAGES order. Extra arguments
 * (such as --provenance) are passed through to `npm publish`.
 */
// Parsed by hand rather than with parseArgs, which would swallow the npm
// options this script passes through.
const [tarballDir, ...npmArgs] = process.argv.slice(2);
if (!tarballDir) {
  console.error(
    'Usage: node packages/e2e/src/publish-tarballs.ts <dir> [npm publish options, e.g. --dry-run]',
  );
  process.exit(1);
}

const tarballs = readdirSync(tarballDir).filter((file) =>
  file.endsWith('.tgz'),
);

/**
 * npm pack names a tarball after the package: @scope/name@1.2.3 becomes
 * scope-name-1.2.3.tgz.
 */
const tarballFor = (name: string) => {
  const prefix = `${name.replace(/^@/, '').replace('/', '-')}-`;
  // A version starts with a digit, which keeps "angular-lynx-" from also
  // matching "angular-lynx-testing-library-".
  const matches = tarballs.filter(
    (file) => file.startsWith(prefix) && /^\d/.test(file.slice(prefix.length)),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one tarball for ${name} in ${tarballDir}, found ${matches.length}: ${matches.join(', ')}`,
    );
  }
  return path.resolve(tarballDir, matches[0]!);
};

// Resolve every tarball before publishing any, so a missing one fails the
// release before anything is public.
const plan = PUBLISHABLE_PACKAGES.map((pkg) => ({
  pkg,
  tarball: tarballFor(pkg.name),
}));

for (const { pkg, tarball } of plan) {
  console.log(`\nPublishing ${pkg.name} from ${path.basename(tarball)}`);
  execFileSync('npm', ['publish', tarball, '--access', 'public', ...npmArgs], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
