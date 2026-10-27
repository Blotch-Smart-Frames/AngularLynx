import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
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
   * Replace the @lynx-js/rspeedy version @blotch/angular-lynx-build depends
   * on, e.g. with `latest`, for early warning of Lynx toolchain changes.
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
  /** Whether the app was made with Tailwind. */
  readonly tailwind: boolean;
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
  checkGeneratedProject(appDir, options.version);

  // Step 3: check what got installed.
  step('Layer 2: check the installed packages');
  checkInstalledPackages(appDir, options, registry, scaffoldOutput);

  if (options.rspeedy) {
    await overrideRspeedy(appDir, options, pm, exec);
  }

  // Step 5 comes before the final build so the build (and Layer 3) cover the
  // generated component, the test setup and i18n together. Plain
  // `ng generate component`: `ng add` makes it reach AngularLynx's schematic.
  step('Layer 2: ng generate component hello');
  await exec(...pm.exec('ng', ['generate', 'component', 'hello']));
  checkGeneratedComponent(appDir, 'hello', 'hello.spec.ts');
  useHelloInApp(appDir);
  if (!options.buildOnly) {
    await buildApp(appDir, pm, registry, context, ['lynx']);
    await addTestingAndRunTests(appDir, pm, exec, options.version);
  }

  // i18n is part of every app the later layers test, so the native tests run
  // the same app as the browser test.
  step('Layer 2: ng generate @blotch/angular-lynx:add-i18n');
  await exec(...pm.exec('ng', ['generate', '@blotch/angular-lynx:add-i18n']));
  const { dependencies = {}, devDependencies = {} } = readJson<PackageJson>(
    path.join(appDir, 'package.json'),
  );
  const coreRange = dependencies['@angular/core'];
  const localizeRange =
    devDependencies['@angular/localize'] ?? dependencies['@angular/localize'];
  check(
    localizeRange === coreRange,
    `add-i18n added @angular/localize@${localizeRange}, but the app's @angular/core is ${coreRange}. It must take the app's Angular range.`,
  );
  await exec(...pm.install());

  // Swap in the fixtures Layer 3 and Layer 6 interact with: the counter
  // replaces the generated hello component, and a lazy route proves chunk
  // loading. Done after the tests, which expect hello's generated template.
  applyFixtures(appDir, options.tailwind);

  if (!options.buildOnly) {
    await extractMessages(appDir, exec, pm);

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

  return {
    dir: appDir,
    name: APP_NAME,
    distDir: path.join(appDir, 'dist'),
    tailwind: options.tailwind,
  };
};

/**
 * `ng extract-i18n`, through the target add-i18n writes: Angular CLI can't
 * pick an extractor for the Lynx build builder by itself. The counter fixture
 * marks "Increment" for translation, so the messages file shows the extractor
 * compiled the app, and that it wrote the JSON `loadTranslations()` takes.
 */
const extractMessages = async (
  appDir: string,
  exec: (command: string, args: string[]) => Promise<{ output: string }>,
  pm: PackageManagerCommands,
) => {
  step('Layer 2: ng extract-i18n');
  await exec(...pm.exec('ng', ['extract-i18n']));
  const messagesFile = path.join(appDir, 'src/locale/messages.json');
  check(
    existsSync(messagesFile),
    "ng extract-i18n didn't write src/locale/messages.json, where add-i18n's target puts the messages.",
  );
  const { translations } = readJson<{
    translations?: Record<string, string>;
  }>(messagesFile);
  check(
    translations?.['e2e.increment'] === 'Increment',
    `src/locale/messages.json doesn't hold the counter's "Increment" message as JSON for loadTranslations(): ${JSON.stringify(translations)}`,
  );
  console.log('✓ ng extract-i18n wrote the messages as JSON to src/locale');
};

