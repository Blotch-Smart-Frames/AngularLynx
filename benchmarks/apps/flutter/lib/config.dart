// Build-time settings (README.md, "Build-time settings"). Both are compiled
// into the app with `--dart-define`, as the other apps inline theirs when they
// bundle: Instruments launches the app with no arguments, so nothing can be
// chosen at launch.

/// The fixture server (`benchmarks/fixtures/server.mjs`). The Simulator
/// reaches the Mac at localhost; a phone build gets the Mac's LAN address.
const fixtureOrigin = String.fromEnvironment('FIXTURE_ORIGIN', defaultValue: 'http://localhost:8787');

/// A benchmark screen to open on at launch instead of the tabs, such as
/// `mount?kind=view&count=1500` (SPEC.md, "Benchmark screens"). Empty for the
/// Pokédex.
const benchScreen = String.fromEnvironment('BENCH_SCREEN');

const api = '$fixtureOrigin/api/v2';
const sprites = '$fixtureOrigin/sprites/pokemon';

/// The list loads 50 Pokémon a page, as the original's `usePokemonList`.
const pageSize = 50;
