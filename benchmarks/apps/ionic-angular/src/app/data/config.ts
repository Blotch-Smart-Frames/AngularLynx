/**
 * Where the data comes from: the benchmark's fixture server (benchmarks/fixtures/server.mjs),
 * never pokeapi.co, so network time stays out of "fully drawn".
 *
 * scripts/build.mjs defines `__FIXTURE_ORIGIN__` from the FIXTURE_ORIGIN environment variable, so
 * the origin is fixed at build time. The default is what the iOS Simulator reaches the Mac at; a
 * phone needs the Mac's LAN address, e.g. FIXTURE_ORIGIN=http://192.168.1.231:8787.
 */
const ORIGIN = (
  (typeof __FIXTURE_ORIGIN__ === 'string' && __FIXTURE_ORIGIN__) ||
  'http://localhost:8787'
).replace(/\/+$/, '');

export const API = `${ORIGIN}/api/v2`;
export const SPRITES = `${ORIGIN}/sprites/pokemon`;

/**
 * A screen of bench/ to launch straight into, such as `mount?kind=view&count=1500` (BENCH_SCREEN).
 * Instruments launches an app with no URL, so the benchmark's mount runs are a build of their own.
 */
export const BENCH_SCREEN = ((typeof __BENCH_SCREEN__ === 'string' && __BENCH_SCREEN__) || '').replace(
  /^\/+/,
  '',
);
