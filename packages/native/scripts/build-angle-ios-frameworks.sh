#!/bin/bash
# Builds ANGLE for iOS as libEGL and libGLESv2 XCFrameworks: the OpenGL ES 3.0
# on Metal that the iOS shell's <canvas> draws its WebGL with
# (templates/ios/App/AngularLynxWebGLContext.m).
#
# The shell used iOS's own OpenGL ES, which Apple deprecated in iOS 12 and the
# Simulator runs on the CPU: a lit three.js scene took seconds a frame there
# (issue #238). ANGLE's Metal backend draws on the GPU on a phone and in the
# Simulator alike, and is what Safari draws WebGL with.
#
# ANGLE builds only with Chromium's tooling (depot_tools, gclient, GN and
# Ninja), so it's compiled once here and shipped with Lynx's frameworks:
# build-lynx-ios-frameworks.sh runs this and puts what it makes in the same
# zip. Run it alone to try a new ANGLE revision:
#
#   scripts/build-angle-ios-frameworks.sh [work-dir]
#
# It writes <work-dir>/out/{libEGL,libGLESv2}.xcframework, ANGLE/ (its headers
# and license, for the shell to compile against) and dSYMs/. The checkout
# takes about 5 GB, most of it Chromium's clang and Rust toolchains, and the
# three builds about a minute and a half together on an M5 Pro.
#
# Needs Xcode with its Metal toolchain (which the script downloads if it's
# missing) and Python 3; depot_tools brings the rest (Chromium's clang, GN and
# Ninja).
set -euo pipefail

# The ANGLE that Chrome 158 shipped (chromium/8127), so the revision is one
# Chrome tested on Metal. To move to a newer one, take the `angle` hash of a
# Chrome stable release from https://chromiumdash.appspot.com/releases.
ANGLE_REVISION=a9d273575638975f4f31aff9523c5194f36ecb61
# The shell's deployment target (deploymentTarget in generate-ios-project.ts).
IOS_DEPLOYMENT_TARGET=15.0
# What the frameworks link: just the Metal backend. ANGLE's other backends
# (Vulkan, desktop GL, SwiftShader), its tests and its capture tools would
# only add size.
GN_ARGS='
is_debug = false
is_component_build = false
symbol_level = 1
enable_dsyms = true
ios_enable_code_signing = false
treat_warnings_as_errors = false
angle_build_tests = false
angle_enable_metal = true
angle_enable_gl = false
angle_enable_vulkan = false
angle_enable_swiftshader = false
angle_enable_null = false
angle_enable_wgpu = false
angle_enable_perfetto = false
angle_has_frame_capture = false
angle_has_histograms = false
'
# ANGLE's DEPS checks these out whatever the GN args, for its tests and its
# other backends; none of the Metal build reads them, and together they're
# about 8 GB.
SKIPPED_DEPS=(
  third_party/VK-GL-CTS/src
  third_party/SwiftShader
  third_party/dawn
  third_party/llvm/src
  third_party/catapult
  third_party/perfetto
  third_party/OpenGL-Registry/src
)

here="$(cd "$(dirname "$0")" && pwd)"
work="${1:-$here/../.angle-ios-build}"
mkdir -p "$work"
work="$(cd "$work" && pwd)"
cd "$work"

if [ ! -d depot_tools ]; then
  git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git
fi
export PATH="$work/depot_tools:$PATH"
# depot_tools updates itself on every run otherwise, so two builds of the
# same revision could use different tools.
export DEPOT_TOOLS_UPDATE=0

# The ANGLE solution, with iOS's dependencies. --no-history keeps the
# checkout to the pinned revisions. A dep's name has the solution's folder in
# front (ANGLE's DEPS uses relative paths).
skipped=''
for dep in "${SKIPPED_DEPS[@]}"; do
  skipped="$skipped    \"angle/$dep\": None,
"
done
cat > .gclient <<EOF
solutions = [{
  "name": "angle",
  "url": "https://chromium.googlesource.com/angle/angle.git@$ANGLE_REVISION",
  "deps_file": "DEPS",
  "managed": False,
  "custom_deps": {
$skipped  },
}]
target_os = ["ios"]
EOF
# Its hooks download toolchains in parallel, and with many jobs two of them
# can race for the same download lock.
gclient sync --no-history --shallow --force --reset -j 4

