import {
  copyFileSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import type { RunContext } from './context.ts';
import { REPO_ROOT } from '../../release/src/packages.ts';
import type { Registry } from './registry.ts';
import { check, run, start, step, stop, waitFor } from './process.ts';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export type ScaffoldOptions = {
  /** Version of our packages to install, e.g. 22.2.0. */
  readonly version: string;
  /**
   * `create` runs `npm create angular-lynx`, exactly as the README says.
   * `ng-add` runs `ng new` and `ng add` separately, which is the only way to
   * vary the Angular version or package manager, and to pass `ng add`
   * options such as `--tailwind=false`.
   */
  readonly scaffolder: 'create' | 'ng-add';
  /** Angular CLI version for `ng-add`, e.g. `22.2.0`, `22` or `next`. */
  readonly angular?: string;
  readonly packageManager: PackageManager;
  readonly tailwind: boolean;
  /**
   * Replace the @lynx-js/rspeedy version `ng add` pins, e.g. with `latest`,
   * for early warning of Lynx toolchain changes.
   */
  readonly rspeedy?: string;
  /**
   * Only produce the app the browser and native tests run: scaffold, add the
   * fixtures and do the production build. Skips the intermediate build, the
   * tests, the dev server and the type-check. CI uses it to hand the native
   * jobs a bundle sooner, while the full run continues in parallel.
   */
  readonly buildOnly?: boolean;
};

/** The app a run generated, for Layers 3 and 6. */
export type ScaffoldedApp = {
  readonly dir: string;
  readonly name: string;
  readonly distDir: string;
};

const APP_NAME = 'my-app';
const FIXTURES_DIR = path.join(REPO_ROOT, 'packages/e2e/fixtures');

/**
 * Layer 2: does what a new user does, from scaffolding to a production build,
 * against the packages in `registry`, and checks the outcome of every step.
 */
export const scaffoldApp = async (
  options: ScaffoldOptions,
  registry: Registry,
  context: RunContext,
): Promise<ScaffoldedApp> => {
  const appDir = path.join(context.workDir, APP_NAME);
  const pm = packageManagerCommands(options.packageManager);
  const exec = (command: string, args: string[], cwd = appDir) =>
    run(command, args, { cwd, env: registry.env, logFile: context.logFile });

  // Step 1: scaffold.
  let scaffoldOutput: string;
  if (options.scaffolder === 'create') {
    step(`Layer 2: npm create angular-lynx@${options.version} ${APP_NAME}`);
    ({ output: scaffoldOutput } = await exec(
      'npm',
      ['create', `angular-lynx@${options.version}`, APP_NAME],
      context.workDir,
    ));
  } else {
    scaffoldOutput = await scaffoldWithNgAdd(options, registry, context);
  }

  // Step 2: check what the scaffold produced.
  step('Layer 2: check the generated project');
  checkGeneratedProject(appDir);

  // Step 3: check what got installed.
  step('Layer 2: check the installed packages');
  checkInstalledPackages(appDir, options, registry, scaffoldOutput);

  if (options.rspeedy) {
    step(`Layer 2: install @lynx-js/rspeedy@${options.rspeedy}`);
    await exec(...pm.addDev(`@lynx-js/rspeedy@${options.rspeedy}`));
  }

  // Step 5 comes before the final build so the build (and Layer 3) cover the
  // generated component, the test setup and i18n together.
  step('Layer 2: ng generate @blotch/angular-lynx:component hello');
  await exec(
    ...pm.exec('ng', ['generate', '@blotch/angular-lynx:component', 'hello']),
  );
  const helloDir = path.join(appDir, 'src/app/hello');
  for (const file of ['hello.ts', 'hello.test.ts']) {
    check(
      existsSync(path.join(helloDir, file)),
      `\`ng generate @blotch/angular-lynx:component hello\` didn't create src/app/hello/${file}.`,
    );
  }
  useHelloInApp(appDir);
  if (!options.buildOnly) {
    await buildApp(appDir, pm, registry, context, ['lynx']);
    await addTestingAndRunTests(appDir, pm, exec);
  }

  // i18n is part of every app the later layers test, so the native tests run
  // the same app as the browser test.
  step('Layer 2: ng generate @blotch/angular-lynx:add-i18n');
  await exec(...pm.exec('ng', ['generate', '@blotch/angular-lynx:add-i18n']));
  await exec(...pm.install());

  // Swap in the fixtures Layer 3 and Layer 6 interact with: the counter
  // replaces the generated hello component, and a lazy route proves chunk
  // loading. Done after the tests, which expect hello's generated template.
  applyFixtures(appDir);

  if (!options.buildOnly) {
    // Step 6: the dev server takes code paths `build` doesn't, such as watch
    // mode and the Angular rebuild coordinator. It runs before the production
    // build because it writes its development bundles into dist/, which
    // Layers 3 and 6 must not test.
    step('Layer 2: dev server smoke test');
    await smokeTestDevServer(appDir, pm, registry, context);
  }

  // Step 4: the final build, covering both environments.
  step('Layer 2: production build');
  await buildApp(appDir, pm, registry, context, ['lynx', 'web']);
  if (!options.buildOnly) {
    await typeCheck(appDir, pm, registry, context);
  }

  return { dir: appDir, name: APP_NAME, distDir: path.join(appDir, 'dist') };
};

const addTestingAndRunTests = async (
  appDir: string,
  pm: PackageManagerCommands,
  exec: (command: string, args: string[]) => Promise<{ output: string }>,
) => {
  step(
    'Layer 2: ng generate @blotch/angular-lynx:add-testing, then run the tests',
  );
  const testRunners = () => {
    const { devDependencies = {} } = readJson<PackageJson>(
      path.join(appDir, 'package.json'),
    );
    return {
      vitest: devDependencies['vitest'],
      jsdom: devDependencies['jsdom'],
    };
  };
  const testRunnersBefore = testRunners();
  await exec(
    ...pm.exec('ng', ['generate', '@blotch/angular-lynx:add-testing']),
  );
  // add-testing used to replace the Vitest and jsdom `ng new` installs with
  // older majors; the tests below must pass on the project's own versions.
  if (testRunnersBefore.vitest && testRunnersBefore.jsdom) {
    check(
      JSON.stringify(testRunners()) === JSON.stringify(testRunnersBefore),
      `add-testing changed the project's test runner versions from ${JSON.stringify(testRunnersBefore)} to ${JSON.stringify(testRunners())}.`,
    );
  }
  // add-testing adds devDependencies without installing them.
  await exec(...pm.install());
  check(
    existsSync(path.join(appDir, 'vitest.config.ts')),
    "`ng generate @blotch/angular-lynx:add-testing` didn't create vitest.config.ts.",
  );
  const { output: testOutput } = await exec(...pm.run('test'));
  // The generated component's test is the project's only test, so one passing
  // test file proves add-testing's `include` pattern finds it. (Vitest only
  // lists test file names when attached to a terminal.)
  check(
    /Test Files\s+1 passed/.test(stripAnsi(testOutput)),
    "The generated component's test (src/app/hello/hello.test.ts) didn't run. Check the `include` pattern in the vitest.config.ts that add-testing writes.",
  );
  console.log("✓ the generated component's test passes");
};

type Command = [command: string, args: string[]];

const packageManagerCommands = (packageManager: PackageManager) => ({
  install: (): Command => [packageManager, ['install']],
  addDev: (spec: string): Command =>
    packageManager === 'npm'
      ? ['npm', ['install', '--save-dev', spec]]
      : [packageManager, ['add', '--save-dev', spec]],
  run: (script: string): Command => [packageManager, ['run', script]],
  exec: (bin: string, args: string[]): Command => {
    switch (packageManager) {
      case 'npm':
        // --no: never download a package called `ng` from the registry; the
        // project's own @angular/cli must provide it. `--` stops npx from
        // reading the command's own options (such as ngc's -p) as its own.
        return ['npx', ['--no', '--', bin, ...args]];
      case 'pnpm':
        return ['pnpm', ['exec', bin, ...args]];
      case 'yarn':
        return ['yarn', [bin, ...args]];
    }
  },
});

type PackageManagerCommands = ReturnType<typeof packageManagerCommands>;

const scaffoldWithNgAdd = async (
  options: ScaffoldOptions,
  registry: Registry,
  context: RunContext,
) => {
  const angular = options.angular ?? options.version.split('.')[0]!;
  const appDir = path.join(context.workDir, APP_NAME);
  const exec = (args: string[], cwd: string) =>
    run('npx', ['-y', `@angular/cli@${angular}`, ...args], {
      cwd,
      env: registry.env,
      logFile: context.logFile,
    });

  step(
    `Layer 2: ng new ${APP_NAME} (Angular ${angular}, ${options.packageManager})`,
  );
  await exec(
    [
      'new',
      APP_NAME,
      '--skip-install',
      '--skip-git',
      '--style',
      'css',
      '--ssr',
      'false',
      '--package-manager',
      options.packageManager,
    ],
    context.workDir,
  );
  configurePackageManager(appDir, options.packageManager, registry);

  step(`Layer 2: ng add @blotch/angular-lynx@${options.version}`);
  const { output } = await exec(
    [
      'add',
      `@blotch/angular-lynx@${options.version}`,
      '--skip-confirmation',
      ...(options.tailwind ? [] : ['--tailwind=false']),
    ],
    appDir,
  );
  const install = await run(options.packageManager, ['install'], {
    cwd: appDir,
    env: registry.env,
    logFile: context.logFile,
  });
  return output + install.output;
};

/**
 * pnpm and Yarn don't read npm's user config the same way npm does, so point
 * them at the registry with project-level config files.
 */
const configurePackageManager = (
  appDir: string,
  packageManager: PackageManager,
  registry: Registry,
) => {
  if (packageManager === 'pnpm') {
    copyFileSync(registry.npmrc, path.join(appDir, '.npmrc'));
  }
  if (packageManager === 'yarn') {
    const host = new URL(registry.url).hostname;
    writeFileSync(
      path.join(appDir, '.yarnrc.yml'),
      [
        // The plan supports Yarn's node_modules linker only; Plug'n'Play
        // needs every dependency declared, which Angular CLI itself doesn't
        // manage.
        'nodeLinker: node-modules',
        `npmRegistryServer: "${registry.url}"`,
        `unsafeHttpWhitelist: ["${host}"]`,
        '',
      ].join('\n'),
    );
    writeFileSync(path.join(appDir, 'yarn.lock'), '');
  }
};

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  version?: string;
};

