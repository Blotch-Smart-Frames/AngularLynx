import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { LYNX_IOS_FRAMEWORKS } from '../src/ios/frameworks.ts';
import {
  type IosProjectFiles,
  type IosProjectSpec,
  renderIosProject,
} from './ios-project.ts';

/**
 * Writes the iOS template's App.xcodeproj, or the frameworks build's
 * throwaway host project:
 *
 *   node scripts/generate-ios-project.ts           # templates/ios/App.xcodeproj
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
  frameworks: [...LYNX_IOS_FRAMEWORKS],
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

export const TEMPLATE_PROJECT_DIR = path.join(
  import.meta.dirname,
  '../templates/ios/App.xcodeproj',
);

/** Replaces an .xcodeproj folder with freshly rendered files. */
export const writeIosProject = (dir: string, files: IosProjectFiles) => {
  rmSync(dir, { recursive: true, force: true });
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), contents);
  }
};

if (import.meta.main) {
  const { values } = parseArgs({ options: { host: { type: 'string' } } });
  const [spec, dir] = values.host
    ? [HOST_PROJECT, path.join(path.resolve(values.host), 'Host.xcodeproj')]
    : [APP_PROJECT, TEMPLATE_PROJECT_DIR];
  writeIosProject(dir, renderIosProject(spec));
  console.log(`Wrote ${dir}`);
}
