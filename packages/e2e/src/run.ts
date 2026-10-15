import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { checkPackages, loadTarballs, packAll } from './check-packages.ts';
import { createRunContext, type RunContext } from './context.ts';
import { publishLocal } from './publish-local.ts';
import { CheckError, run } from './process.ts';
import {
  startLocalRegistry,
  usePublicRegistry,
  type Registry,
} from './registry.ts';
import { renderInBrowser } from './render.ts';
import {
  scaffoldApp,
  type PackageManager,
  type ScaffoldedApp,
} from './scaffold.ts';

const USAGE = `Usage: npm run e2e -- [options]

Layers 1-3 by default: package contract checks, a fresh app installed from a
local registry, and a render test in Chromium.

Options:
  --layers <list>        Layers to run, e.g. 1 or 1,2 (default: 1,2,3)
  --registry <name>      local (default): publish this build to Verdaccio
                         public: test what is on npm now (skips Layer 1)
  --version <version>    With --registry public, the version to test
                         (default: the latest create-angular-lynx)
  --pm <name>            npm (default), pnpm or yarn
  --angular <version>    Angular CLI version for ng new, e.g. 22.2.0 or next
  --no-tailwind          Run ng add with --tailwind=false
  --keep                 Keep the generated app and print its path
  --port <port>          Verdaccio port (default: 4873)
  --storage <dir>        Verdaccio storage, cached between runs
  --tarball-dir <dir>    Where to write the tested tarballs (for publishing)
  --tarballs <dir>       Test tarballs packed by an earlier run instead of
                         packing the workspace (used by the CI matrix)
  --rspeedy <version>    Install this @lynx-js/rspeedy instead of the one
                         ng add pins, e.g. latest
  --artifacts-dir <dir>  Where to write logs and failure artifacts
  --build-only           Layer 2 only scaffolds the app and builds it for
                         production (CI uses this to feed the native jobs)
  --export-dist <dir>    Copy the built app's dist/ here (CI reuses it for
                         the native jobs instead of rebuilding)
  --ios                  Also run Layer 6 on the iOS Simulator (needs Xcode)
  --shell                With --ios, test the app's own build from
                         \`ng build --platform ios\` instead of Lynx Explorer
  --help                 Show this help
`;

const { values: args } = parseArgs({
  options: {
    layers: { type: 'string', default: '1,2,3' },
    registry: { type: 'string', default: 'local' },
    version: { type: 'string' },
    pm: { type: 'string', default: 'npm' },
    angular: { type: 'string' },
    'no-tailwind': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
    port: { type: 'string', default: '4873' },
    storage: { type: 'string' },
    'tarball-dir': { type: 'string' },
    tarballs: { type: 'string' },
    rspeedy: { type: 'string' },
    'artifacts-dir': { type: 'string' },
    'build-only': { type: 'boolean', default: false },
    'export-dist': { type: 'string' },
    ios: { type: 'boolean', default: false },
    shell: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const layers = new Set(args.layers.split(',').map(Number));
if (args.ios) {
  layers.add(6);
}
const packageManager = args.pm as PackageManager;
if (!['npm', 'pnpm', 'yarn'].includes(packageManager)) {
  throw new Error(`--pm must be npm, pnpm or yarn, not ${args.pm}`);
}
if (args.registry !== 'local' && args.registry !== 'public') {
  throw new Error(`--registry must be local or public, not ${args.registry}`);
}

// Start from an empty artifacts folder, so CI never uploads a stale log.
const artifactsDir =
  args['artifacts-dir'] ?? path.join(import.meta.dirname, '../artifacts');
rmSync(artifactsDir, { recursive: true, force: true });
const context = createRunContext({
  tarballDir: args['tarball-dir'],
  artifactsDir,
});
console.log(`Working in ${context.workDir}`);

/**
 * Copies what a maintainer needs to debug a failed CI run without rerunning
 * it: the generated app (minus node_modules) and npm's debug logs. Command
 * output and the Verdaccio log are already in the artifacts folder.
 */
const collectFailureArtifacts = (
  runContext: RunContext,
  failedApp?: ScaffoldedApp,
) => {
  const appDir = failedApp?.dir ?? path.join(runContext.workDir, 'my-app');
  if (existsSync(appDir)) {
    cpSync(appDir, path.join(runContext.artifactsDir, 'app'), {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}node_modules`),
    });
  }
  const npmLogs = path.join(runContext.workDir, 'npm-cache/_logs');
  if (existsSync(npmLogs)) {
    cpSync(npmLogs, path.join(runContext.artifactsDir, 'npm-logs'), {
      recursive: true,
    });
  }
};

let registry: Registry | undefined;
let app: ScaffoldedApp | undefined;
let failed = false;
try {
  let version = args.version;
  if (args.registry === 'local') {
    const packed = args.tarballs
      ? await loadTarballs(args.tarballs, context)
      : await packAll(context);
    version = packed[0]!.version;
    if (layers.has(1)) {
      await checkPackages(packed, context);
    }
    if (layers.has(2) || layers.has(3) || layers.has(6)) {
      registry = await startLocalRegistry(context, {
        port: Number(args.port),
        storageDir: args.storage,
      });
      // Publishes the tarballs Layer 1 checked, so the app is built from the
      // same bytes.
      await publishLocal(packed, registry, context);
    }
  } else {
    registry = usePublicRegistry(context);
    version ??= (
      await run('npm', ['view', 'create-angular-lynx', 'version'], {
        cwd: context.workDir,
        env: registry.env,
        echo: false,
      })
    ).output.trim();
    console.log(`Testing version ${version} from the public npm registry`);
  }

  if (registry && (layers.has(2) || layers.has(3) || layers.has(6))) {
    app = await scaffoldApp(
      {
        version: version!,
        // `npm create` is the README path, so it's the default. Only the
        // ng new + ng add path can vary Angular, the package manager or
        // ng add's options.
        scaffolder:
          packageManager === 'npm' && !args.angular && !args['no-tailwind']
            ? 'create'
            : 'ng-add',
        angular: args.angular,
        packageManager,
        tailwind: !args['no-tailwind'],
        rspeedy: args.rspeedy,
        buildOnly: args['build-only'],
      },
      registry,
      context,
    );
  }

  if (app && args['export-dist']) {
    cpSync(app.distDir, args['export-dist'], { recursive: true });
  }

  if (app && layers.has(3)) {
    await renderInBrowser(app, context);
  }

  if (app && layers.has(6)) {
    const { runNative } = await import('./native/run-native.ts');
    await runNative({
      platform: 'ios',
      distDir: app.distDir,
      appDir: args.shell ? app.dir : undefined,
      artifactsDir: context.artifactsDir,
      port: 3210,
    });
  }
  console.log('\n✓ E2E passed');
} catch (error) {
  failed = true;
  console.error(
    `\n✗ E2E failed: ${error instanceof CheckError ? error.message : (error as Error).stack}`,
  );
} finally {
  registry?.close();
  if (failed) {
    collectFailureArtifacts(context, app);
  }
  if (args.keep || failed) {
    console.log(`\nThe generated app and logs are in ${context.workDir}`);
  } else {
    rmSync(context.workDir, { recursive: true, force: true });
  }
  console.log(`Logs: ${context.artifactsDir}`);
}
process.exit(failed ? 1 : 0);
