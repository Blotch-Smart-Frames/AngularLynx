import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { androidGenerator } from './android/project.ts';
import { EJECT_MARKER, type Platform, TEMPLATES_DIR } from './generate.ts';
import { iosGenerator } from './ios/project.ts';
import { type NativeAppOptions, resolveAppOptions } from './options.ts';

/**
 * What an ejected project ignores. Written here because npm never packs
 * `.gitignore` files, so the templates can't carry their own.
 */
const GITIGNORE: Record<Platform, string> = {
  ios: [
    '# Copied from dist/ on every `ng build --platform ios`.',
    'LynxBundle/*',
    '!LynxBundle/.gitkeep',
    '# A link to the cached Lynx XCFrameworks, made on every build.',
    'Frameworks',
    'xcuserdata/',
    '*.xcuserstate',
    '',
  ].join('\n'),
  android: [
    '# Copied from dist/ on every `ng build --platform android`.',
    'app/src/main/assets/*',
    '!app/src/main/assets/.gitkeep',
    '.gradle/',
    'build/',
    'app/build/',
    'local.properties',
    '.idea/',
    '*.iml',
    '',
  ].join('\n'),
};

/**
 * Renders the native project a user takes ownership of with
 * `ng generate @blotch/angular-lynx:eject`: the same project the builder
 * generates, plus the marker that tells the builder to build it as it is.
 * Returns its files (relative path → contents), for the schematic to write.
 */
export const renderEjectedProject = ({
  platform,
  projectRoot,
  projectName,
  packageVersion,
  app,
  generatorVersion,
}: {
  readonly platform: Platform;
  readonly projectRoot: string;
  readonly projectName: string;
  readonly packageVersion?: string;
  readonly app: NativeAppOptions;
  /** This package's version, recorded in the marker for later upgrades. */
  readonly generatorVersion: string;
}): Map<string, Buffer> => {
  const resolved = resolveAppOptions(app, { projectName, packageVersion });
  const dir = mkdtempSync(path.join(os.tmpdir(), `angular-lynx-eject-`));
  try {
    cpSync(path.join(TEMPLATES_DIR, platform), dir, { recursive: true });
    (platform === 'ios' ? iosGenerator : androidGenerator).configure(
      dir,
      resolved,
      projectRoot,
    );
    writeFileSync(path.join(dir, '.gitignore'), GITIGNORE[platform]);
    writeFileSync(
      path.join(dir, EJECT_MARKER),
      [
        `Ejected from @blotch/angular-lynx-native ${generatorVersion}.`,
        '',
        `\`ng build --platform ${platform}\` builds this folder as it is and never`,
        'regenerates it, so changes here are yours to keep. App options in',
        'angular.json no longer apply to it, and Lynx, Xcode and Google Play',
        'upgrades are now made here by hand. Delete this folder (and this file',
        'with it) to go back to the generated project.',
        '',
      ].join('\n'),
    );
    return new Map(
      listFiles(dir).map((file) => [file, readFileSync(path.join(dir, file))]),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const listFiles = (dir: string, prefix = ''): string[] =>
  readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = path.posix.join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(dir, relative) : [relative];
    },
  );
