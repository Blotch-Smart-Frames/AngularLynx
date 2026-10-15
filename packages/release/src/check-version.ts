import { readVersions } from './packages.ts';

/**
 * Fails unless every publishable package's `package.json` is at `version`:
 *
 *   node packages/release/src/check-version.ts 22.3.0
 *
 * `publish.yml` runs this with the tag's version before anything is built.
 * The repository is the source of truth for what gets published, so a tag
 * that doesn't match it is refused rather than stamped over it. Stamping is
 * how 22.2.1 was published while the repository still said 22.2.0.
 */
const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('Usage: node packages/release/src/check-version.ts <version>');
  process.exit(1);
}

const versions = readVersions();
const wrong = versions.filter((pkg) => pkg.version !== version);
if (wrong.length > 0) {
  console.error(
    `These packages aren't at ${version}: ${wrong.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}.

Set the version in the repository, commit it, and tag that commit:

  npm run set-version ${version}`,
  );
  process.exit(1);
}

console.log(
  `✓ ${versions.map(({ name }) => name).join(', ')} are at ${version}`,
);
