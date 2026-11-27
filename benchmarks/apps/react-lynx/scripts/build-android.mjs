#!/usr/bin/env node
// Builds the ReactLynx app into the Android shell that
// `ng build --platform android` generates for AngularLynx apps, so the two
// Lynx apps differ only in the JavaScript bundle they load, as on iOS
// (build-ios.mjs).
//
//   node scripts/build-android.mjs                rspeedy build, then the release .apk and .aab
//   node scripts/build-android.mjs --skip-bundle  reuse dist/main.lynx.bundle
//
// Environment:
//   FIXTURE_ORIGIN  the fixture server (default http://localhost:8787), read by lynx.config.ts
//   BENCH_SCREEN    a benchmark screen to open on instead of the tabs, e.g. mount?kind=view&count=1500
//   APP_ID          the application ID (default com.angularlynx.bench.reactlynx)
//   APP_NAME        the name under the icon (default LaunchPerfReactLynx)
//
// How: this calls @blotch/angular-lynx-native's buildNativeApp(), the
// function the AngularLynx builder calls, on the project it generates from
// its template. Unlike build-ios.mjs it needn't render and eject the project
// first: the iOS script does that only to add NSLocalNetworkUsageDescription,
// and Android has no such key. The release shell already lets plain HTTP
// reach localhost (its network_security_config.xml), and the emulator, or a
// phone over USB, reaches the fixture server on the Mac at localhost through
// `adb reverse tcp:8787 tcp:8787`, which the harness sets up.
//
// The release .apk is signed with the debug key, as an AngularLynx app's is
// without android.signing: installable on an emulator or a phone, which is
// all the benchmark needs.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildNativeApp } from '@blotch/angular-lynx-native';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(APP_DIR, 'build');
// buildNativeApp's "project root": it would build an ejected project in
// android/ here as it is. There's none, so it generates the project from its
// template into workDir, as it does for an AngularLynx app.
const PROJECT_ROOT = path.join(BUILD_DIR, 'native');
const BUNDLE_DIR = path.join(APP_DIR, 'dist');

// What the AngularLynx build plugin writes beside the bundle
// (@blotch/angular-lynx-native's NATIVE_FEATURES_FILE): which of the shell's
// optional native code the app uses. rspeedy with ReactLynx's plugin writes
// no such file, and without one the builder keeps everything, so the
// ReactLynx shell would carry the canvas, WebGL and video frame code that
// the AngularLynx benchmark app's shell leaves out (it draws on no canvas,
// issue #837). Neither app draws on a canvas, so this says so, and both
// shells are built from the same code.
const NATIVE_FEATURES_FILE = '.angular-lynx-native.json';

const flags = new Set(process.argv.slice(2));

// The options an AngularLynx app sets in angular.json. Everything else (the
// thread strategy, the modules, the splash, R8, the ABIs) is the template's.
const app = {
  appName: process.env.APP_NAME ?? 'LaunchPerfReactLynx',
  appId: process.env.APP_ID ?? 'com.angularlynx.bench.reactlynx',
  version: '1.0.0',
};
// buildNativeApp empties its output folder first, so each app ID (the
// Pokédex and each BENCH_SCREEN variant) gets its own.
const OUTPUT_DIR = path.join(BUILD_DIR, 'android', app.appId);

if (!flags.has('--skip-bundle')) {
  execFileSync('npx', ['rspeedy', 'build'], { cwd: APP_DIR, stdio: 'inherit' });
}
writeFileSync(
  path.join(BUNDLE_DIR, NATIVE_FEATURES_FILE),
  `${JSON.stringify({ canvas: false, webgl: false })}\n`,
);

const { artifacts } = await buildNativeApp({
  platform: 'android',
  projectRoot: PROJECT_ROOT,
  // The generated project goes in build/work/android and the log in
  // build/work/logs/android.log, beside build-ios.mjs's iOS ones.
  workDir: path.join(BUILD_DIR, 'work'),
  projectName: 'react-lynx',
  packageVersion: app.version,
  bundleDir: BUNDLE_DIR,
  outputDir: OUTPUT_DIR,
  app,
  log: (message) => console.log(message),
});
for (const artifact of artifacts) console.log(`Built ${artifact}`);
