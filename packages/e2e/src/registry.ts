import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { RunContext } from './context.ts';
import { PUBLISHABLE_PACKAGES, REPO_ROOT } from './packages.ts';
import { start, stop, waitFor } from './process.ts';

/** The registry every tool in the run installs from. */
export type Registry = {
  /** With a trailing slash, as npm writes it in `.npmrc`. */
  readonly url: string;
  /**
   * Environment for child processes. `npm create`, `ng add` and
   * `npm install` all inherit it, so they all use this registry.
   */
  readonly env: NodeJS.ProcessEnv;
  /** Path of the temporary `.npmrc`, also copied into generated projects. */
  readonly npmrc: string;
  readonly close: () => void;
};

/**
 * Environment shared by every command a run executes, whichever registry it
 * installs from.
 */
const baseEnv = (context: RunContext): NodeJS.ProcessEnv => ({
  ...process.env,
  // No terminal is attached in CI, so `ng new` uses its defaults instead of
  // prompting. Set it locally too, so local runs behave like CI.
  CI: 'true',
  // CI=true also makes pnpm install with --frozen-lockfile, which fails as
  // soon as `ng add` adds dependencies to package.json. A developer running
  // `ng add` has no CI variable, so turn it back off. (pnpm 11+ only reads
  // `pnpm_config_*`; npm ignores the variable.)
  pnpm_config_frozen_lockfile: 'false',
  NG_CLI_ANALYTICS: 'false',
  // A cache per run. npx keys its cache by package spec, so a cache shared
  // between runs would keep running the create-angular-lynx@<version> built
  // by an earlier run instead of the one just published. Third-party packages
  // still come from Verdaccio's storage cache, so this costs little.
  NPM_CONFIG_CACHE: path.join(context.workDir, 'npm-cache'),
  // Turn npm's update check off; its banner pollutes the logs we search.
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_AUDIT: 'false',
});

/** Uses the public npm registry, for checking what is published right now. */
export const usePublicRegistry = (context: RunContext): Registry => {
  const url = 'https://registry.npmjs.org/';
  const npmrc = path.join(context.workDir, '.npmrc');
  writeFileSync(npmrc, `registry=${url}\n`);
  return {
    url,
    npmrc,
    env: {
      ...baseEnv(context),
      NPM_CONFIG_USERCONFIG: npmrc,
      NPM_CONFIG_REGISTRY: url,
    },
    close: () => {},
  };
};

/**
 * Starts Verdaccio, a local npm registry, and points npm at it. Packages under
 * test are published there; everything else is proxied from the public
 * registry and cached in `storageDir`, so later runs install offline-fast.
 */
export const startLocalRegistry = async (
  context: RunContext,
  { port, storageDir }: { port: number; storageDir?: string },
): Promise<Registry> => {
  const storage = path.resolve(
    storageDir ??
      path.join(REPO_ROOT, 'node_modules/.cache/angular-lynx-e2e/verdaccio'),
  );
  mkdirSync(storage, { recursive: true });
  // A cached storage directory holds the packages an earlier run published.
  // Publishing the same version again would fail with "cannot publish over
  // the previously published version", so drop them first.
  for (const pkg of PUBLISHABLE_PACKAGES) {
    rmSync(path.join(storage, pkg.name), { recursive: true, force: true });
  }

  const configTemplate = readFileSync(
    path.join(REPO_ROOT, 'packages/e2e/verdaccio/config.yaml'),
    'utf8',
  );
  const config = path.join(context.workDir, 'verdaccio.yaml');
  writeFileSync(
    config,
    configTemplate.replace('STORAGE_DIR', JSON.stringify(storage)),
  );

  // 127.0.0.1 rather than localhost: Node may resolve localhost to ::1, which
  // Verdaccio doesn't listen on.
  const url = `http://127.0.0.1:${port}/`;
  const verdaccioMain = createRequire(import.meta.url).resolve('verdaccio');
  const verdaccioBin = path.join(
    path.dirname(verdaccioMain),
    '../bin/verdaccio',
  );
  const { child, output } = start(
    process.execPath,
    [verdaccioBin, '--config', config, '--listen', `127.0.0.1:${port}`],
    {
      cwd: context.workDir,
      logFile: path.join(context.artifactsDir, 'verdaccio.log'),
      echo: false,
    },
  );
  try {
    await waitFor(
      `Verdaccio to start on ${url}`,
      async () => {
        if (child.exitCode !== null) {
          throw new Error(`Verdaccio exited early:\n${output()}`);
        }
        try {
          return (await fetch(`${url}-/ping`)).ok;
        } catch {
          return false;
        }
      },
      { timeoutMs: 30_000 },
    );
  } catch (error) {
    stop(child);
    throw error;
  }

  // Any token works: Verdaccio lets anyone publish, but npm refuses to send a
  // publish request without credentials configured.
  const npmrc = path.join(context.workDir, '.npmrc');
  writeFileSync(
    npmrc,
    `registry=${url}\n//127.0.0.1:${port}/:_authToken=e2e-local-registry\n`,
  );
  console.log(`Verdaccio is running on ${url} (storage: ${storage})`);

  return {
    url,
    npmrc,
    env: {
      ...baseEnv(context),
      // npm, npx and Angular CLI's package lookups all read this file.
      NPM_CONFIG_USERCONFIG: npmrc,
      // Belt and braces for tools that read the environment but not the
      // user config.
      NPM_CONFIG_REGISTRY: url,
    },
    close: () => stop(child),
  };
};
