# Benchmarks

The same app, built in each framework, launched on a real phone over and over,
with every raw sample committed. It's the plan in
[issue #285](https://github.com/Blotch-Smart-Frames/AngularLynx/issues/285):
nobody had published a like-for-like mobile benchmark of Lynx against React
Native, so we measure it ourselves and publish the apps, the harness and the
numbers.

This folder is outside the npm workspaces on purpose: Expo and the other
frameworks never touch the monorepo's build.

| Folder | What's in it |
| --- | --- |
| [`SPEC.md`](SPEC.md) | What every app does, screen by screen |
| `apps/react-native` | [Software Mansion's `launchperf-poke-rn`](https://github.com/software-mansion-labs/launchperf-poke-rn) (MIT), with only the API's base URL changed, and the scene life cycle iOS 27 requires: Expo 54, React Native 0.81 |
| `apps/react-native-0.88` | The same app on Expo SDK 58 / React Native 0.88, the base Angular Native uses |
| `apps/angular-lynx` | The port to AngularLynx, on this repository's packages |
| `apps/react-lynx` | The port to ReactLynx, in the same native shell as the AngularLynx app |
| `apps/angular-native` | The port to Angular Native (Expo SDK 58) |
| `fixtures/` | Recorded PokeAPI responses and sprites, and the server that hands them to the apps |
| `harness/` | The scripts that launch the apps under Instruments and read the traces, and the UI test that scrolls them (`ios-scroll/`) |
| `results/` | Every run, as CSV |

## The app

Software Mansion's Pokédex: two tabs, a list that pages in 50 Pokémon at a
time with each row loading its own types, a detail sheet and favourites. It's
the app behind their
[React Native vs Kotlin Multiplatform study](https://swmansion.com/blog/we-built-the-same-app-in-kmp-and-react-native-here-s-what-we-found),
which is the most careful published method we found.

Every app loads its data from `fixtures/server.mjs` on the Mac, over the
local network, never from pokeapi.co: so network time is the same few
milliseconds in every run, and "fully drawn" measures the framework.

## Rules

- **Release builds only**, each app in its own native shell: never Expo Go,
  never Lynx Explorer.
- **A real phone** for every published number. Simulators only check the
  harness.
- **Alternating apps**, run by run (A B, B A, A B…), so heat, battery and
  background work fall on every app alike.
- **Battery, charging, thermal state and OS build** recorded with every run.
- **Medians and p90**, and every raw sample in `results/`.

## Results

[`results/ios`](results/ios) holds every run, one CSV per session: `launch-<date>-<app>.csv` for the launches, `mount-<date>-<kind>-<count>-<app>.csv` for the screens of many elements, `scroll-<date>-<app>.csv` for the swipes (a row per swipe), `size.csv` for the apps' sizes and `apps.json` for their versions. The website's [Benchmarks page](https://angularlynx.js.org/guide/benchmarks) charts them as they are, and `harness/summarize.py` prints the same medians.

Two things the runs showed, which shape how they're read:

- **Each session stands alone.** The phone and the network differ from one sitting to the next (AngularLynx's median moved by 60 ms between two sessions with the Mac equally idle), so each app is compared with AngularLynx from its own session.
- **A launch right after the same app is about 80 ms faster** than one after the other app, for every app: iOS still has its files in memory. The A B, B A order gives each app about half of each, and the charts and `summarize.py` split them (`again`, `after other`) by each row's timestamp.

The first session, run while the Mac was building the other apps, is in `results/ios/pilot` and isn't charted.

## Running it

```sh
# 1. The fixture server, on the Mac
node fixtures/server.mjs

# 2. Build and install each app on the phone. build_ios_app.sh builds any of
#    them for a phone with the Mac's LAN address as the fixture origin (the
#    Expo apps need `expo prebuild` with the bundle ID first, see their
#    READMEs)
xcrun devicectl device install app --device <UDID> \
  "$(sh harness/build_ios_app.sh angular-lynx com.angularlynx.bench.angularlynx)"

# 3. Launch two apps in turn under Instruments
python3 harness/ios_launch.py --device <UDID> --runs 20 \
  --app angular-lynx=<bundle id> --app react-native=<bundle id> \
  --out results/ios/launch-<date>-react-native.csv

# 4. The screens of many elements: builds and installs both apps for each
#    screen, and launches them with a lighter recording
python3 harness/ios_mount.py --device <UDID> --rival react-native --runs 10

# 5. Scrolling: a UI test swipes up each app's list ten times a launch
#    (harness/ios-scroll). It needs the list, so build both apps again
#    without a bench screen: step 4 left them built for its last one. With a
#    third field, each app's .app, it keeps one of the two installed at a
#    time, beside the test's own runner app
ours=$(sh harness/build_ios_app.sh angular-lynx com.angularlynx.bench.angularlynx)
rival=$(sh harness/build_ios_app.sh react-native com.angularlynx.bench.rival)
python3 harness/ios_scroll.py --device <UDID> --runs 10 \
  --app angular-lynx=com.angularlynx.bench.angularlynx="$ours" \
  --app react-native=com.angularlynx.bench.rival="$rival" \
  --out results/ios/scroll-<date>-react-native.csv

# 6. Sizes, and the medians
sh harness/ios_size.sh <app> path/to/App.app >> results/ios/size.csv
python3 harness/summarize.py results/ios/launch-*.csv
python3 harness/summarize.py results/ios/scroll-*.csv
```

The harness needs Xcode and `ideviceinfo` (`brew install libimobiledevice`)
for the battery level. The first launch of each app asks for local network
access on the phone: tap Allow.

A free Apple team (a Personal Team) can have three apps on a phone at once
and register ten App IDs a week, so the runs keep AngularLynx installed as
`com.angularlynx.bench.angularlynx` and put each other app in turn on
`com.angularlynx.bench.rival`. The scroll test's runner is an app too
(`com.angularlynx.bench.scroll.xctrunner`): with it and any other app of the
team on the phone, `ios_scroll.py` swaps the two benchmark apps, and the
test allows the local network prompt each new install brings.

`ios_scroll.py` builds the runner with `xcodebuild`, from the project
committed in `harness/ios-scroll`. After changing `project.yml`, run
`xcodegen` there (`brew install xcodegen`) to make the project again.
