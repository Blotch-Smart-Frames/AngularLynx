import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { checkPackages, loadTarballs, packAll } from './check-packages.ts';
import { createRunContext, type RunContext } from './context.ts';
import { publishLocal } from './publish-local.ts';
import { CheckError, run, step } from './process.ts';
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
  --tailwind-version <n> Run ng add with --tailwind-version=<n>, 3 or 4
                         (default: ng add's own default, 4)
  --keep                 Keep the generated app and print its path
  --port <port>          Verdaccio port (default: 4873)
  --storage <dir>        Verdaccio storage, cached between runs
  --tarball-dir <dir>    Where to write the tested tarballs (for publishing)
  --tarballs <dir>       Test tarballs packed by an earlier run instead of
                         packing the workspace (used by the CI matrix)
  --rspeedy <version>    Override @lynx-js/rspeedy with this version instead
                         of the one the builders depend on, e.g. latest
  --artifacts-dir <dir>  Where to write logs and failure artifacts
  --build-only           Layer 2 only scaffolds the app and builds it for
                         production (CI uses this to feed the native jobs)
  --build-native <name>  After the production build, also run
                         \`ng build --platform <name>\` (android or ios; CI
                         builds the Android app on Linux this way)
  --export-app <dir>     Copy the app, without node_modules and Angular's
                         cache, here (CI hands it, with its native build, to
                         the Android emulator job)
  --ios                  Also run Layer 6 on the iOS Simulator (needs Xcode)
  --shell                With --ios, test the app's own build from
                         \`ng build --platform ios\` instead of Lynx Explorer
  --explorer             With --ios --shell, test in Lynx Explorer as well
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
    'tailwind-version': { type: 'string' },
    keep: { type: 'boolean', default: false },
    port: { type: 'string', default: '4873' },
    storage: { type: 'string' },
    'tarball-dir': { type: 'string' },
    tarballs: { type: 'string' },
    rspeedy: { type: 'string' },
    'artifacts-dir': { type: 'string' },
    'build-only': { type: 'boolean', default: false },
    'build-native': { type: 'string' },
    'export-app': { type: 'string' },
    ios: { type: 'boolean', default: false },
    shell: { type: 'boolean', default: false },
    explorer: { type: 'boolean', default: false },
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
const tailwindVersion = args['tailwind-version'];
if (
  tailwindVersion !== undefined &&
  tailwindVersion !== '3' &&
  tailwindVersion !== '4'
) {
  throw new Error(`--tailwind-version must be 3 or 4, not ${tailwindVersion}`);
}
const buildNative = args['build-native'];
if (
  buildNative !== undefined &&
  buildNative !== 'android' &&
  buildNative !== 'ios'
) {
  throw new Error(`--build-native must be android or ios, not ${buildNative}`);
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
/**
 * Copies the generated app without node_modules, which is large and specific
 * to the OS (rspack and esbuild ship native binaries), or .angular, Angular's
 * cache, which holds the generated native projects with hundreds of megabytes
 * of Gradle or Xcode build output. A native build's binaries are in dist/.
 */
const copyApp = (appDir: string, destination: string) => {
  cpSync(appDir, destination, {
    recursive: true,
    filter: (source) => {
      const [first] = path.relative(appDir, source).split(path.sep);
      return first !== 'node_modules' && first !== '.angular';
    },
  });
};

const collectFailureArtifacts = (
  runContext: RunContext,
  failedApp?: ScaffoldedApp,
) => {
  const appDir = failedApp?.dir ?? path.join(runContext.workDir, 'my-app');
  if (existsSync(appDir)) {
    copyApp(appDir, path.join(runContext.artifactsDir, 'app'));
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
      ? await loadTarballs(args.tarballs)
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
          packageManager === 'npm' &&
          !args.angular &&
          !args['no-tailwind'] &&
          !tailwindVersion
            ? 'create'
            : 'ng-add',
        angular: args.angular,
        packageManager,
        tailwind: !args['no-tailwind'],
        tailwindVersion,
        rspeedy: args.rspeedy,
        buildOnly: args['build-only'],
      },
      registry,
      context,
    );
  }

  if (app && buildNative) {
    step(`Layer 2: ng build --platform ${buildNative}`);
    await run('npx', ['ng', 'build', '--platform', buildNative], {
      cwd: app.dir,
      logFile: context.logFile,
    });
  }

  if (app && args['export-app']) {
    copyApp(app.dir, args['export-app']);
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
      explorer: !args.shell || args.explorer,
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
    // Retries cover Windows, which can take a moment after a process exits
    // to release its files (Node retries on EPERM and EBUSY).
    rmSync(context.workDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
    });
  }
  console.log(`Logs: ${context.artifactsDir}`);
}
process.exit(failed ? 1 : 0);
