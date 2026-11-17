/**
 * Where the data comes from: the benchmark's fixture server (benchmarks/fixtures/server.mjs),
 * never pokeapi.co, so network time stays out of "fully drawn".
 *
 * Expo's Babel preset inlines `process.env.EXPO_PUBLIC_*` when Metro bundles, so the origin is
 * fixed at build time. The default is what the iOS Simulator reaches the Mac at; a phone needs the
 * Mac's LAN address, e.g. EXPO_PUBLIC_FIXTURE_ORIGIN=http://192.168.1.231:8787.
 */
const ORIGIN = (process.env.EXPO_PUBLIC_FIXTURE_ORIGIN || 'http://localhost:8787').replace(/\/+$/, '');

export const API = `${ORIGIN}/api/v2`;
export const SPRITES = `${ORIGIN}/sprites/pokemon`;
