# Android emulator runs

AngularLynx against ReactLynx on an Android emulator, from
`harness/android_launch.py` and `harness/android_mount.py`. The website
doesn't chart these, since an emulator's numbers aren't a phone's (see
"On an Android emulator" in `../../README.md`). Within a session they
compare.

## 2026-11-28, one session per kind, 1,500 and 15,000 elements

The six mount screens again, later the same day, on the same emulator and
Mac, run the way the Simulator's are (#904): 1,500 and 15,000 elements
rather than 5,000, and each kind's four builds (both apps, both sizes)
installed side by side on application IDs of their own and launched in
turn in one session. The CSVs are in
[`2026-11-28-one-session`](2026-11-28-one-session).

- **Apps:** as below, in the shell generated from `packages/native` at
  29de655e, AngularLynx on that commit's packages.
- **Runs:** 10 per build, the four builds of a kind in `android_launch.py`'s
  rotating order, each after one unmeasured launch. The Mac's 1-minute load
  average stayed at or below 7.2 (`--max-load` 9, no runs dropped), with a
  median of 4.4.

Each cost per element is (fastest 15,000-element mount − fastest
1,500-element mount) / 13,500, as `android_mount.py` prints it, with a 95%
bootstrap interval over the runs. The previous session's, from 1,500 and
5,000 elements in a session each, are beside them:

|                         | 1,500 and 15,000, one session | 1,500 and 5,000, a session each |
| ----------------------- | ----------------------------- | ------------------------------- |
| AngularLynx per `view`  | 50.9 µs (±2%)                 | 52.5 µs (±3%)                   |
| ReactLynx per `view`    | 20.4 µs (±3%)                 | 25.2 µs (±22%)                  |
| AngularLynx per `text`  | 91.4 µs (±1%)                 | 82.2 µs (±2%)                   |
| ReactLynx per `text`    | 49.4 µs (±1%)                 | 46.9 µs (±13%)                  |
| AngularLynx per `image` | 61.9 µs (±1%)                 | 62.2 µs (±4%)                   |
| ReactLynx per `image`   | 26.1 µs (±3%)                 | 28.5 µs (±13%)                  |

What they show:

- **Every cost is now within ±3%**, ReactLynx's as well as AngularLynx's,
  so the ratio's own uncertainty is well under the 10% `track.py` treats as
  a change on the Simulator.
- **AngularLynx takes 2.5× ReactLynx's time per view, 1.9× per text and
  2.4× per image.** AngularLynx's text costs more over 15,000 elements than
  over 5,000 (91.4 against 82.2 µs, both within ±2%): a cost per element
  is the average over the elements between the two screens, so it's only
  compared within one pair of sizes.
