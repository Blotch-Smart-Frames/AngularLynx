#!/bin/sh
# Builds one benchmark app for a phone, Release, development-signed, and
# prints the path of the .app it built.
#
#   sh build_ios_app.sh <app> <bundle id> [bench screen]
#
#   app          angular-lynx, react-lynx, react-native, react-native-0.88
#                or angular-native (a folder in ../apps)
#   bundle id    what the phone knows it as
#   bench screen e.g. 'mount?kind=view&count=1500': open on that screen
#                instead of the tabs (BENCH_SCREEN in each app's README)
#
# Environment: FIXTURE_ORIGIN (default http://<this Mac's LAN address>:8787)
# and TEAM_ID (default F64LTK85F6). The Expo apps need `expo prebuild` run
# once with the bundle ID first (see their READMEs): prebuild writes it into
# the Xcode project, where a command-line setting would also rename every
# pod's resource bundle.
set -eu
app="$1"
bundle_id="$2"
screen="${3:-}"
here="$(cd "$(dirname "$0")" && pwd)"
dir="$here/../apps/$app"
origin="${FIXTURE_ORIGIN:-http://$(ipconfig getifaddr en0):8787}"
team="${TEAM_ID:-F64LTK85F6}"
log="$(mktemp -t "build-$app")"
cd "$dir"


case "$app" in
  angular-lynx)
    BENCH_SCREEN="$screen" FIXTURE_ORIGIN="$origin" npx ng build --platform ios >"$log" 2>&1
    project=$(ls -d .angular/cache/*/angular-lynx/lynx-native/ios/App.xcodeproj | head -1)
    xcodebuild build -project "$project" -scheme App -configuration Release \
      -sdk iphoneos -destination generic/platform=iOS -derivedDataPath .angular/xcode-device \
      DEVELOPMENT_TEAM="$team" PRODUCT_BUNDLE_IDENTIFIER="$bundle_id" \
      -allowProvisioningUpdates >>"$log" 2>&1
    built=.angular/xcode-device/Build/Products/Release-iphoneos/LaunchPerfAL.app
    ;;
  react-lynx)
    BENCH_SCREEN="$screen" APP_ID="$bundle_id" FIXTURE_ORIGIN="$origin" TEAM_ID="$team" \
      node scripts/build-ios.mjs --project-only >"$log" 2>&1
    xcodebuild build -project build/native/ios/App.xcodeproj -scheme App -configuration Release \
      -destination generic/platform=iOS -derivedDataPath build/work/build/ios-device \
      DEVELOPMENT_TEAM="$team" PRODUCT_BUNDLE_IDENTIFIER="$bundle_id" \
      -allowProvisioningUpdates >>"$log" 2>&1
    built=build/work/build/ios-device/Build/Products/Release-iphoneos/LaunchPerfReactLynx.app
    ;;
  react-native)
    EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
      xcodebuild build -workspace ios/LaunchPerfRN.xcworkspace -scheme LaunchPerfRN \
      -configuration Release -destination generic/platform=iOS -derivedDataPath ios/DerivedData-device \
      IPHONEOS_DEPLOYMENT_TARGET=15.1 DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic \
      -allowProvisioningUpdates >"$log" 2>&1
    built=ios/DerivedData-device/Build/Products/Release-iphoneos/LaunchPerfRN.app
    ;;
  react-native-0.88)
    EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
      xcodebuild build -workspace ios/LaunchPerfRN088.xcworkspace -scheme LaunchPerfRN088 \
      -configuration Release -destination generic/platform=iOS -derivedDataPath ios/DerivedData-device \
      DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates >"$log" 2>&1
    built=ios/DerivedData-device/Build/Products/Release-iphoneos/LaunchPerfRN088.app
    ;;
  angular-native)
    EXPO_PUBLIC_BENCH_SCREEN="$screen" EXPO_PUBLIC_FIXTURE_ORIGIN="$origin" \
      xcodebuild build -workspace ios/LaunchPerfAngularNative.xcworkspace -scheme LaunchPerfAngularNative \
      -configuration Release -sdk iphoneos -destination generic/platform=iOS -derivedDataPath build/ios-device \
      DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates >"$log" 2>&1
    built=build/ios-device/Build/Products/Release-iphoneos/LaunchPerfAngularNative.app
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
