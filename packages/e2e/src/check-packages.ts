import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { publint } from 'publint';
import { formatMessage } from 'publint/utils';

import type { RunContext } from './context.ts';
import {
  findUnlistedPublicPackages,
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
  type PublishablePackage,
} from '../../release/src/packages.ts';
import { check, CheckError, run, runAllowFailure, step } from './process.ts';

/** A packed tarball of one publishable package. */
export type PackedPackage = {
  readonly pkg: PublishablePackage;
  readonly version: string;
  readonly tarball: string;
  /** Paths of every file in the tarball, relative to the package root. */
  readonly files: ReadonlySet<string>;
};

type NpmPackResult = {
  filename: string;
  version: string;
  files: { path: string }[];
}[];

type SchematicCollection = {
  schematics: Record<string, { factory: string }>;
};

/** Packs every publishable package into the run's tarball folder. */
export const packAll = async (context: RunContext) => {
  step('Packing every publishable package');
  const packed: PackedPackage[] = [];
  for (const pkg of PUBLISHABLE_PACKAGES) {
    packed.push(await packPackage(pkg, context));
  }
  return packed;
};

/**
 * Loads tarballs packed by an earlier job, so every job in a CI matrix tests
 * the same bytes without rebuilding the packages on each OS.
 */
export const loadTarballs = async (dir: string): Promise<PackedPackage[]> => {
  step(`Loading tarballs from ${dir}`);
  const tarballs = readdirSync(dir)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => path.resolve(dir, file));
  const packed: PackedPackage[] = [];
  for (const tarball of tarballs) {
    // tar runs from the tarball's folder and gets a bare file name. On the
    // Windows runner, Git Bash puts GNU tar first on PATH, and GNU tar reads
    // an archive named `D:\a\...` as `host:path` on a remote machine and
    // fails. `--force-local` would fix that, but the BSD tar that macOS and
    // Windows ship rejects the option.
    const listing = await run('tar', ['-tzf', path.basename(tarball)], {
      cwd: dir,
      echo: false,
    });
    const manifest = await run(
      'tar',
      ['-xzOf', path.basename(tarball), 'package/package.json'],
      {
        cwd: dir,
        echo: false,
      },
    );
    const { name, version } = JSON.parse(manifest.output) as {
      name: string;
      version: string;
    };
    const pkg = PUBLISHABLE_PACKAGES.find(
      (candidate) => candidate.name === name,
    );
    check(
      pkg,
      `${path.basename(tarball)} is ${name}, which isn't a publishable package.`,
    );
    packed.push({
      pkg,
      version,
      tarball,
      files: new Set(
        listing.output
          .split('\n')
          .filter(Boolean)
          .map((file) => file.replace(/^package\//, '')),
      ),
    });
  }
  const missing = PUBLISHABLE_PACKAGES.filter(
    (pkg) => !packed.some((candidate) => candidate.pkg === pkg),
  );
  check(
    missing.length === 0,
    `${dir} has no tarball for ${missing.map((pkg) => pkg.name).join(', ')}.`,
  );
  // Keep publish order, whatever order the directory listing returned.
  return PUBLISHABLE_PACKAGES.map(
    (pkg) => packed.find((candidate) => candidate.pkg === pkg)!,
  );
};

/**
 * Layer 1: checks that every packed tarball is usable, before anything is
 * installed. Fast and static, and on its own would have caught the empty
 * runtime tarball and the schematics of 22.2.1 that Node refused to load.
 */
export const checkPackages = async (
  packed: readonly PackedPackage[],
  context: RunContext,
) => {
  const failures: string[] = [];
  /**
   * Collects a failed check instead of stopping, so one run reports every
   * broken package at once.
   */
  const attempt = async (label: string, contractCheck: () => Promise<void>) => {
    try {
      await contractCheck();
    } catch (error) {
      if (!(error instanceof CheckError)) {
        throw error;
      }
      console.error(`✗ ${error.message}`);
      failures.push(`${label}: ${error.message}`);
    }
  };

  step('Layer 1: the publish list and versions');
  await attempt('publish list', async () => {
    const unlisted = findUnlistedPublicPackages();
    check(
      unlisted.length === 0,
      `These workspace packages aren't private, so npm would publish them, but they're missing from packages/release/src/packages.ts: ${unlisted.join(', ')}. Add them to PUBLISHABLE_PACKAGES so they're tested and published, or set "private": true.`,
    );
    console.log('✓ every public workspace package is in the publish list');
  });
  await attempt('versions', async () => {
    // The packages are released in lockstep: the scaffolder installs the
    // runtime at its own version, and ng add installs the plugin and testing
    // library with a range built from it.
    const versions = new Set(packed.map(({ version }) => version));
    check(
      versions.size === 1,
      `the packages don't share one version: ${packed.map(({ pkg, version }) => `${pkg.name}@${version}`).join(', ')}.`,
    );
    console.log(`✓ every package is at ${packed[0]!.version}`);
  });

  for (const packedPackage of packed) {
    step(`Layer 1: ${packedPackage.pkg.name}@${packedPackage.version}`);
    for (const contractCheck of [checkRequiredFiles, runPublint, runAttw]) {
      await attempt(packedPackage.pkg.name, () =>
        contractCheck(packedPackage, context),
      );
    }
  }

  const runtime = packed.find((p) => p.pkg.name === '@blotch/angular-lynx')!;
  step('Layer 1: every schematic loads from the packed runtime');
  await attempt(runtime.pkg.name, () => checkSchematicsLoad(runtime, context));

  check(
    failures.length === 0,
    `Package contract checks failed:\n  - ${failures.join('\n  - ')}`,
  );
};

const packPackage = async (
  pkg: PublishablePackage,
  context: RunContext,
): Promise<PackedPackage> => {
  const publishDir = path.join(REPO_ROOT, pkg.publishDir);
  check(
    existsSync(path.join(publishDir, 'package.json')),
    `${pkg.name} hasn't been built: ${pkg.publishDir}/package.json is missing. Run \`npm run build\` first.`,
  );
  // Pack from the same directory the publish workflow publishes from. For the
  // runtime that is ng-packagr's dist/, whose package.json is a copy that
  // packaging rules in the source package can silently empty.
  const { output } = await run(
    'npm',
    ['pack', '--json', '--pack-destination', context.tarballDir],
    { cwd: publishDir, logFile: context.logFile, echo: false },
  );
  // npm prints lifecycle script output before the JSON, so parse from the
  // first line that opens the JSON array.
  const json = output.slice(output.search(/^\[/m));
  const [result] = JSON.parse(json) as NpmPackResult;
  console.log(`packed ${result!.filename} (${result!.files.length} files)`);
  return {
    pkg,
    version: result!.version,
    tarball: path.join(context.tarballDir, result!.filename),
    files: new Set(result!.files.map((file) => file.path)),
  };
};

const checkRequiredFiles = async ({ pkg, files }: PackedPackage) => {
  const required = [...pkg.requiredFiles];
  if (pkg.name === '@blotch/angular-lynx') {
    required.push(...schematicFactoryFiles(pkg));
  }
  const missing = required.filter((file) => !files.has(file));
  check(
    missing.length === 0,
    `the tarball is missing ${missing.join(', ')}. Check the package's "files" field, .npmignore files, and (for the runtime) the ng-package.json assets.`,
  );
  console.log(`✓ all ${required.length} required files are in the tarball`);
};

/**
 * The compiled factory of every schematic in the runtime's collection.json,
 * and of every `ng update` migration in its migrations.json.
 */
const schematicFactoryFiles = (pkg: PublishablePackage) =>
  ['collection.json', 'migrations.json'].flatMap((file) => {
    const collection = JSON.parse(
      readFileSync(path.join(REPO_ROOT, pkg.dir, 'schematics', file), 'utf8'),
    ) as SchematicCollection;
    return Object.values(collection.schematics).map(
      ({ factory }) => `${path.posix.join('schematics', factory)}.js`,
    );
  });

const runPublint = async ({ tarball }: PackedPackage) => {
  // publint reads the tarball itself, so it judges exactly what users install.
  const buffer = readFileSync(tarball);
  const { messages, pkg } = await publint({
    pack: {
      tarball: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    },
    level: 'warning',
    strict: false,
  });
  for (const message of messages) {
    console.log(`  publint ${message.type}: ${formatMessage(message, pkg)}`);
  }
  const errors = messages.filter((message) => message.type === 'error');
  check(
    errors.length === 0,
    `publint found ${errors.length} error(s): ${errors.map((message) => formatMessage(message, pkg)).join('; ')}`,
  );
  console.log('✓ publint found no errors');
};

const runAttw = async (
  { pkg, tarball }: PackedPackage,
  context: RunContext,
) => {
  if (!pkg.hasTypes) {
    return;
  }
  // The CLI only exports its package.json, so find its bin through that.
  const attwPackageJson = createRequire(import.meta.url).resolve(
    '@arethetypeswrong/cli/package.json',
  );
  const attw = path.join(path.dirname(attwPackageJson), 'dist/index.js');
  // `esm-only`: every package that ships types is ESM-only (Angular libraries
  // must be), so CommonJS resolution failing is expected. What matters is that
  // TypeScript finds the types under both `node16` and `bundler` resolution,
  // which is what `ng new` projects and Rsbuild configs use.
  const { code, output } = await runAllowFailure(
    process.execPath,
    [attw, tarball, '--profile', 'esm-only', '--format', 'ascii'],
    { cwd: context.workDir, logFile: context.logFile, echo: false },
  );
  check(
    code === 0,
    `@arethetypeswrong/cli found type resolution problems:\n${output}`,
  );
  console.log('✓ attw: types resolve under node16 and bundler resolution');
};

/**
 * Loads every schematic from the packed runtime the way Angular CLI does. On
 * 22.2.1 the compiled CommonJS schematics sat inside a `"type": "module"`
 * package, so Node refused to load them, and `ng add` printed "does not
 * provide any `ng add` actions" and exited 0.
 */
const checkSchematicsLoad = async (
  runtime: PackedPackage,
  context: RunContext,
) => {
  // A minimal project with the packed runtime installed. The schematics
  // import @angular-devkit/schematics and @schematics/angular, which a real
  // project gets from @angular/cli; here they are linked from the monorepo.
  const host = path.join(context.workDir, 'schematics-host');
  const installDir = path.join(host, 'node_modules/@blotch/angular-lynx');
  mkdirSync(installDir, { recursive: true });
  writeFileSync(path.join(host, 'package.json'), '{ "private": true }\n');
  // A bare archive name, for GNU tar on Windows (see loadTarballs).
  await run(
    'tar',
    [
      '-xzf',
      path.basename(runtime.tarball),
      '-C',
      installDir,
      '--strip-components=1',
    ],
    {
      cwd: path.dirname(runtime.tarball),
      logFile: context.logFile,
      echo: false,
    },
  );
  for (const scope of ['@angular-devkit', '@schematics']) {
    symlinkSync(
      path.join(REPO_ROOT, 'node_modules', scope),
      path.join(host, 'node_modules', scope),
      'junction',
    );
  }

  // @angular-devkit/schematics is CommonJS; createRequire loads it the same
  // way Angular CLI does.
  const require = createRequire(import.meta.url);
  const { NodeWorkflow } = require('@angular-devkit/schematics/tools') as {
    NodeWorkflow: new (
      root: string,
      options: object,
    ) => {
      engine: {
        createCollection: (name: string) => {
          listSchematicNames: () => string[];
          createSchematic: (name: string) => {
            description: { factoryFn: unknown };
          };
        };
      };
    };
  };
  const workflow = new NodeWorkflow(host, {});
  const collection = workflow.engine.createCollection('@blotch/angular-lynx');
  const names = collection.listSchematicNames();
  check(names.includes('ng-add'), 'the collection has no `ng-add` schematic');
  const broken: string[] = [];
  for (const name of names) {
    try {
      const schematic = collection.createSchematic(name);
      if (typeof schematic.description.factoryFn !== 'function') {
        broken.push(`${name} (its factory doesn't export a function)`);
      }
    } catch (error) {
      broken.push(`${name} (${(error as Error).message.split('\n')[0]})`);
    }
  }
  check(
    broken.length === 0,
    `these schematics fail to load: ${broken.join('; ')}. Angular CLI would report that the package provides no actions for them.`,
  );
  console.log(`✓ all ${names.length} schematics load: ${names.join(', ')}`);
};
