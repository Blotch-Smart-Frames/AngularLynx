# Android emulator runs

AngularLynx against ReactLynx on an Android emulator, from
`harness/android_launch.py` and `harness/android_mount.py`. The website
doesn't chart these, since an emulator's numbers aren't a phone's (see
"On an Android emulator" in `../../README.md`). Within a session they
compare.

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

| | AngularLynx | ReactLynx |
| --- | --- | --- |
| Pokédex first frame | 289 ms | 300 ms |
| Pokédex fully drawn | 289 ms | 332 ms |
| Pokédex memory (PSS, 6 s in) | 59.0 MB | 58.5 MB |
| Per `view` | 57 µs | 30 µs |
| Per `text` | 95 µs | 50 µs |
| Per `image` | 73 µs | 22 µs |

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
