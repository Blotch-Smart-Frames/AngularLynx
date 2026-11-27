/**
 * Where the data comes from: the benchmark's fixture server (benchmarks/fixtures/server.mjs),
 * never pokeapi.co, so network time stays out of "fully drawn".
 *
 * webpack.config.js defines `__FIXTURE_ORIGIN__` from the FIXTURE_ORIGIN environment variable when
 * it bundles, so the origin is fixed at build time. The default is what the iOS Simulator reaches
 * the Mac at; a phone needs the Mac's LAN address, e.g. FIXTURE_ORIGIN=http://192.168.1.231:8787.
 */
const ORIGIN = (__FIXTURE_ORIGIN__ || 'http://localhost:8787').replace(/\/+$/, '');

export const API = `${ORIGIN}/api/v2`;
export const SPRITES = `${ORIGIN}/sprites/pokemon`;
