import type { PackedPackage } from './check-packages.ts';
import type { RunContext } from './context.ts';
import type { Registry } from './registry.ts';
import { run, step } from './process.ts';

/**
 * Publishes the tarballs Layer 1 checked to the local registry. Publishing the
 * tarballs, rather than the package folders, means the app is built from
 * exactly the bytes that passed the contract checks, and that the release
 * workflow can later publish those same bytes to npm.
 */
export const publishLocal = async (
  packed: readonly PackedPackage[],
  registry: Registry,
  context: RunContext,
) => {
  step(`Publishing ${packed.length} packages to ${registry.url}`);
  for (const { tarball } of packed) {
    // `--tag latest` explicitly, so a prerelease version stamped in by a test
    // still becomes what `npm create angular-lynx` resolves to.
    await run(
      'npm',
      ['publish', tarball, '--registry', registry.url, '--tag', 'latest'],
      { cwd: context.workDir, env: registry.env, logFile: context.logFile },
    );
  }
};