- **ReactLynx's spread was its threads waiting for the emulator's cores,
  not its fully drawn call.** A Perfetto trace of six launches of each
  app's 1,500-text screen (scheduling only) shows ReactLynx's main thread
  (`Lynx_TASM1`) and background thread (`Lynx_JS`, which renders the screen
  again to hydrate it) both running through the mount, 79–100 and 61–77 ms
  each, with the emulator's four cores 2.5–2.8 busy on average, against
  1.5–1.9 for AngularLynx's one thread. Its main thread waited for a core
  for 11–38 ms of each mount (AngularLynx's for 9–18), and the slowest
  mount (153 ms against 105–116) waited longest. In both apps the main
  thread ran until the fully drawn call, so `runOnMainThread`'s round trip
  adds no idle time before it. The same tens of milliseconds are a small
  share of 13,500 more elements.

## 2026-11-28, timed from `MountStart`

The six mount screens again, later the same day, on the same emulator and
Mac, with each screen also timed from its own `MountStart` mark to its fully
drawn call (`mount_ms`, #900), which leaves out the emulator's launch before
it, as the Simulator's runs have since #892. The CSVs are in
[`2026-11-28-mount-ms`](2026-11-28-mount-ms), since the earlier session's
have the same names and other columns.

- **Apps:** as below, in the shell generated from `packages/native` at
  3fb61fca with this change's `ShellModule.kt`, which logs both marks with
  the device's monotonic clock.
- **Runs:** 10 per app on each screen, alternating A B, B A, each after one
  unmeasured launch. The Mac's 1-minute load average stayed at or below 8.9
  (`--max-load` 9, three runs dropped and run again), with a median of 4.6.

Each cost per element is (fastest 5,000-element mount − fastest
1,500-element mount) / 3,500, as `android_mount.py` prints it, with a 95%
bootstrap interval over the runs. The same launches' fully drawn times
(from the launch's start) are beside them:

|                         | From `MountStart` | From the launch |
| ----------------------- | ----------------- | --------------- |
| AngularLynx per `view`  | 52.5 µs (±3%)     | 55.4 µs (±10%)  |
| ReactLynx per `view`    | 25.2 µs (±22%)    | 20.3 µs (±58%)  |
| AngularLynx per `text`  | 82.2 µs (±2%)     | 88.6 µs (±8%)   |
| ReactLynx per `text`    | 46.9 µs (±13%)    | 54.3 µs (±5%)   |
| AngularLynx per `image` | 62.2 µs (±4%)     | 72.0 µs (±8%)   |
| ReactLynx per `image`   | 28.5 µs (±13%)    | 37.4 µs (±20%)  |

What they show:

- **Leaving the launch out narrows most intervals**, AngularLynx's to
  within ±4%, and ReactLynx's view from ±58% to ±22%. A launch-timed cost
  can also come out lower than the mount's own, as ReactLynx's view did:
  it's the difference of two launches, each mostly the emulator's own start.
- **ReactLynx's costs stay wider than AngularLynx's.** Its fully drawn call
  comes from the background thread, after a round trip to the main thread
  (`apps/react-lynx`, "What it marks"), and the 3,500 elements between its
  screens take 88–164 ms against AngularLynx's 184–288 ms, so the same few
  milliseconds of the emulator's scheduling weigh about twice as much.
- **AngularLynx still takes about twice ReactLynx's time per element:** about
  2.1× for a view, 1.8× for a text and 2.2× for an image, as in the session
  below.

## 2026-11-28

- **Emulator:** the E2E tests' `angular-lynx-e2e` AVD (Android 14, Google
  APIs, arm64-v8a, 4 cores, 2 GB, 1080×2400 at 420 dpi), run headless
  (`-no-window -no-snapshot`) on an 18-core Apple silicon Mac that other
  builds shared. The Mac's 1-minute load average stayed at or below 6.8
  (`--max-load` 9), with a median of 4.5.
- **Apps:** both release `.apk`s, R8-minified, in the shell generated from
  `packages/native` at a81a7cf4, with the canvas left out of both. AngularLynx
  is the benchmark app on that commit's packages (`use-local-packages.mjs`).
  ReactLynx is `apps/react-lynx` built with `scripts/build-android.mjs`.
- **Runs:** 20 Pokédex launches per app and 10 per app on each of the six
  mount screens, alternating A B, B A, each after one unmeasured launch.

Medians over all runs but each file's first. "Per element" is
(5,000-element screen − 1,500-element screen) / 3,500, from fully drawn.

|                              | AngularLynx | ReactLynx |
| ---------------------------- | ----------- | --------- |
| Pokédex first frame          | 289 ms      | 300 ms    |
| Pokédex fully drawn          | 289 ms      | 332 ms    |
| Pokédex memory (PSS, 6 s in) | 59.0 MB     | 58.5 MB   |
| Per `view`                   | 57 µs       | 30 µs     |
| Per `text`                   | 95 µs       | 50 µs     |
| Per `image`                  | 73 µs       | 22 µs     |

What they show:

- **The Pokédex is drawn about as fast in both,** and AngularLynx's first
  frame is its complete screen. AngularLynx lets the splash screen go after
  Angular's first flush, which on the emulator already carries the first
  page's rows. ReactLynx lets it go at its root component's first effect,
  and draws the rows in a later commit. Android reports a fully drawn call
  made before the first frame at the first frame's time, so AngularLynx's two
  columns are equal.
- **Each element costs AngularLynx about twice ReactLynx's time to mount, or
  more:** about 2× for views and texts and about 3× for images. On the
  5,000-element screens it's 150 to 250 ms more. That's a narrower gap than
  the iPhone's 2026-11-17 session in `../ios` (107 µs against 11 µs a view),
  but that session ran on older packages and different hardware, so this one
  doesn't say which of the two made the difference.
- **Memory is within 1 MB on the Pokédex,** and within 4 MB on the 1,500-element
  screens. The 5,000-image screen's PSS is either about 151 or 194 MB in
  both apps, depending on how many sprites had decoded 6 s in.
