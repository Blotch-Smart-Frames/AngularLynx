# What every benchmark app does

Every app in `benchmarks/apps/` is the same app: Software Mansion's
[`launchperf-poke-rn`](https://github.com/software-mansion-labs/launchperf-poke-rn)
(MIT), ported screen for screen. `apps/react-native` is their app with only the
API's base URL changed, plus one change iOS 27 forces (it ends an app built
with Xcode 27 that doesn't adopt the scene life cycle, which Expo 54's template
doesn't); the others copy it. When in doubt about a pixel, a
size, a color or a behavior, do what `apps/react-native` does.

## Screens

- **Tabs**: "Pokédex" (home) and "Favourites", with outline/solid home and
  heart icons (the SVGs in `apps/react-native/assets/icons`), black active and
  `#424242` inactive tint, 12px labels.
- **Pokédex**: a header text "Pokédex" (16px bold, 8px below), then a
  virtualized list of rows, 16px padding around the list, `#F7F7F7` background
  under a white safe-area top. It loads pages of 50 from
  `GET {API}/pokemon?limit=50&offset={(page-1)*50}` and loads the next page
  when the end comes within half a screen. A spinner while the first page
  loads; a footer spinner while the next one does.
- **Row** (`PokemonItem`): white card, 1px `#E3E3E3` border, radius 4, padding
  16, 8px apart. A 64×64 bordered box (radius 8) holding the 56×56 sprite
  (`{SPRITES}/{id}.png`, with `pokemon-logo.png` as the placeholder), then
  "`{index+1}. {Name}`" (16px, weight 600, `#1a1a1a`, one line) over
  "`#{id padded to 3}`" (12px, `#9E9E9E`). On the right: one 20px dot per type
  in the type's color (`constants/pokemonTypes.ts`), then a 20px heart button.
  **Each row fetches its own detail** (`GET {API}/pokemon/{id}`) for the type
  dots, cached per id (React Query in the original: stale after 5 minutes,
  retry 2). Tapping the row opens the detail screen.
- **Detail** (`/pokemon/:id`): a sheet (iOS form sheet at 75% height, radius
  16, white) with a handle and a 30px heart, the 200×200 official artwork,
  the capitalized name (26px semibold, centered) and rows Dex №, Type, Height
  (m, 1 decimal), Weight (kg, 1 decimal), Base XP, Abilities, separated by 1px
  `#E3E3E3` lines.
- **Favourites**: the same list of the favourited ids (each row fetching its
  detail for its name), persisted across launches (AsyncStorage in the
  original; the framework's own persistent storage elsewhere). "No favourite
  Pokémon saved" when empty.

## Data

The data comes from the fixture server (`benchmarks/fixtures/server.mjs`),
never from pokeapi.co. Each app takes the server's origin at build time
(default `http://localhost:8787`, which the iOS Simulator reaches) and uses:

- `API = {origin}/api/v2`
- `SPRITES = {origin}/sprites/pokemon`

On a phone the origin is the Mac's LAN address, e.g.
`http://192.168.1.231:8787`. iOS allows plain HTTP to an IP address without an
ATS exception. Each app needs `NSLocalNetworkUsageDescription` in its
Info.plist, because the phone asks for local network access the first time.

Start the server with `node benchmarks/fixtures/server.mjs` (port 8787).

## Marks

Each app marks **fully drawn** with an `os_signpost` **event** in the
`PointsOfInterest` category (any subsystem), which the harness reads with
Instruments' Points of Interest instrument, by name. Fully drawn means the
first page of the list has loaded and its rows are rendered. The original
reports it as `TTFD` in a `useEffect` on `isSuccess`, inside
`requestAnimationFrame`. Use the framework's equivalent: report after the
commit that renders the first page's rows, not when the data arrives. Report
it once per process.

- React Native and Angular Native: emit `TTFD` from a small native module, as
  the original's `modules/app-startup-module` does (it also emits `TTID`; the
  others needn't: the harness takes the first frame from Instruments' App
  Launch, which needs no mark).
- AngularLynx: the runtime's `reportFullyDrawn()` (`import { reportFullyDrawn }
  from '@blotch/angular-lynx'`), which waits for the next flush to native and
  then has the shell emit `Fully Drawn`. The harness treats `Fully Drawn` and
  `TTFD` alike.
- ReactLynx runs in the same shell, so it calls the same shell module from the
  background thread: `NativeModules.AngularLynxShell.reportFullyDrawn()`.

On Android the same call goes to `Activity.reportFullyDrawn()`.

## Benchmark screens

Instruments launches an app with no URL, so a benchmark screen is chosen at
build time: with `BENCH_SCREEN` set (`EXPO_PUBLIC_BENCH_SCREEN` for the Expo
apps), e.g. `mount?kind=view&count=1500`, the app opens on that screen at
launch instead of the tabs, which neither render nor fetch. The same screen
also opens by deep link, `{scheme}://bench/mount?kind=...&count=...`.

- **Mount**: renders `count` elements of the kind in a plain (not virtualized)
  wrapping container: `view` is a 10×10 box with a background color, `text`
  is a short text ("{i}"), `image` is the sprite `{SPRITES}/{(i % 300) + 1}.png`
  at 24×24. It reports fully drawn (the same call as the list) after the
  commit that shows all `count` elements, so the harness measures from the
  process starting to them being on screen.

## Build

- Release builds only: no development client, no dev server, no debugger.
- iOS: bundle ID and team configurable; the harness installs each app on the
  phone signed by team `F64LTK85F6` (a Personal Team, which can't export Ad
  Hoc; build `Release` for `generic/platform=iOS`, development signing).
- Pin every version (exact versions in package.json, a lockfile).
- A `README.md` in each app folder: what it is, how it differs from the
  original (and why), and the exact commands to build it for the simulator
  and for the phone.
