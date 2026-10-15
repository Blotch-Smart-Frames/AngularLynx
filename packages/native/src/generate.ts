import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ResolvedApp } from './options.ts';

export type Platform = 'ios' | 'android';

/** The shell templates shipped in this package. */
export const TEMPLATES_DIR = fileURLToPath(
  new URL('../templates/', import.meta.url),
);

/**
 * Written into `ios/` or `android/` by eject. Its presence tells the builder
 * the folder belongs to the user now: build it as it is, never regenerate it.
 * A marker rather than the folder's mere existence, so an unrelated `ios/`
 * folder isn't mistaken for an ejected project.
 */
export const EJECT_MARKER = '.angular-lynx-ejected';

const HASH_FILE = '.angular-lynx-hash';

export type PlatformGenerator = {
  /** Writes the config into a fresh copy of the template. */
  readonly configure: (
    dir: string,
    app: ResolvedApp,
    projectRoot: string,
  ) => void;
  /** Where the Lynx bundle and its assets go inside the native project. */
  readonly bundleDir: (dir: string) => string;
};

export type PreparedProject = {
  /** The native project to build. */
  readonly dir: string;
  /** True when the project is the user's ejected `ios/` or `android/`. */
  readonly ejected: boolean;
  /** False when the cached project matched the inputs and was reused. */
  readonly regenerated: boolean;
};

/**
 * Makes the native project for a platform ready to build: the generated one in
 * `.angular-lynx/native/<platform>`, or the user's ejected folder.
 *
 * Generation is skipped when a hash of every input (this package's version,
 * the template files, the app options and the icon) matches the last run, so
 * Xcode and Gradle keep their incremental state between builds. The bundle is
 * copied in on every build, because it changes on every build.
 */
export const prepareProject = ({
  platform,
  generator,
  projectRoot,
  app,
  bundleDir,
  packageVersion,
}: {
  readonly platform: Platform;
  readonly generator: PlatformGenerator;
  readonly projectRoot: string;
  readonly app: ResolvedApp;
  /** The rspeedy output folder (dist/). */
  readonly bundleDir: string;
  readonly packageVersion: string;
}): PreparedProject => {
  const ejectedDir = path.join(projectRoot, platform);
  if (existsSync(path.join(ejectedDir, EJECT_MARKER))) {
    copyBundle(bundleDir, generator.bundleDir(ejectedDir));
    return { dir: ejectedDir, ejected: true, regenerated: false };
  }

  const nativeRoot = path.join(projectRoot, '.angular-lynx');
  const dir = path.join(nativeRoot, 'native', platform);
  const hash = inputHash({ platform, app, projectRoot, packageVersion });
  const hashFile = path.join(dir, HASH_FILE);
  const upToDate =
    existsSync(hashFile) && readFileSync(hashFile, 'utf8') === hash;

  if (!upToDate) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(path.join(TEMPLATES_DIR, platform), dir, { recursive: true });
    generator.configure(dir, app, projectRoot);
    writeFileSync(hashFile, hash);
  }
  // Generated projects are build output: keep them out of the user's git
  // without asking them to edit .gitignore.
  writeFileSync(path.join(nativeRoot, '.gitignore'), '*\n');

  copyBundle(bundleDir, generator.bundleDir(dir));
  return { dir, ejected: false, regenerated: !upToDate };
};

/**
 * Copies the native bundle and everything it references into the project,
 * replacing the previous build's copy so deleted lazy bundles don't linger.
 * Skips what rspeedy and this builder put in dist/ for other targets: the web
 * bundle and the platform output folders.
 */
export const copyBundle = (from: string, to: string): void => {
  if (!existsSync(path.join(from, 'main.lynx.bundle'))) {
    throw new Error(
      `${from} has no main.lynx.bundle. The Lynx environment of lynx.config.ts must build to this folder.`,
    );
  }
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (
      entry.name === 'ios' ||
      entry.name === 'android' ||
      entry.name.startsWith('.') ||
      entry.name.endsWith('.web.bundle')
    ) {
      continue;
    }
    cpSync(path.join(from, entry.name), path.join(to, entry.name), {
      recursive: true,
    });
  }
};

const inputHash = ({
  platform,
  app,
  projectRoot,
  packageVersion,
}: {
  readonly platform: Platform;
  readonly app: ResolvedApp;
  readonly projectRoot: string;
  readonly packageVersion: string;
}): string => {
  const hash = createHash('sha256');
  hash.update(`${packageVersion}\n${platform}\n${JSON.stringify(app)}\n`);
  for (const file of listFiles(path.join(TEMPLATES_DIR, platform))) {
    hash.update(file.relative);
    hash.update(readFileSync(file.absolute));
  }
  if (app.icon) {
    const icon = path.resolve(projectRoot, app.icon);
    hash.update(existsSync(icon) ? readFileSync(icon) : 'missing icon');
  }
  return hash.digest('hex');
};

/**
 * Every file under `dir`, sorted, so the hash doesn't depend on fs order.
 */
const listFiles = (
  dir: string,
  prefix = '',
): { relative: string; absolute: string }[] =>
  readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      const absolute = path.join(dir, entry.name);
      return entry.isDirectory()
        ? listFiles(absolute, relative)
        : [{ relative, absolute }];
    });
