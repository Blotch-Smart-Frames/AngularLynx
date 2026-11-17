// The benchmark serves recorded PokeAPI responses and sprites from a local
// fixture server (benchmarks/fixtures/server.mjs), so network time stays out
// of "fully drawn". Its origin is fixed when the app is built (see
// lynx.config.mts): localhost reaches the Mac from the iOS Simulator, and a
// phone build passes the Mac's LAN address.
export const API = `${FIXTURE_ORIGIN}/api/v2`;
export const SPRITE_BASE = `${FIXTURE_ORIGIN}/sprites/pokemon`;

/** How many Pokémon a page of the list holds, as in the original. */
export const PAGE_SIZE = 50;