const readJson = <T>(file: string) =>
  JSON.parse(readFileSync(file, 'utf8')) as T;

const checkGeneratedProject = (appDir: string) => {
  check(
    existsSync(path.join(appDir, 'lynx.config.ts')),
    '`ng add` didn\'t create lynx.config.ts. If it printed "does not provide any `ng add` actions", the schematics failed to load.',
  );
  const pkg = readJson<PackageJson>(path.join(appDir, 'package.json'));
  check(
    pkg.scripts?.['build'] === 'ng build',
    `package.json's build script is ${JSON.stringify(pkg.scripts?.['build'])}, not "ng build".`,
  );
  check(
    pkg.scripts?.['start'] === 'ng serve',
    `package.json's start script is ${JSON.stringify(pkg.scripts?.['start'])}, not "ng serve".`,
  );
  // `npm run build` and `npm start` only build a Lynx bundle when the targets
  // run AngularLynx's builders; Angular's own builders would try to build a
  // browser app from Lynx templates.
  const targets = readJson<{
    projects: Record<
      string,
      { architect?: Record<string, { builder: string }> }
    >;
  }>(path.join(appDir, 'angular.json')).projects;
  const architect = Object.values(targets)[0]?.architect ?? {};
  check(
    architect['build']?.builder === '@blotch/angular-lynx:application',
    `angular.json's build target uses ${JSON.stringify(architect['build']?.builder)}, not @blotch/angular-lynx:application. \`ng add\` didn't switch it.`,
  );
  check(
    architect['serve']?.builder === '@blotch/angular-lynx:dev-server',
    `angular.json's serve target uses ${JSON.stringify(architect['serve']?.builder)}, not @blotch/angular-lynx:dev-server. \`ng add\` didn't switch it.`,
  );
  for (const dependency of [
    '@blotch/rsbuild-plugin-angular-lynx',
    '@blotch/angular-lynx-native',
  ]) {
    check(
      pkg.devDependencies?.[dependency],
      `\`ng add\` didn't add ${dependency} to devDependencies.`,
    );
  }
  const mainTs = readFileSync(path.join(appDir, 'src/main.ts'), 'utf8');
  check(
    /import\s*\{[^}]*\bbootstrapApplication\b[^}]*\}\s*from\s*'@blotch\/angular-lynx'/.test(
      mainTs,
    ),
    "src/main.ts doesn't import bootstrapApplication from '@blotch/angular-lynx'.",
  );
  const appTs = readFileSync(path.join(appDir, 'src/app/app.ts'), 'utf8');
  check(
    /import\s*\{[^}]*\bLYNX_ELEMENTS\b[^}]*\}\s*from\s*'@blotch\/angular-lynx'/.test(
      appTs,
    ),
    "src/app/app.ts doesn't import LYNX_ELEMENTS from '@blotch/angular-lynx', so its template won't compile.",
  );
  // `ng new` writes the root component's template, styles and test as separate
  // files (app.html, app.css and app.spec.ts since Angular 20, and
  // app.component.* before that). ng add inlines the template in app.ts, so
  // the leftovers are dead code, and the spec tests the deleted template.
  const leftovers = [
    'app.component.ts',
    'app.component.html',
    'app.component.css',
    'app.component.spec.ts',
    'app.html',
    'app.css',
    'app.spec.ts',
  ].filter((file) => existsSync(path.join(appDir, 'src/app', file)));
  check(
    leftovers.length === 0,
    `\`ng add\` left these \`ng new\` files behind in src/app: ${leftovers.join(', ')}.`,
  );
  console.log(
    '✓ the project has lynx.config.ts, the AngularLynx builders and Lynx bootstrap files',
  );
};

