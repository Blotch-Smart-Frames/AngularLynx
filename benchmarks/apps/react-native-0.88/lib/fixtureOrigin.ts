// The benchmark serves recorded PokeAPI responses and sprites from a local
// fixture server (benchmarks/fixtures/server.mjs), so network time stays out
// of "fully drawn". Expo inlines EXPO_PUBLIC_* variables when it bundles, so
// the origin is fixed at build time: localhost reaches the Mac from the iOS
// Simulator, and a phone build passes the Mac's LAN address instead.
export const FIXTURE_ORIGIN = process.env.EXPO_PUBLIC_FIXTURE_ORIGIN ?? 'http://localhost:8787';
