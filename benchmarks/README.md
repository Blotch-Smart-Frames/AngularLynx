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
| `apps/react-native` | [Software Mansion's `launchperf-poke-rn`](https://github.com/software-mansion-labs/launchperf-poke-rn) (MIT), with only the API's base URL changed: Expo 54, React Native 0.81 |
| `apps/react-native-0.88` | The same app on Expo SDK 58 / React Native 0.88, the base Angular Native uses |
| `apps/angular-lynx` | The port to AngularLynx, on this repository's packages |
| `apps/react-lynx` | The port to ReactLynx, in the same native shell as the AngularLynx app |
| `apps/angular-native` | The port to Angular Native (Expo SDK 58) |
| `fixtures/` | Recorded PokeAPI responses and sprites, and the server that hands them to the apps |
| `harness/` | The scripts that launch the apps under Instruments and read the traces |
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

## Running it

```sh
# 1. The fixture server, on the Mac
node fixtures/server.mjs

# 2. Build and install each app on the phone (see each app's README), with
#    the fixture origin set to the Mac's LAN address

# 3. Launch them under Instruments, alternating
python3 harness/ios_launch.py --device <UDID> --runs 20 \
  --app angular-lynx=<bundle id> --app react-native=<bundle id> \
  --out results/ios/launch.csv

# 4. Medians and p90
python3 harness/summarize.py results/ios/launch.csv
```

The harness needs Xcode and `ideviceinfo` (`brew install libimobiledevice`)
for the battery level.
