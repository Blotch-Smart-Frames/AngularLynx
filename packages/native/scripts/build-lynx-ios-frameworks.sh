#!/bin/bash
# Builds Lynx for iOS as prebuilt XCFrameworks, so users never compile Lynx's
# C++ or install CocoaPods.
#
# Lynx only publishes iOS source pods (the zips on its GitHub releases), so we
# compile them once here, with CocoaPods, for device and simulator, then wrap
# each pod's dynamic framework in an XCFramework. CI runs this per Lynx version
# and uploads the zip it prints to a GitHub release; LYNX_IOS in
# src/ios/frameworks.ts pins that zip's URL and SHA-256.
#
#   scripts/build-lynx-ios-frameworks.sh [work-dir]
#
# Needs Xcode, Node 22.18+ with the repository's dependencies installed
# (`npm ci`), and Ruby >= 2.7 with Bundler (macOS's own Ruby 2.6 is too old).
set -euo pipefail

LYNX_VERSION=4.1.0
PRIMJS_VERSION=4.1.1
SDWEBIMAGE_VERSION=5.15.5
SDWEBIMAGE_WEBP_VERSION=0.11.0

here="$(cd "$(dirname "$0")" && pwd)"
# Every framework the shell links: LYNX_IOS_FRAMEWORKS, the same list the
# template project and the builder use.
read -ra FRAMEWORKS <<< "$(node --input-type=module -e "
  const { LYNX_IOS_FRAMEWORKS } = await import('$here/../src/ios/frameworks.ts');
  console.log(LYNX_IOS_FRAMEWORKS.join(' '));
")"
work="${1:-$here/../.lynx-ios-build}"
mkdir -p "$work/Host"
work="$(cd "$work" && pwd)"
cd "$work"

specs=https://raw.githubusercontent.com/lynx-family/Specs/master

# CocoaPods needs a host app target to install into. It is never shipped.
# HOST_PROJECT in generate-ios-project.ts describes it.
node "$here/generate-ios-project.ts" --host "$work"
echo 'import UIKit
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, nil)' > Host/main.swift

cat > Gemfile <<'EOF'
source 'https://rubygems.org'
gem 'cocoapods', '1.16.2'
EOF

cat > Podfile <<EOF
platform :ios, '15.0'
source 'https://cdn.cocoapods.org/'
# Dynamic frameworks carry their own resources (Lynx.framework holds
# LynxResources.bundle with lynx_core.js) and link their own dependencies, so
# the shell only has to embed them.
use_frameworks! :linkage => :dynamic
# Lynx builds with -Werror, and each new Xcode adds warnings.
inhibit_all_warnings!

target 'Host' do
  pod 'LynxServiceAPI', :podspec => '$specs/LynxServiceAPI/$LYNX_VERSION/LynxServiceAPI.podspec.json'
  pod 'LynxBase', :podspec => '$specs/LynxBase/$LYNX_VERSION/LynxBase.podspec.json'
  pod 'Lynx', :podspec => '$specs/Lynx/$LYNX_VERSION/Lynx.podspec.json', :subspecs => ['Framework']
  pod 'PrimJS', '$PRIMJS_VERSION', :subspecs => ['quickjs', 'napi']
  pod 'LynxService', :podspec => '$specs/LynxService/$LYNX_VERSION/LynxService.podspec.json', :subspecs => ['Image', 'Log', 'Http']
  pod 'SDWebImage', '$SDWEBIMAGE_VERSION'
  pod 'SDWebImageWebPCoder', '$SDWEBIMAGE_WEBP_VERSION'
end

post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      # Pods declare iOS 9-12, which current Xcode no longer builds for.
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
    end
  end
end
EOF

bundle config set --local path vendor/bundle
bundle install --quiet
bundle exec pod install

products="$work/dd/Build/Products"
for sdk in iphoneos iphonesimulator; do
  destination="generic/platform=iOS"
  [ "$sdk" = iphonesimulator ] && destination="generic/platform=iOS Simulator"
  echo "Building for $sdk"
  xcodebuild build -workspace Host.xcworkspace -scheme Host -configuration Release \
    -sdk "$sdk" -destination "$destination" -derivedDataPath dd \
    CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=NO DEBUG_INFORMATION_FORMAT=dwarf-with-dsym \
    > "build-$sdk.log" 2>&1 || { tail -50 "build-$sdk.log"; exit 1; }
done

out="$work/out/LynxFrameworks"
symbols="$work/out/dSYMs"
rm -rf "$work/out"
mkdir -p "$out" "$symbols"
for name in "${FRAMEWORKS[@]}"; do
  args=()
  for sdk in iphoneos iphonesimulator; do
    framework="$products/Release-$sdk/$name/$name.framework"
    [ -d "$framework" ] || { echo "Missing $framework"; exit 1; }
    args+=(-framework "$framework")
    # Debug symbols are 90% of the size (800 MB for Lynx alone), so they go
    # in a separate zip for symbolicating crash reports, not in the one every
    # build downloads.
    mkdir -p "$symbols/$sdk"
    cp -R "$framework.dSYM" "$symbols/$sdk/"
  done
  xcodebuild -create-xcframework "${args[@]}" -output "$out/$name.xcframework" > /dev/null
done

cat > "$out/VERSIONS" <<EOF
lynx=$LYNX_VERSION
primjs=$PRIMJS_VERSION
sdwebimage=$SDWEBIMAGE_VERSION
sdwebimage-webp=$SDWEBIMAGE_WEBP_VERSION
xcode=$(xcodebuild -version | head -1 | cut -d' ' -f2)
EOF

zip_file="$work/out/lynx-ios-$LYNX_VERSION.zip"
symbols_zip="$work/out/lynx-ios-$LYNX_VERSION-dSYMs.zip"
# --symlinks keeps the framework bundles' internal links intact.
(cd "$work/out" && zip -qry --symlinks "$zip_file" LynxFrameworks && zip -qry "$symbols_zip" dSYMs)
shasum -a 256 "$zip_file" "$symbols_zip"