# ANGLE copies, clears and converts formats with Metal shaders of its own.
# Unless they're prebuilt, it compiles them from source when the display
# starts: 5.7 s of the UI thread on an app's first launch in the Simulator
# (Metal caches them for the launches after). Building them ahead of time
# takes the Metal toolchain, which Xcode 26 and later download separately,
# and angle_metal_toolchain_dir, whose `metal` and `metallib` ANGLE runs
# without an SDK. So each environment gets wrappers that pick its SDK; the
# Simulator's also turns ANGLE's -mios-version-min into
# -mios-simulator-version-min, without which the shaders target devices.
xcrun metal --version > /dev/null 2>&1 || xcodebuild -downloadComponent MetalToolchain
for environment in device simulator; do
  sdk=iphoneos
  [ "$environment" = simulator ] && sdk=iphonesimulator
  tools="$work/metal-tools/$environment"
  mkdir -p "$tools"
  cat > "$tools/metal" <<EOF
#!/bin/bash
args=()
for arg in "\$@"; do
  if [ "$environment" = simulator ] && [[ \$arg == -mios-version-min=* ]]; then
    arg="-mios-simulator-version-min=\${arg#*=}"
  fi
  args+=("\$arg")
done
exec xcrun -sdk $sdk metal "\${args[@]}"
EOF
  printf '#!/bin/bash\nexec xcrun -sdk %s metallib "$@"\n' "$sdk" > "$tools/metallib"
  chmod +x "$tools/metal" "$tools/metallib"
done

cd angle
# One build per slice: the device, and the Simulator on Apple silicon and on
# Intel Macs, which share one XCFramework slice (as Lynx's do).
slices=(
  'ios-arm64 arm64 device'
  'ios-arm64-simulator arm64 simulator'
  'ios-x64-simulator x64 simulator'
)
for slice in "${slices[@]}"; do
  read -r name cpu environment <<< "$slice"
  echo "Building ANGLE for $name"
  gn gen "out/$name" --args="$GN_ARGS
target_os = \"ios\"
target_cpu = \"$cpu\"
target_environment = \"$environment\"
ios_deployment_target = \"$IOS_DEPLOYMENT_TARGET\"
angle_metal_toolchain_dir = \"$work/metal-tools/$environment\""
  ninja -C "out/$name" libEGL libGLESv2 > "$work/build-$name.log" 2>&1 ||
    { tail -50 "$work/build-$name.log"; exit 1; }
done

out="$work/out"
rm -rf "${out:?}"
mkdir -p "$out/dSYMs" "$out/ANGLE"
for library in libEGL libGLESv2; do
  device="out/ios-arm64/$library.framework"
  simulator="$work/simulator/$library.framework"
  # The two Simulator builds, as one framework with both architectures.
  rm -rf "${simulator:?}"
  mkdir -p "$work/simulator"
  cp -R "out/ios-arm64-simulator/$library.framework" "$simulator"
  lipo -create "out/ios-arm64-simulator/$library.framework/$library" \
    "out/ios-x64-simulator/$library.framework/$library" -output "$simulator/$library"
  # App Store validation wants a version in every embedded framework's
  # Info.plist, which ANGLE's leaves out. The bundle ID and minimum iOS are
  # set too, rather than left to Chromium's build defaults.
  for framework in "$device" "$simulator"; do
    plist="$framework/Info.plist"
    /usr/libexec/PlistBuddy -c "Delete :CFBundleIdentifier" "$plist" 2> /dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string org.chromium.angle.$library" "$plist"
    for key in CFBundleShortVersionString MinimumOSVersion; do
      /usr/libexec/PlistBuddy -c "Delete :$key" "$plist" 2> /dev/null || true
    done
    /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 1.0" "$plist"
    /usr/libexec/PlistBuddy -c "Add :MinimumOSVersion string $IOS_DEPLOYMENT_TARGET" "$plist"
  done
  xcodebuild -create-xcframework -framework "$PWD/$device" -framework "$simulator" \
    -output "$out/$library.xcframework" > /dev/null
  for slice in "${slices[@]}"; do
    read -r name _ <<< "$slice"
    mkdir -p "$out/dSYMs/$name"
    cp -R "out/$name/$library.dSYM" "$out/dSYMs/$name/"
  done
done

# The headers the shell compiles against: EGL with ANGLE's extensions, and
# OpenGL ES 3.0. HEADER_SEARCH_PATHS in generate-ios-project.ts points here.
mkdir -p "$out/ANGLE/include"
cp -R include/EGL include/GLES2 include/GLES3 include/KHR "$out/ANGLE/include/"
cp LICENSE "$out/ANGLE/LICENSE"
echo "$ANGLE_REVISION" > "$out/ANGLE/REVISION"
du -sh "$out"/*.xcframework
