// Reports, for every published package, whether npm lists the version,
// whether it's the `latest` dist-tag, and whether npm serves its tarball.
// Exits 0 only when all three hold for every package:
//
//   node .claude/skills/release/scripts/npm-status.mts <version>
//
// The tarball is checked as well as the version because npm can list a new
// version before its CDN serves the tarball, and an install in that gap gets a
// 404 for the `.tgz`. The package list comes from `packages.ts`, so the script
// follows it as packages are added.
import { PUBLISHABLE_PACKAGES } from '../../../../packages/release/src/packages.ts';

type Packument = {
  readonly 'dist-tags'?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<
    Record<string, { readonly dist?: { readonly tarball?: string } }>
  >;
};

const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('Usage: node .claude/skills/release/scripts/npm-status.mts <version>');
  process.exit(1);
}

let allGood = true;
for (const { name } of PUBLISHABLE_PACKAGES) {
  // The abbreviated packument, which installs read: the dist-tags, and each
  // version's tarball URL.
  const response = await fetch(`https://registry.npmjs.org/${name}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    cache: 'no-store',
  });
  const packument: Packument = response.ok ? await response.json() : {};
  const tarball = packument.versions?.[version]?.dist?.tarball;
  const latest = packument['dist-tags']?.latest;
  const served = tarball
    ? (await fetch(tarball, { method: 'HEAD', cache: 'no-store' })).status
    : undefined;
  const good = tarball !== undefined && latest === version && served === 200;
  allGood &&= good;
  console.log(
    `${good ? '✓' : '✗'} ${name}: ${tarball ? 'listed' : 'not listed'}, ` +
      `latest ${latest ?? 'unknown'}, tarball ${served ?? 'none'}`,
  );
}
process.exit(allGood ? 0 : 1);
