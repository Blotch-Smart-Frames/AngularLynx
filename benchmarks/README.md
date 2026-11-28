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
| `apps/react-lynx` | The port to ReactLynx, in the same native shell as the AngularLynx app, on iOS and Android |
| `apps/angular-native` | The port to Angular Native (Expo SDK 58) |
| `fixtures/` | Recorded PokeAPI responses and sprites, and the server that hands them to the apps |
| `harness/` | The scripts that launch the apps under Instruments and read the traces, the UI test that scrolls them (`ios-scroll/`), and the ones that launch them on Android with adb (`android_*`) |
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
- **A real phone** for every published number. A Simulator run (below) only
  compares runs of one session with each other.
- **Alternating apps**, run by run (A B, B A, A B…), so heat, battery and
  background work fall on every app alike.
- **Battery, charging, thermal state and OS build** recorded with every run.
- **Medians and p90**, and every raw sample in `results/`.

## Results

[`results/ios`](results/ios) holds every run, one CSV per session: `launch-<date>-<app>.csv` for the launches, `mount-<date>-<kind>-<count>-<app>.csv` for the screens of many elements, `scroll-<date>-<app>.csv` for the swipes (a row per swipe), `size.csv` for the apps' sizes and `apps.json` for their versions. The website's [Benchmarks page](https://angularlynx.js.org/guide/benchmarks) charts them as they are, and `harness/summarize.py` prints the same medians.

Two things the runs showed, which shape how they're read:

- **Each session stands alone.** The phone and the network differ from one sitting to the next (AngularLynx's median moved by 60 ms between two sessions with the Mac equally idle), so each app is compared with AngularLynx from its own session.
- **A launch right after the same app is about 80 ms faster** than one after the other app, for every app: iOS still has its files in memory. The A B, B A order gives each app about half of each, and the charts and `summarize.py` split them (`again`, `after other`) by each row's `previous_app`, the app launched before it, which counts a run the harness dropped and launched again (an older CSV without the column goes by its timestamps).

The first session, run while the Mac was building the other apps, is in `results/ios/pilot` and isn't charted.

[`results/android-emulator`](results/android-emulator) holds AngularLynx against ReactLynx on an Android emulator (below), with what its session showed in its README. It isn't charted either.

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

# 5. Scrolling: a UI test swipes up each app's list once, then ten times
#    measured, each launch
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

## On the iOS Simulator

The phone is shared, so the launch and mount runs can also go on a booted
Simulator, to see whether a change made an app faster or slower before
someone takes the phone:

```sh
# Build and install each app for the Simulator (it reaches the fixture server
# at localhost)
xcrun simctl install <UDID> \
  "$(sh harness/build_ios_app.sh --simulator angular-lynx com.angularlynx.bench.angularlynx)"

# Launch them in turn
python3 harness/ios_launch.py --simulator --device <UDID> --runs 20 \
  --app angular-lynx=<bundle id> --app react-lynx=<bundle id> \
  --out results/ios-simulator/launch-<date>-react-lynx.csv

# The screens of many elements
python3 harness/ios_mount.py --simulator --device <UDID> --rival react-lynx --runs 10
```

On the Simulator, Instruments' App Launch template records no launch phases
and Activity Monitor fails, so a Simulator run records fully drawn (the light
recording, from dyld's launch of the process) and the app's memory, which
`footprint` reads from its process on the Mac 6 s into the recording
(`--memory-after`), a few seconds after it's drawn. There's no first frame,
peak memory, battery or charging, and the thermal state is the Mac's.

Its numbers aren't a phone's. Every launch takes about 1.45 s longer, and
memory doesn't rank the apps as a phone does, so they're never charted:
`results/ios-simulator` isn't read by the website. Within a session they
compare, as long as the Mac stays quiet. Two builds of one app launched in
turn came within ±4% of each other (95% intervals), and each app's cost per
element, (5,000-element screen − 1,500-element screen) / 3,500, separates the
frameworks clearly. The Simulator runs on the Mac's cores, so a busy Mac
slows it by 5–30%: the harness waits until the Mac's load average is under
`--max-load` (half its cores by default) before each launch, and drops and
repeats a run whose load went over it. With more than two apps, the order
rotates as well as reversing, so each app follows each of the others in turn.

## On an Android emulator

AngularLynx and ReactLynx build for Android in the same shell (the project
`ng build --platform android` generates), so the two Lynx apps compare on
Android too. Until a phone is measured (issue #842), the runs go on an
emulator, the same way the Simulator runs go:

```sh
# The fixture server, on the Mac, and an emulator (the E2E tests' AVD: a
# Pixel-sized phone on Android 14, arm64)
node fixtures/server.mjs
emulator -avd angular-lynx-e2e -no-window -no-audio -no-boot-anim -no-snapshot

# Build each app's release .apk and install it
adb install -r "$(sh harness/build_android_app.sh angular-lynx com.angularlynx.bench.angularlynx)"
adb install -r "$(sh harness/build_android_app.sh react-lynx com.angularlynx.bench.reactlynx)"

# Launch them in turn
python3 harness/android_launch.py --device emulator-5554 --runs 20 \
  --app angular-lynx=com.angularlynx.bench.angularlynx \
  --app react-lynx=com.angularlynx.bench.reactlynx \
  --out results/android-emulator/launch-<date>-react-lynx.csv

# The screens of many elements (the rival goes on com.angularlynx.bench.rival)
python3 harness/android_mount.py --device emulator-5554 --rival react-lynx --runs 10

python3 harness/summarize.py results/android-emulator/launch-*.csv
```

`android_launch.py` points the device's `localhost:8787` at the Mac's with
`adb reverse`: both shells let plain HTTP reach only `localhost`, so the same
`.apk` works on an emulator and on a phone over USB. Each launch is
`am start -S -W`, a new process with the file caches warm (what Android calls
a cold launch). It records `am start -W`'s TotalTime as the first frame,
logcat's `Fully drawn` line (the shells' `Activity.reportFullyDrawn()`) as
fully drawn, and `dumpsys meminfo`'s total PSS and RSS 6 s into the launch
as memory, with the device's battery and thermal status and the Mac's load
average. Each app is launched once unmeasured first, so the work after an
install isn't in any run. Android reports a `reportFullyDrawn()` made
before the first frame at the first frame's time, so the two are equal when
an app had its screen complete before it let its splash screen go.

The emulator runs on the Mac's cores, so as on the Simulator the harness
waits for the Mac's load average to be under `--max-load` before each
launch, records it with every run, and repeats a run whose load went over.
Its numbers aren't a phone's, so `results/android-emulator` isn't charted
either; within a session they compare.

## Tracking AngularLynx against ReactLynx

[`simulator-benchmarks.yml`](../.github/workflows/simulator-benchmarks.yml)
runs the Simulator benchmark on demand: it builds this commit's AngularLynx
app (on the packed packages, `scripts/use-local-packages.mjs`) and the
ReactLynx app, launches the Pokédex 20 times each and each of the six mount
screens 10 times each, and [`harness/track.py`](harness/track.py) reads the
CSVs. It tracks four things as AngularLynx / ReactLynx: the Pokédex's fully
drawn time and its memory, and the cost of a view, a text and an image,
(5,000-element screen − 1,500-element screen) / 3,500. The host moves the
times by 5–30% from one run to the next, but it moves both apps of a session
alike, so the ratio keeps most of a change in AngularLynx and little of the
host's.

The job summary has the run's numbers, each ratio against its baseline (the
median of the 14 days before) and the last 14 days. The history keeps one
record a day, the latest run's, and each run on master hands it to the next
as an artifact (`simulator-benchmark-history`, kept 90 days); its CSVs are in
`simulator-benchmarks`. A ratio more than 10% off its baseline, the same way,
on each of the last three days it ran opens an issue labeled
`benchmark-alert`, or comments on the one that's open: one day is the host,
three in a row aren't. A run on another branch only measures.

It isn't a per-PR gate (the host moves a single run too much for that, and a
change of a few percent needs a quiet Mac, above, to see), and it isn't
scheduled: GitHub's free macOS runner can't run it. With the Simulator
booted, its 3 cores ran a load average of 84 to 303, and Instruments
recorded the first launch of each app, four times slower than on a laptop,
then hung before recording the next (#854). So it runs on a Mac with Xcode
27, about an hour and a half of builds and launches, in either of two ways.

**As the workflow**, which keeps the history and opens the issue. Register
the Mac as a
[self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/adding-self-hosted-runners)
of the repository (Settings → Actions → Runners → New self-hosted runner),
start it with `./run.sh`, and run the workflow from the Actions tab, or with
`gh workflow run simulator-benchmarks.yml --ref master`, whose `runner` input
is `self-hosted`. When it's done, stop the runner and remove it
(`./config.sh remove`, with the token from the same page), and delete its
folder. Don't leave it registered: the workflow runs only on
`workflow_dispatch`, which takes write access, but a runner left on a public
repository is one any later workflow could target. If Instruments has never
recorded on the Mac, record once by hand first (`xcrun xctrace record
--instrument 'Points of Interest' --device <udid> --time-limit 3s --launch --
<bundle id>`): macOS asks for an admin's password the first time, and a
runner can't answer it.

**By hand**, which measures without the history: save these lines as a
script and run it with `bash` from the repository root, after `npm ci` and
`npm run build`. Commit or stash any changes to
`benchmarks/apps/angular-lynx/package.json` and `package-lock.json` first,
since the script puts both back when it ends.

```sh
set -e
cleanup() {
  [ -z "${fixtures:-}" ] || kill "$fixtures" 2>/dev/null || true
  python3 benchmarks/harness/track.py shutdown || echo "Shutting the Simulator down failed" >&2
  git checkout benchmarks/apps/angular-lynx/package.json benchmarks/apps/angular-lynx/package-lock.json
}
trap cleanup EXIT
(cd benchmarks/apps/angular-lynx && node scripts/use-local-packages.mjs)
(cd benchmarks/apps/react-lynx && npm ci)
udid=$(python3 benchmarks/harness/track.py boot)
xcrun simctl install "$udid" "$(sh benchmarks/harness/build_ios_app.sh --simulator angular-lynx com.angularlynx.bench.angularlynx)"
xcrun simctl install "$udid" "$(sh benchmarks/harness/build_ios_app.sh --simulator react-lynx com.angularlynx.bench.rival)"
node benchmarks/fixtures/server.mjs & fixtures=$!
launch="benchmarks/results/ios-simulator/launch-$(date -u +%F)-react-lynx.csv"
python3 benchmarks/harness/ios_launch.py --simulator --device "$udid" --runs 20 \
  --app angular-lynx=com.angularlynx.bench.angularlynx --app react-lynx=com.angularlynx.bench.rival --out "$launch"
python3 benchmarks/harness/ios_mount.py --simulator --device "$udid" --rival react-lynx --runs 10
python3 benchmarks/harness/track.py report --launch "$launch" --mount-dir benchmarks/results/ios-simulator --summary summary.md
```

`use-local-packages.mjs` rewrites those two files to the packed packages.
`cleanup` stops the fixture server and the Simulator and puts the two files
back however the script ends, a failed build or launch included. Both harnesses append to the day's CSVs, and the report takes each
app's median of every row in them, so move a day's earlier
`launch-<date>-react-lynx.csv` and `mount-<date>-*` files out of
`results/ios-simulator` before a second session that day; the report finds
the mount CSVs by those names only.