const addTestingAndRunTests = async (
  appDir: string,
  pm: PackageManagerCommands,
  exec: (command: string, args: string[]) => Promise<{ output: string }>,
  version: string,
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
  const { scripts, devDependencies } = readJson<PackageJson>(
    path.join(appDir, 'package.json'),
  );
  checkOwnRange(
    devDependencies,
    '@blotch/angular-lynx-testing-library',
    version,
    'add-testing',
  );
  check(
    scripts?.['test'] === 'ng test',
    `package.json's test script is ${JSON.stringify(scripts?.['test'])}, not "ng test".`,
  );
  // With the testing library installed, a generated component's test renders
  // it on Lynx instead of with TestBed.
  await exec(...pm.exec('ng', ['generate', 'component', 'greeting']));
  checkGeneratedComponent(appDir, 'greeting', 'greeting.test.ts');
  const { output: testOutput } = await exec(...pm.run('test'));
  // `ng test` finds both kinds: hello's Angular TestBed spec (generated
  // before the testing library was installed) and greeting's Lynx test.
  // (Vitest only lists test file names when attached to a terminal.)
  check(
    /Test Files\s+2 passed/.test(stripAnsi(testOutput)),
    "`ng test` didn't run and pass both generated tests (src/app/hello/hello.spec.ts and src/app/greeting/greeting.test.ts).",
  );
  console.log("✓ the generated components' tests pass under `ng test`");
};

/**
 * Checks what `ng generate component <name>` produced: Angular's files, made
 * Lynx ones by AngularLynx's schematic, and the test it should have written.
 */
const checkGeneratedComponent = (
  appDir: string,
  name: string,
  testFile: string,
) => {
  const dir = path.join(appDir, 'src/app', name);
  for (const file of [`${name}.ts`, `${name}.html`, testFile]) {
    check(
      existsSync(path.join(dir, file)),
      `\`ng generate component ${name}\` didn't create src/app/${name}/${file}.`,
    );
  }
  check(
    readFileSync(path.join(dir, `${name}.html`), 'utf8').includes(
      `<text>${name} works!</text>`,
    ) &&
      readFileSync(path.join(dir, `${name}.ts`), 'utf8').includes(
        'imports: [LYNX_ELEMENTS]',
      ),
    `\`ng generate component ${name}\` made a web component, not a Lynx one. Check that \`ng add\` put @blotch/angular-lynx first in angular.json's cli.schematicCollections.`,
  );
};

/**
 * Makes every package in the app use `options.rspeedy`: rspeedy is a
 * dependency of @blotch/angular-lynx-build, not of the app, so installing
 * it in the app wouldn't change the one the builders run. Each package
 * manager has its own override field; the spec (often a dist-tag) is resolved
 * to a version first, which all of them accept.
 */
