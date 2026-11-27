#!/bin/sh
# Builds one benchmark app for a phone, Release, development-signed, or with
# --simulator for the iOS Simulator, Release, unsigned, and prints the path of
# the .app it built.
#
#   sh build_ios_app.sh [--simulator] <app> <bundle id> [bench screen]
#
#   app          angular-lynx, react-lynx, react-native, react-native-0.88
#                or angular-native (a folder in ../apps)
#   bundle id    what the phone knows it as
#   bench screen e.g. 'mount?kind=view&count=1500': open on that screen
#                instead of the tabs (BENCH_SCREEN in each app's README)
#
# Environment: FIXTURE_ORIGIN (default http://<this Mac's LAN address>:8787,
# or http://localhost:8787 for the Simulator, which shares the Mac's network)
# and TEAM_ID (default F64LTK85F6, a phone build's team). The Expo apps need
# `expo prebuild` run once with the bundle ID first (see their READMEs): prebuild writes it into
# the Xcode project, where a command-line setting would also rename every
# pod's resource bundle.
set -eu
simulator=
if [ "${1:-}" = --simulator ]; then
  simulator=1
  shift
fi
app="$1"
bundle_id="$2"
screen="${3:-}"
here="$(cd "$(dirname "$0")" && pwd)"
dir="$here/../apps/$app"
if [ -n "$simulator" ]; then
  origin="${FIXTURE_ORIGIN:-http://localhost:8787}"
else
  origin="${FIXTURE_ORIGIN:-http://$(ipconfig getifaddr en0):8787}"
fi
team="${TEAM_ID:-F64LTK85F6}"
log="$(mktemp -t "build-$app")"
cd "$dir"

