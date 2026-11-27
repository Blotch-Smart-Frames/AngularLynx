#!/bin/sh
# Builds one benchmark app's release .apk for Android and prints its path.
#
#   sh build_android_app.sh <app> <application id> [bench screen]
#
#   app             angular-lynx or react-lynx (a folder in ../apps)
#   application id  what the device knows it as
#   bench screen    e.g. 'mount?kind=view&count=1500': open on that screen
#                   instead of the tabs (BENCH_SCREEN in each app's README)
#
# Environment: FIXTURE_ORIGIN (default http://localhost:8787). Both Lynx
# shells let plain HTTP reach only localhost, and the harness points the
# device's localhost:8787 at the Mac's with `adb reverse`, so the same .apk
# works on an emulator and on a phone over USB.
#
# Each .apk is the release build, R8-minified and signed with the debug key,
# as `ng build --platform android` builds an app without android.signing.
# The Expo apps aren't built for Android yet (issue #842).
set -eu
app="$1"
app_id="$2"
screen="${3:-}"
here="$(cd "$(dirname "$0")" && pwd)"
dir="$here/../apps/$app"
origin="${FIXTURE_ORIGIN:-http://localhost:8787}"
log="$(mktemp -t "build-android-$app")"
cd "$dir"
failed() {
  echo "Building $app for Android failed: see $log" >&2
  exit 1
}

case "$app" in
  angular-lynx)
    BENCH_SCREEN="$screen" FIXTURE_ORIGIN="$origin" \
      npx ng build --platform android --app-id "$app_id" >"$log" 2>&1 || failed
    built=dist/android/launchperfal.apk
    ;;
  react-lynx)
    BENCH_SCREEN="$screen" APP_ID="$app_id" FIXTURE_ORIGIN="$origin" \
      node scripts/build-android.mjs >"$log" 2>&1 || failed
    built="build/android/$app_id/launchperfreactlynx.apk"
    ;;
  *)
    echo "No Android build for $app yet: angular-lynx and react-lynx only (issue #842)" >&2
    exit 1
    ;;
esac
if [ ! -f "$built" ]; then
  echo "$app built no $built: see $log" >&2
  exit 1
fi
rm -f "$log"
echo "$dir/$built"
