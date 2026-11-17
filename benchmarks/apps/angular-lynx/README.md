# LaunchPerfAL: the benchmark app on AngularLynx

Software Mansion's [`launchperf-poke-rn`](https://github.com/software-mansion-labs/launchperf-poke-rn)
(`../react-native`), ported screen for screen to AngularLynx, for the launch
benchmark in issue #285. [`../../SPEC.md`](../../SPEC.md) says what every app
in the benchmark does.

It's an app as a user makes one: `npm create angular-lynx`, then the screens,
written as the public skill (`skills/angular-lynx`) describes, and
`ng build --platform ios` for the iOS app. The difference is where AngularLynx
comes from: the benchmark measures the tip of master, so the app installs this
repository's packages, packed as `npm publish` would pack them, not the
releases on npm (see [Local packages](#local-packages)).

## The screens

| Screen     | The original                                        | Here                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root       | expo-router `Stack`                                 | `App` (`src/app/app.ts`): the primary `<router-outlet>`, and a `sheet` outlet for the detail                                                                                                                                                      |
| Tabs       | expo-router `Tabs` (React Navigation's bottom tabs) | `Tabs` (`screens/tabs.ts`): `<lynx-tab-outlet>`, which keeps each tab once shown, over @blotch/ui's `<ui-tab-bar>` (copied in with dolan, as the skill says to get a tab bar), with the original's SVG icons through `[svg]`                      |
| Pokédex    | `FlatList` + `useInfiniteQuery`                     | `Pokedex` (`screens/pokedex.ts`) and `PokemonList` (`components/pokemon-list.ts`): Lynx's native `<list>` with `*lynxListFor`, which builds a row only when the list asks for it and reuses the rows scrolled away; pages of 50 from `HttpClient` |
| Row        | `PokemonItem`, `useQuery` per row                   | `PokemonItem` (`components/pokemon-item.ts`): each row reads its Pokémon's detail from `PokemonDetails` (`data/pokemon-details.ts`), which fetches each id once and keeps it, stale after 5 minutes, retried twice                                |
| Detail     | `/pokemon/[id]`, an iOS form sheet at 75%           | `PokemonSheet` (`screens/pokemon-sheet.ts`): the route `pokemon/:id` in the `sheet` outlet (`/pokedex(sheet:pokemon/25)`), in @blotch/ui's `<ui-bottom-sheet>`                                                                                    |
| Favourites | zustand + AsyncStorage                              | `Favourites` (`data/favourites.ts`), a signal kept in `LynxLocalStorage`, and `FavouritesScreen` (`screens/favourites.ts`)                                                                                                                        |
| Mount      | `/bench/mount`                                      | `Mount` (`screens/mount.ts`): `@for` in a wrapping `<view>` inside a `<scroll-view>`                                                                                                                                                              |

Every screen is a standalone component loaded lazily by the router; state is
in signals. The build puts the lazy screens in the one `main.lynx.bundle`, so
they cost no extra file at launch.

**Fully drawn.** The Pokédex calls the runtime's `reportFullyDrawn()` once the
first page has loaded and the list has laid out its rows (the list's
`layoutcomplete`, not when the data arrives: `*lynxListFor` builds the rows
when the native list asks for them, during the layout after the flush that
gave it the page). `reportFullyDrawn()` waits for the next flush and has the
shell emit an `os_signpost` event named `Fully Drawn` in the Points of
Interest category, once per process.

## Build-time settings

Read from the environment by `ng build` (`lynx.config.mts` defines them as
constants in the bundle):

| Variable         | Default                 |                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIXTURE_ORIGIN` | `http://localhost:8787` | The fixture server (`node ../../fixtures/server.mjs`). The simulator reaches the Mac at localhost; a phone needs the Mac's LAN address, e.g. `http://192.168.1.231:8787`                                                                                                                                                                                                                                                          |
| `BENCH_SCREEN`   | empty                   | A benchmark screen to open on at launch instead of the tabs, e.g. `mount?kind=view&count=1500` (`kind` is `view`, `text` or `image`; `count` 1500 or 5000). The tabs and the list are never built and fetch nothing. The mount screen calls `reportFullyDrawn()` once it has rendered all `count` elements. Instruments launches an app without a URL, so the harness builds a variant per screen rather than opening a deep link |

The app ID is `appId` in `angular.json` (`com.angularlynx.bench.angularlynx`);
`ng build` takes it from the command line too: `--app-id com.example.other`.

## Local packages

```sh
# Once, at the repository root: build the packages.
npm install && npm run build

# In this folder: pack them into .local-packages/ and install them.
node scripts/use-local-packages.mjs        # or --build to run the root build first
```

`scripts/use-local-packages.mjs` packs every package in
`packages/release/src/packages.ts` (the list the E2E tests and the publish
workflow use) with `npm pack` into `.local-packages/` (git-ignored), points the
app's `@blotch/*` dependencies at the tarballs, and adds an `overrides` entry
for each, so the packages they bring (`@blotch/angular-lynx-build` brings the
rsbuild plugin and the native builder) are the packed ones too. Each tarball's
name ends in a hash of its bytes, so package.json and the lockfile change
whenever a package does, and npm installs the new one. Run it again after
changing or rebuilding a package. `node scripts/use-local-packages.mjs -- <args>`
runs the packed dolan (`-- add separator`, `-- update`).

The app is outside the monorepo's npm workspaces (`benchmarks/` isn't one), so
it has its own `node_modules` and lockfile. Every other version is pinned
exactly.

## Commands

The fixture server first, from the repository root: `node benchmarks/fixtures/server.mjs`.

**Release build for the iOS Simulator:**

```sh
npx ng build --platform ios
# dist/ios/LaunchPerfAL-simulator.app; dist/main.lynx.bundle is the Lynx bundle
xcrun simctl install booted dist/ios/LaunchPerfAL-simulator.app
xcrun simctl launch booted com.angularlynx.bench.angularlynx
```

The mount screen's variant (one per kind and count):

```sh
BENCH_SCREEN='mount?kind=image&count=5000' npx ng build --platform ios
```

`ng build --platform ios --run` installs and opens it on a simulator itself
(`--device "<simulator name>"` picks one).

**Release build for a phone** (team `F64LTK85F6`, development signing):

```sh
FIXTURE_ORIGIN=http://192.168.1.231:8787 npx ng build --platform ios
```

builds the bundle and generates the Xcode project in
`.angular/cache/22.2.7/angular-lynx/lynx-native/ios`. The builder's own way to
build a signed app is `--run --device "<iPhone name>"` with
`"ios": { "teamId": "F64LTK85F6" }` in angular.json, which builds a
development-signed Release app for that phone (`dist/ios/LaunchPerfAL-device.app`)
and installs it, but it passes `-allowProvisioningUpdates` and
`-allowProvisioningDeviceRegistration`, so Xcode may register the App ID and
the phone with the team. Without the builder, after the build above:

```sh
xcodebuild build -project .angular/cache/22.2.7/angular-lynx/lynx-native/ios/App.xcodeproj \
  -scheme App -configuration Release -sdk iphoneos -destination generic/platform=iOS \
  -derivedDataPath .angular/xcode-device DEVELOPMENT_TEAM=F64LTK85F6 \
  PRODUCT_BUNDLE_IDENTIFIER=com.angularlynx.bench.angularlynx -allowProvisioningUpdates
```

(`-allowProvisioningUpdates` lets Xcode make the development profile, which
counts against a Personal Team's App IDs once per bundle ID.)

## Checked on the iOS Simulator

Release build, iOS 27 Simulator, 2026-11-17: the Pokédex renders as the
original; `Fully Drawn` is emitted once per launch (Instruments' Points of
Interest, or `log show --signpost --predicate 'category == "PointsOfInterest"'`);
scrolling to the end loads pages 2 to 4; the detail sheet opens over the list;
favourites survive a relaunch; `BENCH_SCREEN='mount?kind=image&count=1500'`
opens on the mount screen and reports `Fully Drawn`. The simulator `.app` is
about 58 MB (both simulator architectures; Lynx.framework is 32 MB of it), and
`main.lynx.bundle` about 1.0 MB.

## How it differs from the original, and why

Everything the original does, this does; it does nothing the original
doesn't. Where AngularLynx can't do the same thing, it does the nearest:

- **Fully drawn is `Fully Drawn`, not `TTFD`,** from the runtime's
  `reportFullyDrawn()` and the shell's module, which the harness reads alike
  (SPEC.md). There's no `TTID`: the harness takes the first frame from
  Instruments' App Launch. It fires after the list's `layoutcomplete` and the
  flush after it, where the original fires in a `requestAnimationFrame` after
  the commit that renders the first page: `*lynxListFor` builds rows while the
  native list lays out, after the commit that hands it the page.
- **The tab bar is @blotch/ui's `<ui-tab-bar>`, not React Navigation's.** The
  skill says to add a tab bar with dolan rather than build one. Tinted black
  and `#424242` as the original (theme variables, and `UI_THEME_COLORS` for
  the icons), 12px labels, items 49px tall over the safe area. Its labels are
  weight 500, its icons 24px, its top border `#E4E4E7`; a tapped tab shows
  selected from the tap, and its icon turns solid when the navigation ends. It
  brings dolan's whole icon set into the bundle (`icons.ts`, about 39 kB of
  source), which `iconMarkup()` refers to even for an `[svg]` item.
- **The detail is @blotch/ui's `<ui-bottom-sheet>`, not UIKit's form sheet.**
  AngularLynx has no native sheet; the bottom sheet is its nearest (an
  `<overlay>` with a backdrop, dragged down or tapped away, moved by Core
  Animation). Its height comes from its content, `75vh`; corners 16px, white.
  It draws its own grabber (36×5, 20% black, in a 25px strip) where the
  original draws a 64×4 `#1a1a1a` handle in its 52px header, so the heart
  sits over that strip at the original's 11px from the top. Its backdrop dims
  to 50% black, where UIKit dims to about 20%, and it slides on a CSS curve
  rather than UIKit's spring. The detail is a route in a named outlet
  (`/pokedex(sheet:pokemon/25)`), Angular's way to show a route over another.
- **Spinners are @blotch/ui's `<ui-spinner>`**, an SVG arc that Core Animation
  turns, 32px and 20px in `#999999`, for `ActivityIndicator`'s large (37px)
  and small (20px) native spinner. AngularLynx has none of its own.
- **Next page at half a screen, counted in rows.** Lynx's list says when the
  end is near by items left (`lower-threshold-item-count`), not by pixels, so
  the threshold is half the list's height divided by a row's 106px, rounded
  up (4 rows on a 402×874-point iPhone).
- **The list pads by item.** A Lynx `<list-item>` fills the list's width, so
  the header, each row and the end pad themselves to the original's 16px
  around the content.
- **Text.** `text-maxline="1"` with an ellipsis for `numberOfLines={1}`. The
  original's unstyled texts (the header, the detail's name) are React Native's
  default black; here they're set to `#000`.
- **Data.** `HttpClient` and RxJS's `retry` for axios and React Query:
  `PokemonDetails` keeps each Pokémon's detail by id (fresh for 5 minutes,
  refetched by the next row to ask after that, two retries with React Query's
  1 s and 2 s delays), and the Pokédex keeps its pages while its tab lives,
  which `<lynx-tab-outlet>` makes the app's life. No 10 s timeout, which axios
  had and HttpClient lacks; the fixture server answers at once.
