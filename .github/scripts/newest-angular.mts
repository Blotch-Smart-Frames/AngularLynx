// Finds the newest release of every Angular package the monorepo installs, on
// the Angular major package-lock.json is on, and optionally moves the monorepo
// onto them.
//
// Usage:
//   node .github/scripts/newest-angular.mts            print them
//   node .github/scripts/newest-angular.mts --install  move the monorepo onto them
//
// Under GitHub Actions it also writes these step outputs:
//   core     the newest @angular/core (Angular)
//   cli      the newest @angular/build (Angular CLI)
//   release  both, as "Angular 22.2.6 and Angular CLI 22.2.6"
//
// Why: the monorepo builds and tests against package-lock.json's Angular, but
// an app made with `npm create angular-lynx` installs the newest Angular its
// ranges allow (^22.2.0), the day it's published. Angular 22.2.6 broke every
// such app (#384) while CI stayed green on the lockfile's 22.2.4.
// angular-release.yml watches for a new Angular or Angular CLI release, and
// angular-release-builds.yml runs ci.yml with --install and the E2E tests
// against it.
//
// Only the lockfile's major: create-angular-lynx runs the Angular CLI of
// AngularLynx's own major, and the published peer ranges stop at it, so an
// app never gets the next major until the update-angular skill moves the
// repository there.
//
// Angular and Angular CLI are released separately, with their own patch
// numbers (Angular CLI 22.2.6 came out eight days before Angular 22.2.6), and
// either can break the build: the rsbuild plugin imports and patches
// @angular/build's internals. So core and cli are each one's newest.
//
// --install pins every Angular package to its newest release as an override
// in the root package.json, then updates package-lock.json to match (without
// installing), so `npm ci` installs them. Overrides, rather than `npm update`:
// npm update leaves the workspaces' dependencies alone when run from the root,
// and Angular's framework packages peer one another at exact versions, so
// they can only move together.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const REGISTRY = 'https://registry.npmjs.org';

type Lockfile = {
  packages: Record<string, { version?: string }>;
};

const lockfile = (): Lockfile =>
  JSON.parse(readFileSync('package-lock.json', 'utf8')) as Lockfile;

/**
 * The version of every Angular package the lockfile installs: Angular's and
 * Angular CLI's @angular/* packages, @angular-devkit/* and @schematics/angular.
 * Wherever npm put it, since a workspace could need a copy of its own.
 */
const installed = (lock: Lockfile): Map<string, string> => {
  const versions = new Map<string, string>();
  for (const [path, { version }] of Object.entries(lock.packages)) {
    const name =
      /(?:^|\/)node_modules\/((?:@angular|@angular-devkit)\/[^/]+|@schematics\/angular)$/.exec(
        path,
      )?.[1];
    // The hoisted copy's version wins. The keys are sorted, so a copy under
    // examples/ comes before it.
    if (
      name &&
      version &&
      (!versions.has(name) || path === `node_modules/${name}`)
    ) {
      versions.set(name, version);
    }
  }
  return versions;
};

type Version = [number, number, number];

/**
 * A stable version as numbers, or undefined for a prerelease.
 */
const parse = (version: string): Version | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : undefined;
};

/**
 * Whether version a comes after version b.
 */
const isNewer = (a: Version, b: Version): boolean => {
  const diff = a.map((part, i) => part - b[i]!).find((d) => d !== 0) ?? 0;
  return diff > 0;
};

/**
 * The Angular major a version belongs to. @angular-devkit/architect and
 * build-webpack are versioned 0.MMmm.p: 0.2202.6 is Angular CLI 22.2.6.
 */
const angularMajor = ([major, minor]: Version): number =>
  major === 0 ? Math.floor(minor / 100) : major;

/**
 * The package's newest stable release on the Angular major, from the
 * registry's abbreviated document: every version, without each one's metadata.
 */
const newestOnMajor = async (name: string, major: number): Promise<string> => {
  const response = await fetch(`${REGISTRY}/${name}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (!response.ok) {
    throw new Error(`${name}: the registry answered ${response.status}`);
  }
  const { versions } = (await response.json()) as {
    versions: Record<string, unknown>;
  };
  let newest: Version | undefined;
  for (const version of Object.keys(versions)) {
    const parsed = parse(version);
    if (
      parsed &&
      angularMajor(parsed) === major &&
      (!newest || isNewer(parsed, newest))
    ) {
      newest = parsed;
    }
  }
  if (!newest) {
    throw new Error(`${name} has no stable release on Angular ${major}.`);
  }
  return newest.join('.');
};

const current = installed(lockfile());
const core = current.get('@angular/core');
const parsedCore = core && parse(core);
if (!parsedCore) {
  throw new Error(`package-lock.json has no stable @angular/core (${core}).`);
}
const major = angularMajor(parsedCore);

const newest = new Map(
  await Promise.all(
    [...current.keys()]
      .sort()
      .map(async (name) => [name, await newestOnMajor(name, major)] as const),
  ),
);

const rows = [...newest].map(([name, version]) => {
  const from = current.get(name);
  return `| ${name} | ${from} | ${version === from ? 'same' : version} |`;
});
const table = [
  '| Package | package-lock.json | Newest |',
  '| --- | --- | --- |',
  ...rows,
].join('\n');
console.log(table);

const coreNewest = newest.get('@angular/core')!;
const cliNewest = newest.get('@angular/build');
if (!cliNewest) {
  throw new Error('package-lock.json has no @angular/build.');
}
const release = `Angular ${coreNewest} and Angular CLI ${cliNewest}`;
console.log(`\n${release}`);

if (process.env['GITHUB_OUTPUT']) {
  appendFileSync(
    process.env['GITHUB_OUTPUT'],
    `core=${coreNewest}\ncli=${cliNewest}\nrelease=${release}\n`,
  );
}
if (process.env['GITHUB_STEP_SUMMARY']) {
  appendFileSync(
    process.env['GITHUB_STEP_SUMMARY'],
    `### ${release}\n\n${table}\n\n`,
  );
}

if (process.argv.includes('--install')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  pkg['overrides'] = { ...pkg['overrides'], ...Object.fromEntries(newest) };
  // npm refuses an override that differs from the root's own dependency on
  // the same package (EOVERRIDE). The root has none today; this keeps one
  // added later from breaking the run.
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      const version = newest.get(name);
      if (version) {
        pkg[field]![name] = version;
      }
    }
  }
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  execFileSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { stdio: 'inherit' },
  );

  // What npm resolved, rather than what was asked for: if a peer range kept a
  // package back, the builds would otherwise pass on the old version.
  const moved = installed(lockfile());
  const missed = [...newest].filter(
    ([name, version]) => moved.get(name) !== version,
  );
  if (missed.length > 0) {
    throw new Error(
      `npm didn't install the newest Angular: ${missed
        .map(
          ([name, version]) => `${name} is ${moved.get(name)}, not ${version}`,
        )
        .join('; ')}.`,
    );
  }
  console.log('\npackage-lock.json now has them: run npm ci to install them.');
}
