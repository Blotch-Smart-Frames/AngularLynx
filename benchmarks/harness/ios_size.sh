#!/bin/sh
# Prints an iOS app's size two ways: installed (the .app's files, as the
# phone stores them) and as a download (the .app zipped into an .ipa, which
# is roughly what the App Store sends before its own encryption and thinning).
#
#   sh ios_size.sh <name> path/to/App.app >> ../results/ios/size.csv
#
# Pass a Release build for a phone (-sdk iphoneos): simulator builds carry
# other architectures and debug data.
set -eu
name="$1"
app="$2"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/Payload"
cp -R "$app" "$work/Payload/"
installed=$(find "$app" -type f -exec stat -f %z {} + | awk '{s+=$1} END {print s}')
(cd "$work" && zip -qr -9 app.ipa Payload)
download=$(stat -f %z "$work/app.ipa")
echo "$name,$installed,$download"
