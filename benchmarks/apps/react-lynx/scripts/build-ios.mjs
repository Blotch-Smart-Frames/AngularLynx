#!/usr/bin/env node
// Builds the ReactLynx app into the iOS shell that `ng build --platform ios`
// generates for AngularLynx apps, so the two Lynx apps differ only in the
// JavaScript bundle they load.
//
//   node scripts/build-ios.mjs                 rspeedy build, then the Release simulator app
//   node scripts/build-ios.mjs --skip-bundle   reuse dist/main.lynx.bundle
//   node scripts/build-ios.mjs --project-only  render the Xcode project and copy the bundle in, no xcodebuild
//
// Environment:
//   FIXTURE_ORIGIN  the fixture server (default http://localhost:8787), read by lynx.config.ts
//   BENCH_SCREEN    a benchmark screen to open on instead of the tabs, e.g. mount?kind=view&count=1500
//   APP_ID          the bundle ID (default com.angularlynx.bench.reactlynx)
//   APP_NAME        the name under the icon (default LaunchPerfReactLynx)
//   TEAM_ID         the Apple team, written into the project as DEVELOPMENT_TEAM for a phone build
//
// How: @blotch/angular-lynx-native's buildNativeApp() is what the AngularLynx
// builder calls. It builds a project it generates from its template, or a
// project the app has ejected (a folder with the eject marker, built as it
// is). The release template leaves out NSLocalNetworkUsageDescription, which
// a phone needs to reach the fixture server on the Mac (SPEC.md, "Data"), and
// buildNativeApp generates and builds in one call, with no step between. So
// this renders the same project with renderEjectedProject() (the generator
// the builder uses, on every build, so it follows the template), adds that
// one Info.plist key, and hands the folder to buildNativeApp as an ejected
// project, which copies dist/ in and runs xcodebuild exactly as for an
// AngularLynx app.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EJECT_MARKER,
  PACKAGE_VERSION,
  buildNativeApp,
  copyBundle,
  renderEjectedProject,
} from '@blotch/angular-lynx-native';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(APP_DIR, 'build');
// buildNativeApp's "project root": it looks for the ejected project in ios/.
const PROJECT_ROOT = path.join(BUILD_DIR, 'native');
const IOS_DIR = path.join(PROJECT_ROOT, 'ios');
const BUNDLE_DIR = path.join(APP_DIR, 'dist');

const flags = new Set(process.argv.slice(2));

// The options an AngularLynx app sets in angular.json. Everything else (the
// thread strategy, the modules, the splash, 120 fps) is the template's.
const app = {
  appName: process.env.APP_NAME ?? 'LaunchPerfReactLynx',
  appId: process.env.APP_ID ?? 'com.angularlynx.bench.reactlynx',
  version: '1.0.0',
  ...(process.env.TEAM_ID && { ios: { teamId: process.env.TEAM_ID } }),
};
// buildNativeApp empties its output folder first, so each app ID (the
// Pokédex and each BENCH_SCREEN variant) gets its own.
const OUTPUT_DIR = path.join(BUILD_DIR, 'ios', app.appId);

// The original's reason (apps/react-native/app.json).
const LOCAL_NETWORK_REASON = 'Loads the benchmark data from the fixture server on your Mac.';

if (!flags.has('--skip-bundle')) {
  execFileSync('npx', ['rspeedy', 'build'], { cwd: APP_DIR, stdio: 'inherit' });
}

renderProject();

if (flags.has('--project-only')) {
  copyBundle(BUNDLE_DIR, path.join(IOS_DIR, 'LynxBundle'));
  // buildNativeApp links the project's Frameworks to the cached Lynx
  // XCFrameworks (downloading them the first time); without a build, there's
  // no link for xcodebuild to find them by.
  if (!existsSync(path.join(IOS_DIR, 'Frameworks'))) {
    console.warn('No Frameworks link yet: run `npm run build:ios` once first, which downloads and links the Lynx frameworks.');
  }
  console.log(`Project: ${IOS_DIR}`);
  process.exit(0);
}

const { artifacts } = await buildNativeApp({
  platform: 'ios',
  projectRoot: PROJECT_ROOT,
  workDir: path.join(BUILD_DIR, 'work'),
  projectName: 'react-lynx',
  packageVersion: app.version,
  bundleDir: BUNDLE_DIR,
  outputDir: OUTPUT_DIR,
  app,
  log: (message) => console.log(message),
});
for (const artifact of artifacts) console.log(`Built ${artifact}`);

/**
 * Writes the generated project into build/native/ios, with the eject marker
 * and NSLocalNetworkUsageDescription. Only files whose contents changed are
 * written, so Xcode's incremental build state survives a rebuild; files the
 * template no longer has are removed.
 */
function renderProject() {
  const files = renderEjectedProject({
    platform: 'ios',
    projectRoot: PROJECT_ROOT,
    projectName: 'react-lynx',
    packageVersion: app.version,
    app,
    generatorVersion: PACKAGE_VERSION,
  });
  const plistPath = 'App/Info.plist';
  const plist = files.get(plistPath).toString('utf8');
  if (!plist.includes('NSLocalNetworkUsageDescription')) {
    files.set(
      plistPath,
      Buffer.from(
        plist.replace(
          '<!-- /angular-lynx:info -->',
          `<key>NSLocalNetworkUsageDescription</key>\n<string>${LOCAL_NETWORK_REASON}</string>\n<!-- /angular-lynx:info -->`,
        ),
      ),
    );
  }
  if (!files.has(EJECT_MARKER)) throw new Error('renderEjectedProject() wrote no eject marker');

  // Left alone: the bundle (copied in by buildNativeApp) and the link to the
  // Lynx frameworks it makes.
  const keep = (relative) => relative.startsWith('LynxBundle/') || relative === 'Frameworks';
  for (const relative of listFiles(IOS_DIR)) {
    if (!files.has(relative) && !keep(relative)) rmSync(path.join(IOS_DIR, relative), { force: true });
  }
  for (const [relative, contents] of files) {
    const target = path.join(IOS_DIR, relative);
    if (existsSync(target) && readFileSync(target).equals(contents)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

function listFiles(dir, prefix = '') {
  const absolute = path.join(dir, prefix);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const relative = path.posix.join(prefix, name);
    const full = path.join(dir, relative);
    // Frameworks is a symlink to the cached XCFrameworks: don't walk it.
    if (relative === 'Frameworks') return [relative];
    return statSync(full).isDirectory() ? listFiles(dir, relative) : [relative];
  });
}
