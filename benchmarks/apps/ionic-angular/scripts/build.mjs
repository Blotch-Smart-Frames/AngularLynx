// Builds the web app for release with the benchmark's build-time settings, and copies it into the
// iOS project (`cap sync ios`), ready for Xcode:
//
//   FIXTURE_ORIGIN=http://192.168.1.231:8787 BENCH_SCREEN='mount?kind=view&count=1500' \
//     node scripts/build.mjs
//
// Both are inlined into the bundle with `ng build --define`, as Expo inlines EXPO_PUBLIC_*
// variables: Instruments launches an app with no URL, so a benchmark screen is a build of its own.
import { execFileSync } from 'node:child_process';

const define = (name) => `${name}=${JSON.stringify(process.env[name.slice(2, -2)] ?? '')}`;
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

run('npx', [
  'ng',
  'build',
  '--configuration',
  'production',
  '--define',
  define('__FIXTURE_ORIGIN__'),
  '--define',
  define('__BENCH_SCREEN__'),
]);
run('npx', ['cap', 'sync', 'ios']);
