import { execFileSync } from 'node:child_process';

import { PUBLISHABLE_PACKAGES } from './packages.ts';

/**
 * Waits until every publishable package reports `version` on the public npm
 * registry:
 *
 *   node packages/e2e/src/wait-for-npm.ts 22.3.0
 *
 * npm holds new versions briefly for processing (2-3 minutes for 22.2.0), so
 * the post-publish E2E check would otherwise install the previous release.
 */
const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('Usage: node packages/e2e/src/wait-for-npm.ts <version>');
  process.exit(1);
}

const TIMEOUT_MS = 20 * 60_000;
const INTERVAL_MS = 15_000;

const isPublished = (name: string) => {
  try {
    const output = execFileSync(
      'npm',
      ['view', `${name}@${version}`, 'version'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: process.platform === 'win32',
      },
    );
    return output.trim() === version;
  } catch {
    return false;
  }
};

const deadline = Date.now() + TIMEOUT_MS;
let pending = PUBLISHABLE_PACKAGES.map((pkg) => pkg.name);
while (pending.length > 0) {
  pending = pending.filter((name) => !isPublished(name));
  if (pending.length === 0) {
    break;
  }
  if (Date.now() > deadline) {
    console.error(
      `Still not on npm after ${TIMEOUT_MS / 60_000} minutes: ${pending.map((name) => `${name}@${version}`).join(', ')}`,
    );
    process.exit(1);
  }
  console.log(`Waiting for ${pending.join(', ')}@${version}...`);
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
console.log(`Every package is on npm at ${version}.`);
