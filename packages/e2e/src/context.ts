import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { REPO_ROOT } from '../../release/src/packages.ts';

/** Directories one E2E run works in. */
export type RunContext = {
  /**
   * A fresh temporary directory, outside the repository. The generated app
   * must not live inside the monorepo: Node would find modules in the
   * monorepo's `node_modules` and hide dependencies missing from our
   * packages. That is how a patched `@angular/build` in the monorepo hid the
   * plugin's reliance on a `postinstall` script in 22.2.x.
   */
  readonly workDir: string;
  /** Where `npm pack` writes the tarballs that are tested and then published. */
  readonly tarballDir: string;
  /** Logs and copies of the generated app, uploaded by CI when a run fails. */
  readonly artifactsDir: string;
  /** Every command's output, in order. */
  readonly logFile: string;
};

export const createRunContext = ({
  tarballDir,
  artifactsDir,
}: {
  tarballDir?: string;
  artifactsDir?: string;
}): RunContext => {
  // CI runners provide RUNNER_TEMP, which is cleaned between jobs. realpath
  // matters on macOS, where os.tmpdir() is a symlink into /private: tools
  // that compare paths (Angular CLI's workspace lookup among them) can
  // otherwise disagree about whether two paths are the same directory.
  const tempRoot = realpathSync(process.env['RUNNER_TEMP'] ?? os.tmpdir());
  const workDir = mkdtempSync(path.join(tempRoot, 'angular-lynx-e2e-'));
  const resolvedTarballDir = path.resolve(
    tarballDir ?? path.join(workDir, 'tarballs'),
  );
  const resolvedArtifactsDir = path.resolve(
    artifactsDir ?? path.join(REPO_ROOT, 'packages/e2e/artifacts'),
  );
  mkdirSync(resolvedTarballDir, { recursive: true });
  mkdirSync(resolvedArtifactsDir, { recursive: true });
  return {
    workDir,
    tarballDir: resolvedTarballDir,
    artifactsDir: resolvedArtifactsDir,
    logFile: path.join(resolvedArtifactsDir, 'commands.log'),
  };
};