- **Favourites** are read from `LynxLocalStorage` (`UserDefaults` in the iOS
  shell) when first needed and merged over the state, as zustand's persist
  middleware rehydrates from AsyncStorage. Same key (`favourites`), same
  record of ids, so the same order (integer keys in numeric order).
- **Colors.** The app keeps to light colors (`provideColorScheme('light')`):
  the original's screens are fixed light colors, and dolan's components would
  otherwise follow the phone into dark mode.
- **Press feedback.** Rows dim to 0.2 while touched (TouchableOpacity's
  default), from touch events, since Lynx has no `:active`. No fade back.
- **The mount screen** is opened by a build-time variant (`BENCH_SCREEN`) and
  reports `Fully Drawn` once its elements are flushed; the original's
  `MountStart`/`MountEnd` signposts are left out, as SPEC.md now says. The
  `launchperfal://` scheme is registered (`deepLinkSchemes`), but the iOS
  shell doesn't hand an opened URL to the app, so a deep link only opens it.
- **Splash and icon** are the original's (`splash`: the same image 200pt wide
  on white, black in the dark), hidden at Angular's first frame, as Expo hides
  its splash when the root layout mounts.
- **No `NSLocalNetworkUsageDescription` in the release app.** The builder
  writes it into the `ng serve` development app only; `permissions` has no
  entry for it, and the app has no other way to add an Info.plist key. The
  simulator doesn't need it; on a phone it's untested whether iOS still asks
  for local network access and lets the app reach the Mac.
- **Scaffolded inside the monorepo.** `ng add` skipped installing
  `@blotch/angular-lynx` because the monorepo's `node_modules` above the app
  already had it, so it never reached package.json; it was added by hand, as
  `ng add` adds it everywhere else.