const OUR_RUNTIME_PACKAGES = [
  '@blotch/angular-lynx',
  '@blotch/rsbuild-plugin-angular-lynx',
  '@blotch/angular-lynx-native',
];

type PackageLock = {
  packages: Record<
    string,
    { version?: string; resolved?: string; hasInstallScript?: boolean }
  >;
};

const checkInstalledPackages = (
  appDir: string,
  options: ScaffoldOptions,
  registry: Registry,
  installOutput: string,
) => {
  for (const name of OUR_RUNTIME_PACKAGES) {
    const manifest = path.join(appDir, 'node_modules', name, 'package.json');
    check(
      existsSync(manifest),
      `${name} isn't installed in the generated app.`,
    );
    const { version } = readJson<PackageJson>(manifest);
    check(
      version === options.version,
      `${name}@${version} is installed, but this run tests ${options.version}. A version range in ng-add/versions.ts or the scaffolder doesn't match.`,
    );
  }

  if (options.packageManager === 'npm') {
    const lock = readJson<PackageLock>(path.join(appDir, 'package-lock.json'));
    for (const [location, entry] of Object.entries(lock.packages)) {
      if (!location.startsWith('node_modules/@blotch/')) {
        continue;
      }
      const name = location.slice('node_modules/'.length);
      check(
        entry.resolved?.startsWith(registry.url) ?? false,
        `${name} was installed from ${entry.resolved}, not from ${registry.url}.`,
      );
      // npm 11 skips dependencies' install scripts unless the user approves
      // them, so our packages must work without one. The plugin's postinstall
      // patch broke every 22.2.x install this way.
      check(
        !entry.hasInstallScript,
        `${name} has an install script. npm 11 doesn't run dependencies' install scripts by default, so it must not rely on one.`,
      );
    }
  }

  // npm 11 lists dependencies whose install scripts it skipped. None of ours
  // may be among them.
  const skipped = stripAnsi(installOutput)
    .split('\n')
    .filter((line) => /install-scripts/.test(line) && /@blotch\//.test(line));
  check(
    skipped.length === 0,
    `npm skipped install scripts of our packages:\n${skipped.join('\n')}`,
  );
  console.log(
    `✓ ${OUR_RUNTIME_PACKAGES.join(' and ')} are installed at ${options.version} from ${registry.url}, with no install scripts`,
  );
};

/**
 * Renders the generated hello component in the root component.
 */
const useHelloInApp = (appDir: string) => {
  const appTsPath = path.join(appDir, 'src/app/app.ts');
  let appTs = readFileSync(appTsPath, 'utf8');
  appTs = `import { Hello } from './hello/hello';\n${appTs}`;
  appTs = appTs.replace('imports: [', 'imports: [Hello, ');
  appTs = appTs.replace(
    '<router-outlet />',
    '<app-hello />\n        <router-outlet />',
  );
  check(
    appTs.includes('<app-hello />') && appTs.includes('imports: [Hello, '),
    "Couldn't add <app-hello /> to src/app/app.ts; the template ng add generates has changed shape. Update useHelloInApp() in packages/e2e/src/scaffold.ts.",
  );
  writeFileSync(appTsPath, appTs);
};

/**
 * Replaces the generated hello component with the counter fixture and adds a
 * lazy-loaded route, for the checks in Layers 3 and 6.
 */
const applyFixtures = (appDir: string) => {
  copyFileSync(
    path.join(FIXTURES_DIR, 'counter.ts'),
    path.join(appDir, 'src/app/hello/hello.ts'),
  );
  copyFileSync(
    path.join(FIXTURES_DIR, 'lazy-route.ts'),
    path.join(appDir, 'src/app/lazy-route.ts'),
  );
  // The generated test checks the generated template, which the fixture
  // replaced. It already passed in its own step.
  writeFileSync(
    path.join(appDir, 'src/app/hello/hello.test.ts'),
    readFileSync(path.join(FIXTURES_DIR, 'counter.test.ts'), 'utf8'),
  );
  writeFileSync(
    path.join(appDir, 'src/app/app.routes.ts'),
    `import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'lazy',
    loadComponent: () => import('./lazy-route').then((m) => m.LazyRoute),
  },
];
`,
  );
};

// Build tools color their output; match against plain text.
const stripAnsi = stripVTControlCharacters;

/**
 * Builds the app and checks the output. `environments` are the bundles the
 * build must produce; the web bundle needs the `web` environment that `ng add`
 * puts in lynx.config.ts.
 */
const buildApp = async (
  appDir: string,
  pm: PackageManagerCommands,
  registry: Registry,
  context: RunContext,
  environments: readonly ('lynx' | 'web')[],
) => {
  const { output } = await run(...pm.run('build'), {
    cwd: appDir,
    env: registry.env,
    logFile: context.logFile,
  });
  // The build can report failures while still exiting 0: rspeedy logs
  // `error` lines for some of them. TypeScript and Angular compiler
  // diagnostics (TS2307, NG8001, ...) fail the build since the plugin reports
  // them through rspack; matching them here as well keeps a regression of
  // that from passing silently.
  const errorLines = stripAnsi(output)
    .split('\n')
    .filter(
      (line) => /^\s*(error|✖)\s/i.test(line) || /\b(TS|NG)\d{4,5}:/.test(line),
    );
  check(
    errorLines.length === 0,
    `\`build\` exited 0 but logged errors:\n${errorLines.join('\n')}`,
  );
  for (const environment of environments) {
    const bundle = path.join(appDir, 'dist', `main.${environment}.bundle`);
    check(
      existsSync(bundle) && statSync(bundle).size > 0,
      `The build didn't produce a non-empty dist/main.${environment}.bundle.${environment === 'web' ? ' Check that lynx.config.ts has a `web` environment.' : ''}`,
    );
  }
  console.log(
    `✓ build produced ${environments.map((environment) => `main.${environment}.bundle`).join(' and ')}`,
  );
};

/**
 * Type-checks the app, templates included, with Angular's own compiler rather
 * than the build's: an `ng add` that generates code with type errors (as
 * 22.2.1's app.ts did) must fail the run even if the build plugin stops
 * reporting them.
 */
const typeCheck = async (
  appDir: string,
  pm: PackageManagerCommands,
  registry: Registry,
  context: RunContext,
) => {
  step('Layer 2: type-check with the Angular compiler');
  // ngc checks templates as well as TypeScript, under the strictTemplates
  // option `ng new` turns on.
  await run(...pm.exec('ngc', ['-p', 'tsconfig.app.json', '--noEmit']), {
    cwd: appDir,
    env: registry.env,
    logFile: context.logFile,
  });
  console.log('✓ the app type-checks, templates included');
};

const smokeTestDevServer = async (
  appDir: string,
  pm: PackageManagerCommands,
  registry: Registry,
  context: RunContext,
) => {
  const { child, output } = start(...pm.run('start'), {
    cwd: appDir,
    env: registry.env,
    logFile: context.logFile,
  });
  try {
    let bundleUrl: string | undefined;
    await waitFor(
      'the dev server to print its bundle URL',
      () => {
        if (child.exitCode !== null) {
          throw new Error(
            `The dev server exited with code ${child.exitCode} before it was ready.`,
          );
        }
        bundleUrl = stripAnsi(output()).match(
          /https?:\/\/[^\s?]+\.lynx\.bundle/,
        )?.[0];
        return bundleUrl !== undefined;
      },
      { timeoutMs: 180_000 },
    );
    // The URL appears once the server listens, which can be before the first
    // compile finishes; the dev server answers bundle requests after it does.
    let status = 0;
    let size = 0;
    await waitFor(
      `${bundleUrl} to serve the bundle`,
      async () => {
        try {
          const response = await fetch(bundleUrl!);
          status = response.status;
          size = (await response.arrayBuffer()).byteLength;
          return response.ok && size > 0;
        } catch {
          return false;
        }
      },
      { timeoutMs: 180_000, intervalMs: 2000 },
    );
    console.log(
      `✓ dev server served ${bundleUrl} (HTTP ${status}, ${size} bytes)`,
    );
  } finally {
    stop(child);
  }
};