# A Simulator build is unsigned and for both Simulator architectures
# (generic/platform=iOS Simulator), like the .app `ng build --platform ios`
# builds itself.
case "$app" in
  angular-lynx)
    if [ -n "$simulator" ]; then
      # The builder's own simulator .app, with the bundle ID set where the
      # builder takes it, so nothing renames it after the build.
      BENCH_SCREEN="$screen" FIXTURE_ORIGIN="$origin" npx ng build --platform ios --app-id "$bundle_id" >"$log" 2>&1
      built=dist/ios/LaunchPerfAL-simulator.app
    else
      BENCH_SCREEN="$screen" FIXTURE_ORIGIN="$origin" npx ng build --platform ios >"$log" 2>&1
      # The builder writes the project into Angular's cache folder, which is
      # named for @angular/build's version (its normalize-cache.js), so a
      # checkout that has built on an older Angular keeps a project per
      # version, each with the bundle it was last built with. Take the one
      # this ng build used: neither the first one listed nor the newest is it,
      # because the builder only copies a new bundle into a project whose
      # inputs haven't changed, leaving the project's own date as it was.
      version=$(node -p "require('@angular/build/package.json').version")
      project=.angular/cache/$version/angular-lynx/lynx-native/ios/App.xcodeproj
      if [ ! -d "$project" ]; then
        echo "ng build wrote no project at $project" >&2
        exit 1
      fi
      xcodebuild build -project "$project" -scheme App -configuration Release \
        -sdk iphoneos -destination generic/platform=iOS -derivedDataPath .angular/xcode-device \
        DEVELOPMENT_TEAM="$team" PRODUCT_BUNDLE_IDENTIFIER="$bundle_id" \
        -allowProvisioningUpdates >>"$log" 2>&1
      built=.angular/xcode-device/Build/Products/Release-iphoneos/LaunchPerfAL.app
    fi
    ;;
  react-lynx)
    if [ -n "$simulator" ]; then
      # build-ios.mjs builds the Release simulator .app itself.
      BENCH_SCREEN="$screen" APP_ID="$bundle_id" FIXTURE_ORIGIN="$origin" \
        node scripts/build-ios.mjs >"$log" 2>&1
      built="build/ios/$bundle_id/LaunchPerfReactLynx-simulator.app"
    else
      BENCH_SCREEN="$screen" APP_ID="$bundle_id" FIXTURE_ORIGIN="$origin" TEAM_ID="$team" \
        node scripts/build-ios.mjs --project-only >"$log" 2>&1
      xcodebuild build -project build/native/ios/App.xcodeproj -scheme App -configuration Release \
        -destination generic/platform=iOS -derivedDataPath build/work/build/ios-device \
        DEVELOPMENT_TEAM="$team" PRODUCT_BUNDLE_IDENTIFIER="$bundle_id" \
        -allowProvisioningUpdates >>"$log" 2>&1
      built=build/work/build/ios-device/Build/Products/Release-iphoneos/LaunchPerfReactLynx.app
    fi
    ;;
  react-native)
    if [ -n "$simulator" ]; then
      EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
        xcodebuild build -workspace ios/LaunchPerfRN.xcworkspace -scheme LaunchPerfRN \
        -configuration Release -sdk iphonesimulator -destination "generic/platform=iOS Simulator" \
        -derivedDataPath ios/DerivedData-simulator IPHONEOS_DEPLOYMENT_TARGET=15.1 CODE_SIGNING_ALLOWED=NO >"$log" 2>&1
      built=ios/DerivedData-simulator/Build/Products/Release-iphonesimulator/LaunchPerfRN.app
    else
      EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
        xcodebuild build -workspace ios/LaunchPerfRN.xcworkspace -scheme LaunchPerfRN \
        -configuration Release -destination generic/platform=iOS -derivedDataPath ios/DerivedData-device \
        IPHONEOS_DEPLOYMENT_TARGET=15.1 DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic \
        -allowProvisioningUpdates >"$log" 2>&1
      built=ios/DerivedData-device/Build/Products/Release-iphoneos/LaunchPerfRN.app
    fi
    ;;
  react-native-0.88)
    if [ -n "$simulator" ]; then
      EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
        xcodebuild build -workspace ios/LaunchPerfRN088.xcworkspace -scheme LaunchPerfRN088 \
        -configuration Release -sdk iphonesimulator -destination "generic/platform=iOS Simulator" \
        -derivedDataPath ios/DerivedData-simulator CODE_SIGNING_ALLOWED=NO >"$log" 2>&1
      built=ios/DerivedData-simulator/Build/Products/Release-iphonesimulator/LaunchPerfRN088.app
    else
      EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
        xcodebuild build -workspace ios/LaunchPerfRN088.xcworkspace -scheme LaunchPerfRN088 \
        -configuration Release -destination generic/platform=iOS -derivedDataPath ios/DerivedData-device \
        DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates >"$log" 2>&1
      built=ios/DerivedData-device/Build/Products/Release-iphoneos/LaunchPerfRN088.app
    fi
    ;;
  angular-native)
    if [ -n "$simulator" ]; then
      EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
        xcodebuild build -workspace ios/LaunchPerfAngularNative.xcworkspace -scheme LaunchPerfAngularNative \
        -configuration Release -sdk iphonesimulator -destination "generic/platform=iOS Simulator" \
        -derivedDataPath build/ios-simulator CODE_SIGNING_ALLOWED=NO >"$log" 2>&1
      built=build/ios-simulator/Build/Products/Release-iphonesimulator/LaunchPerfAngularNative.app
    else
      EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
        xcodebuild build -workspace ios/LaunchPerfAngularNative.xcworkspace -scheme LaunchPerfAngularNative \
        -configuration Release -sdk iphoneos -destination generic/platform=iOS -derivedDataPath build/ios-device \
        DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates >"$log" 2>&1
      built=build/ios-device/Build/Products/Release-iphoneos/LaunchPerfAngularNative.app
    fi
    ;;
  *)
    echo "Unknown app: $app" >&2
    exit 1
    ;;
esac
id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$built/Info.plist")
if [ "$id" != "$bundle_id" ]; then
  echo "$app built as $id, not $bundle_id: run expo prebuild with BENCH_BUNDLE_ID / BUNDLE_ID first" >&2
  exit 1
fi
rm -f "$log"
echo "$dir/$built"
