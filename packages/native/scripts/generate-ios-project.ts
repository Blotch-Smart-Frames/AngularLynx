import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import type { Plugin } from 'vitest/config';

import { ANGLE_IOS_HEADERS, IOS_FRAMEWORKS } from '../src/ios/frameworks.ts';
import {
  type IosProjectFiles,
  type IosProjectSpec,
  renderIosProject,
} from './ios-project.ts';

/**
 * Writes the iOS template's App.xcodeproj (the iosTemplateProject Vite
 * plugin), or the frameworks build's throwaway host project:
 *
 *   node scripts/generate-ios-project.ts --host <dir>  # <dir>/Host.xcodeproj
 *
 * App.xcodeproj isn't in git: `npm run build` renders it from APP_PROJECT
 * below, and the npm package ships the result. Change the project here; an
 * edit made in Xcode is overwritten by the next build.
 */

/** The app every `ng build --platform ios` builds. */
export const APP_PROJECT: IosProjectSpec = {
  name: 'App',
  // Xcode compiles every Swift file in App/ and copies its asset catalog, so
  // adding a file to the template never changes the project. Info.plist is
  // the target's settings file, not a resource to copy into the app.
  sources: { synced: 'App', excluded: ['Info.plist'] },
  // dist/ goes here; its static/ layout must survive into the app, where the
  // shell resolves `/static/...` URLs against it.
  folderResources: ['LynxBundle'],
  // Prebuilt by scripts/build-lynx-ios-frameworks.sh. `Frameworks` is a
  // symlink to the download cache that the builder makes before each build.
  frameworks: [...IOS_FRAMEWORKS],
  // Identity (bundle ID, version, team) comes from here, which the generator
  // rewrites from angular.json on every build.
  xcconfig: 'Config/App.xcconfig',
  deploymentTarget: '15.0',
  settings: {
    PRODUCT_NAME: '$(ANGULAR_LYNX_PRODUCT_NAME)',
    INFOPLIST_FILE: 'App/Info.plist',
    GENERATE_INFOPLIST_FILE: 'NO',
    ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
    CODE_SIGN_STYLE: 'Automatic',
    // iPhone only. An iPad app must support every orientation (or opt out of
    // multitasking), which a portrait-only app would fail App Store
    // validation for.
    TARGETED_DEVICE_FAMILY: '1',
    LD_RUNPATH_SEARCH_PATHS: ['$(inherited)', '@executable_path/Frameworks'],
    // ANGLE's EGL and OpenGL ES headers, for the WebGL context: its
    // frameworks don't have them.
    HEADER_SEARCH_PATHS: [
      '$(inherited)',
      `$(PROJECT_DIR)/Frameworks/${ANGLE_IOS_HEADERS}`,
    ],
  },
};

/**
 * The empty app CocoaPods installs Lynx's pods into, so the frameworks build
 * can compile them. Never shipped. Its files are listed rather than synced
 * so the project uses nothing CocoaPods' project parser might not know.
 */
export const HOST_PROJECT: IosProjectSpec = {
  name: 'Host',
  sources: { folder: 'Host', files: ['main.swift'] },
  deploymentTarget: '15.0',
  settings: {
    PRODUCT_NAME: '$(TARGET_NAME)',
    PRODUCT_BUNDLE_IDENTIFIER: 'dev.angularlynx.frameworkhost',
    GENERATE_INFOPLIST_FILE: 'YES',
    CODE_SIGNING_ALLOWED: 'NO',
  },
};

const TEMPLATE_PROJECT_DIR = path.join(
  import.meta.dirname,
  '../templates/ios/App.xcodeproj',
);

/**
 * Brings an .xcodeproj folder in line with freshly rendered files, without
 * ever removing it first.
 *
 * The template project is rendered again whenever Vite resolves the package's
 * config, and that happens while other processes copy it: CI's turbo run
 * builds this package (`vite build`, for packages/build's tests) beside its
 * own tests, whose generator and eject tests cpSync the template. Deleting
 * the folder and writing it back left a moment with no project, and a copy
 * caught there failed with ENOENT (#963). So a file whose contents already
 * match is left alone, a changed one is written beside itself and renamed
 * over the old (a reader sees one or the other, never a half-written file),
 * and only files the render no longer has are removed.
 */
export const writeIosProject = (dir: string, files: IosProjectFiles) => {
  const rendered = new Set(
    Object.keys(files).map((file) => path.join(dir, file)),
  );
  if (existsSync(dir)) {
    removeStale(dir, rendered);
  }
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(dir, file);
    if (existsSync(target) && readFileSync(target, 'utf8') === contents) {
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    // The pid keeps two processes rendering at once off each other's
    // temporary file.
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, contents);
    renameSync(temporary, target);
  }
};

/** Matches the temporary file writeIosProject renames into place. */
const TEMPORARY_FILE = /\.\d+\.tmp$/;

/**
 * Removes what's under `folder` that isn't one of the rendered files (such as
 * the xcuserdata Xcode adds when the template is opened), and each folder
 * that leaves empty. It keeps another render's temporary files, and a folder
 * that was already empty, which may be one another render has just made and
 * is about to write into. Returns whether it removed anything.
 */
const removeStale = (
  folder: string,
  rendered: ReadonlySet<string>,
): boolean => {
  let removed = false;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (
        removeStale(entryPath, rendered) &&
        readdirSync(entryPath).length === 0
      ) {
        rmdirSync(entryPath);
        removed = true;
      }
    } else if (!rendered.has(entryPath) && !TEMPORARY_FILE.test(entry.name)) {
      rmSync(entryPath, { force: true });
      removed = true;
    }
  }
  return removed;
};

/**
 * Renders templates/ios/App.xcodeproj. It runs in configResolved, the one
 * hook both of its callers reach (Vitest never calls buildStart):
 *
 * - `vite build`, the last step of `npm run build`, so the npm package ships
 *   the project;
 * - Vitest, because the generator and eject tests copy the real template, and
 *   a fresh clone's `npm test` would otherwise test one without its project.
 */
export const iosTemplateProject = (): Plugin => ({
  name: 'ios-template-project',
  configResolved() {
    writeIosProject(TEMPLATE_PROJECT_DIR, renderIosProject(APP_PROJECT));
  },
});

if (import.meta.main) {
  const { values } = parseArgs({ options: { host: { type: 'string' } } });
  if (!values.host) {
    throw new Error('Usage: node scripts/generate-ios-project.ts --host <dir>');
  }
  const dir = path.join(path.resolve(values.host), 'Host.xcodeproj');
  writeIosProject(dir, renderIosProject(HOST_PROJECT));
  console.log(`Wrote ${dir}`);
}
