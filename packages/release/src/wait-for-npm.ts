import { PUBLISHABLE_PACKAGES } from './packages.ts';

/**
 * Waits until the public npm registry lists `version` of every publishable
 * package and serves its tarball:
 *
 *   node packages/release/src/wait-for-npm.ts 22.3.0
 *
 * npm holds new versions briefly for processing (2-3 minutes for 22.2.0), so
 * the post-publish E2E check would otherwise install the previous release.
 * Being listed isn't enough: npm can list a version before its CDN serves the
 * tarball, and an install in that gap fails with a 404 for the `.tgz`. That's
 * how 22.2.5's first post-publish check failed, though the release was fine.
 */
const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('Usage: node packages/release/src/wait-for-npm.ts <version>');
  process.exit(1);
}

const TIMEOUT_MS = 20 * 60_000;
const INTERVAL_MS = 15_000;

type PackageMetadata = {
  readonly versions?: Readonly<
    Record<string, { readonly dist?: { readonly tarball?: string } }>
  >;
};

const isInstallable = async (name: string) => {
  try {
    // The abbreviated metadata, the document installs read (`npm view`
    // reads the full one), so this sees the version as an install will.
    const response = await fetch(`https://registry.npmjs.org/${name}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (!response.ok) {
      return false;
    }
    const metadata = (await response.json()) as PackageMetadata;
    const tarball = metadata.versions?.[version]?.dist?.tarball;
    if (!tarball) {
      return false;
    }
    return (await fetch(tarball, { method: 'HEAD' })).ok;
  } catch {
    // A network error is just another reason to try again.
    return false;
  }
};

const deadline = Date.now() + TIMEOUT_MS;
let pending = PUBLISHABLE_PACKAGES.map((pkg) => pkg.name);
while (pending.length > 0) {
  const installable = await Promise.all(pending.map(isInstallable));
  pending = pending.filter((_, index) => !installable[index]);
  if (pending.length === 0) {
    break;
  }
  if (Date.now() > deadline) {
    console.error(
      `Still not installable from npm after ${TIMEOUT_MS / 60_000} minutes: ${pending.map((name) => `${name}@${version}`).join(', ')}`,
    );
    process.exit(1);
  }
  console.log(`Waiting for ${pending.join(', ')}@${version}...`);
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
console.log(`npm lists and serves every package at ${version}.`);
