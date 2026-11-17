// A benchmark variant opens straight on one of its screens. Instruments
// launches the app with no URL, so the harness can't deep-link there; instead
// EXPO_PUBLIC_BENCH_SCREEN (e.g. "mount?kind=view&count=1500") is inlined at
// build time and swaps the launch path. expo-router calls this with the root
// URL on a plain launch too, and resolves the result before it renders
// anything, so the tabs (and the list's fetch) never mount in that build.
const BENCH_SCREEN = process.env.EXPO_PUBLIC_BENCH_SCREEN;

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (initial && BENCH_SCREEN) {
    return `/bench/${BENCH_SCREEN}`;
  }
  return path;
}