const overrideRspeedy = async (
  appDir: string,
  options: ScaffoldOptions,
  pm: PackageManagerCommands,
  exec: (command: string, args: string[]) => Promise<{ output: string }>,
) => {
  step(`Layer 2: override @lynx-js/rspeedy with ${options.rspeedy}`);
  const { output } = await exec('npm', [
    'view',
    `@lynx-js/rspeedy@${options.rspeedy}`,
    'version',
  ]);
  const version = output.trim().split('\n').pop()!.trim();
  const manifestPath = path.join(appDir, 'package.json');
  const manifest = readJson<Record<string, unknown>>(manifestPath);
  const override = { '@lynx-js/rspeedy': version };
  if (options.packageManager === 'npm') {
    manifest['overrides'] = override;
  } else if (options.packageManager === 'pnpm') {
    manifest['pnpm'] = { overrides: override };
  } else {
    manifest['resolutions'] = override;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await exec(...pm.install());
};

type Command = [command: string, args: string[]];

const packageManagerCommands = (packageManager: PackageManager) => ({
  install: (): Command => [packageManager, ['install']],
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
  // An Angular prerelease (`--angular next`) never satisfies our `^22.x.0`
  // peer range, so npm refuses to install @blotch/angular-lynx at all and the
  // job never gets as far as testing anything. The job is there to catch the
  // next Angular breaking us early, so let npm skip the peer check. A project
  // .npmrc covers ng add's own install and every later npm command.
  if (
    options.packageManager === 'npm' &&
    (angular === 'next' || angular.includes('-'))
  ) {
    writeFileSync(path.join(appDir, '.npmrc'), 'legacy-peer-deps=true\n');
  }

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
        // Yarn quarantines versions published less than a day ago, and every
        // package under test was published to the local registry seconds ago.
        'npmMinimalAgeGate: 0',
        // CI=true (see registry.ts) makes Yarn refuse to change the lockfile,
        // but `ng add` adds dependencies and then installs them, as it would
        // on a developer's machine.
        'enableImmutableInstalls: false',
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

/**
 * Checks that a schematic added one of our packages at the release it shipped
 * in. checkInstalledPackages can't see a stale range: while this release is
 * the newest, `^22.2.1` installs it too. The range only goes wrong after the
 * next release, when an older `ng add` would install newer builders.
 */
const checkOwnRange = (
  devDependencies: Record<string, string> | undefined,
  name: string,
  version: string,
  schematic: string,
) => {
  check(
    devDependencies?.[name] === `^${version}`,
    `${schematic} added ${name}@${devDependencies?.[name]} to devDependencies, not ^${version}. Our packages must be added at the release the schematic shipped in (ownVersionRange in ng-add/versions.ts).`,
  );
};

const checkGeneratedProject = (appDir: string, version: string) => {
  check(
    existsSync(path.join(appDir, 'src/rspeedy-env.d.ts')),
    '`ng add` didn\'t create src/rspeedy-env.d.ts. If it printed "does not provide any `ng add` actions", the schematics failed to load.',
  );
  // angular.json holds the build config; lynx.config.ts is only for
  // customizing rspeedy.
  check(
    !existsSync(path.join(appDir, 'lynx.config.ts')),
    "`ng add` created lynx.config.ts, which a new app doesn't need.",
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
  const workspace = readJson<{
    cli?: { schematicCollections?: string[] };
    projects: Record<
      string,
      {
        architect?: Record<
          string,
          {
            builder: string;
            configurations?: Record<string, Record<string, unknown>>;
          }
        >;
      }
    >;
  }>(path.join(appDir, 'angular.json'));
  const architect = Object.values(workspace.projects)[0]?.architect ?? {};
  check(
    architect['build']?.builder === '@blotch/angular-lynx-build:application',
    `angular.json's build target uses ${JSON.stringify(architect['build']?.builder)}, not @blotch/angular-lynx-build:application. \`ng add\` didn't switch it.`,
  );
  check(
    architect['serve']?.builder === '@blotch/angular-lynx-build:dev-server',
    `angular.json's serve target uses ${JSON.stringify(architect['serve']?.builder)}, not @blotch/angular-lynx-build:dev-server. \`ng add\` didn't switch it.`,
  );
  check(
    architect['test']?.builder === '@blotch/angular-lynx-build:unit-test',
    `angular.json's test target uses ${JSON.stringify(architect['test']?.builder)}, not @blotch/angular-lynx-build:unit-test. \`ng add\` didn't switch it.`,
  );
  // Angular CLI picks an extractor by itself only for Angular's own build
  // builders, so without this target `ng extract-i18n` can't run.
  check(
    architect['extract-i18n']?.builder ===
      '@blotch/angular-lynx-build:extract-i18n',
    `angular.json's extract-i18n target uses ${JSON.stringify(architect['extract-i18n']?.builder)}, not @blotch/angular-lynx-build:extract-i18n. \`ng add\` didn't add it.`,
  );
  // `ng serve` writes LynxLogger's output to .dev-logs.
  check(
    /^\.dev-logs$/m.test(readFileSync(path.join(appDir, '.gitignore'), 'utf8')),
    "`ng add` didn't add .dev-logs to .gitignore.",
  );
  check(
    workspace.cli?.schematicCollections?.[0] === '@blotch/angular-lynx',
    `angular.json's cli.schematicCollections is ${JSON.stringify(workspace.cli?.schematicCollections)}, so \`ng generate component\` wouldn't make Lynx components.`,
  );
  // Angular's `optimization` picks the mode; `ng add` adds no option of its
  // own to the configurations.
  const configurations = architect['build']?.configurations ?? {};
  check(
    Object.values(configurations).every((options) => !('mode' in options)),
    "angular.json's build configurations have a `mode` option, which Angular doesn't know.",
  );
  checkOwnRange(
    pkg.devDependencies,
    '@blotch/angular-lynx-build',
    version,
    '`ng add`',
  );
  // The builders bring rspeedy and its plugins, as @angular/build brings
  // esbuild and Vite.
  const extras = ['@lynx-js/rspeedy', '@lynx-js/qrcode-rsbuild-plugin'].filter(
    (name) => pkg.devDependencies?.[name] ?? pkg.dependencies?.[name],
  );
  check(
    extras.length === 0,
    `\`ng add\` added build tools the app doesn't need: ${extras.join(', ')}.`,
  );
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
    '✓ the project has the AngularLynx builders and schematics, and Lynx bootstrap files',
  );
};

/**
 * Our packages in a generated app, and the package that depends on each. The
 * rsbuild plugin and the native builder are dependencies of the builders, not
 * of the app, so they are found the way Node finds them from there: pnpm
 * doesn't link them into the app's own node_modules.
 */
const OUR_RUNTIME_PACKAGES = [
  { name: '@blotch/angular-lynx' },
  { name: '@blotch/angular-lynx-build' },
  {
    name: '@blotch/rsbuild-plugin-angular-lynx',
    from: '@blotch/angular-lynx-build',
  },
  {
    name: '@blotch/angular-lynx-native',
    from: '@blotch/angular-lynx-build',
  },
];

const findManifest = (
  appDir: string,
  { name, from }: { name: string; from?: string },
) => {
  const appManifest = path.join(appDir, 'package.json');
  const parent = from
    ? realpathSync(path.join(appDir, 'node_modules', from, 'package.json'))
    : appManifest;
  try {
    return createRequire(parent).resolve(`${name}/package.json`);
  } catch {
    return undefined;
  }
};

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
  for (const pkg of OUR_RUNTIME_PACKAGES) {
    const { name } = pkg;
    const manifest = findManifest(appDir, pkg);
    check(manifest, `${name} isn't installed in the generated app.`);
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
    `✓ ${OUR_RUNTIME_PACKAGES.map(({ name }) => name).join(', ')} are installed at ${options.version} from ${registry.url}, with no install scripts`,
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
 * Replaces the generated hello component with the counter fixture and adds
 * two lazy-loaded routes, for the checks in Layers 3 and 6.
 */
const applyFixtures = (appDir: string, tailwind: boolean) => {
  if (tailwind) {
    addUiTheme(appDir);
  }
  copyFileSync(
    path.join(FIXTURES_DIR, 'counter.ts'),
    path.join(appDir, 'src/app/hello/hello.ts'),
  );
  for (const file of ['tailwind-card.ts', 'tailwind-card.html']) {
    copyFileSync(
      path.join(FIXTURES_DIR, file),
      path.join(appDir, 'src/app/hello', file),
    );
  }
  for (const file of ['lazy-route.ts', 'gestures.ts']) {
    copyFileSync(
      path.join(FIXTURES_DIR, file),
      path.join(appDir, 'src/app', file),
    );
  }
  provideHttpClientInApp(appDir);
  // The generated test checks the generated template, which the fixture
  // replaced. It already passed in its own step.
  rmSync(path.join(appDir, 'src/app/hello/hello.spec.ts'), { force: true });
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
  {
    path: 'gestures',
    loadComponent: () => import('./gestures').then((m) => m.GesturesRoute),
  },
];
`,
  );
};

/**
 * Adds the UI components' theme the way `dolan init` and its next steps do:
 * copies default.css and tailwind-plugin.ts to src/styles, adds the plugin
 * to tailwind.config.ts and imports default.css in styles.css. The files come
 * from packages/ui, which dolan copies them from. tailwind-card.html uses a
 * theme color with an opacity modifier, which needs both files and the
 * app's own Tailwind build.
 */
const addUiTheme = (appDir: string) => {
  const themeDir = path.join(appDir, 'src/styles');
  mkdirSync(themeDir, { recursive: true });
  for (const file of ['default.css', 'tailwind-plugin.ts']) {
    copyFileSync(
      path.join(REPO_ROOT, 'packages/ui/src/lib/theme', file),
      path.join(themeDir, file),
    );
  }

  const configPath = path.join(appDir, 'tailwind.config.ts');
  let config = readFileSync(configPath, 'utf8');
  config = `import { blotchPlugin } from './src/styles/tailwind-plugin';\n${config}`;
  config = config.replace(
    'presets: [preset],',
    'presets: [preset],\n  plugins: [blotchPlugin],',
  );
  check(
    config.includes('plugins: [blotchPlugin],'),
    "Couldn't add the UI theme's plugin to tailwind.config.ts; the config ng add generates has changed shape. Update addUiTheme() in packages/e2e/src/scaffold.ts.",
  );
  writeFileSync(configPath, config);

  // @import has to come before Tailwind's directives.
  const stylesPath = path.join(appDir, 'src/styles.css');
  writeFileSync(
    stylesPath,
    `@import './styles/default.css';\n${readFileSync(stylesPath, 'utf8')}`,
  );
};

/**
 * Adds `provideHttpClient()` to the app config `ng add` wrote, as an app that
 * uses HttpClient does. The counter fixture loads JSON with it.
 */
const provideHttpClientInApp = (appDir: string) => {
  const configPath = path.join(appDir, 'src/app/app.config.ts');
  let config = readFileSync(configPath, 'utf8');
  config = `import { provideHttpClient } from '@angular/common/http';\n${config}`;
  config = config.replace(
    'provideRouter(routes),',
    'provideRouter(routes),\n    provideHttpClient(),',
  );
  check(
    config.includes('provideHttpClient(),'),
    "Couldn't add provideHttpClient() to src/app/app.config.ts; the config ng add generates has changed shape. Update provideHttpClientInApp() in packages/e2e/src/scaffold.ts.",
  );
  writeFileSync(configPath, config);
};

// Build tools color their output; match against plain text.
const stripAnsi = stripVTControlCharacters;

/**
 * Builds the app and checks the output. `environments` are the bundles the
 * build must produce; the builders build both the `lynx` and `web`
 * environments when the app has no lynx.config.ts.
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
      `The build didn't produce a non-empty dist/main.${environment}.bundle.${environment === 'web' ? ' Check that the builders still build the `web` environment by default.' : ''}`,
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

/**
 * `LynxLogger` in a development bundle posts to the dev server that served
 * it, which writes each entry to `.dev-logs`. The bundle used to post to a
 * second server on the next port, and lost every entry once that port was
 * taken.
 */
const checkDevLogger = async (
  appDir: string,
  bundleUrl: string,
  bundle: Buffer,
) => {
  const logUrl = `${new URL(bundleUrl).origin}/__dev_logs`;
  check(
    bundle.includes(logUrl),
    `The development bundle doesn't post LynxLogger's entries to ${logUrl}, the dev server it came from.`,
  );
  const logFile = path.join(appDir, '.dev-logs');
  const response = await fetch(logUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      logs: [
        {
          level: 'log',
          timestamp: Date.now(),
          args: ['E2E log entry', { from: 'Layer 2' }],
        },
      ],
    }),
  });
  check(
    response.ok,
    `The dev server answered HTTP ${response.status} to a log entry at ${logUrl}.`,
  );
  await waitFor(
    `${logFile} to hold the posted entry`,
    () =>
      existsSync(logFile) &&
      /E2E log entry \{\s*"from": "Layer 2"\s*\}/.test(
        readFileSync(logFile, 'utf8'),
      ),
    { timeoutMs: 10_000 },
  );
  console.log(`✓ the dev server wrote a log entry from ${logUrl} to .dev-logs`);
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
    let bundle = Buffer.alloc(0);
    await waitFor(
      `${bundleUrl} to serve the bundle`,
      async () => {
        try {
          const response = await fetch(bundleUrl!);
          status = response.status;
          bundle = Buffer.from(await response.arrayBuffer());
          return response.ok && bundle.byteLength > 0;
        } catch {
          return false;
        }
      },
      { timeoutMs: 180_000, intervalMs: 2000 },
    );
    console.log(
      `✓ dev server served ${bundleUrl} (HTTP ${status}, ${bundle.byteLength} bytes)`,
    );
    // The dev server serves whatever a failed compile emitted, so a served
    // bundle doesn't mean the build worked: a syntax error in the background
    // layer's development build once passed the check above. Rsbuild ends
    // each environment's compile with "built in …" or "build failed in …".
    const compiles = new Map<string, string>();
    await waitFor(
      'the lynx and web environments to finish their first compile',
      () => {
        for (const [, result, environment] of stripAnsi(output()).matchAll(
          /(built|build failed) in [\d.]+ ?m?s \((\w+)\)/g,
        )) {
          compiles.set(environment!, result!);
        }
        return compiles.has('lynx') && compiles.has('web');
      },
      { timeoutMs: 180_000 },
    );
    check(
      [...compiles.values()].every((result) => result === 'built'),
      `The dev server's first build failed:\n${stripAnsi(output())}`,
    );
    console.log('✓ the dev server built the lynx and web environments');
    await checkDevLogger(appDir, bundleUrl!, bundle);
  } finally {
    stop(child);
  }
};
