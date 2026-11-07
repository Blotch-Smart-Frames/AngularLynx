#!/usr/bin/env bash
# Opens an issue when npm's latest @angular/core is on a newer major.minor
# than package-lock.json holds, once per Angular release. angular-release.yml
# runs it daily. To run it by hand: DRY_RUN=1 prints the issue instead of
# opening it, and ANGULAR_LATEST=23.0.0 stands in for a release that hasn't
# happened. Needs gh (signed in, or GH_TOKEN set), jq and npm.
#
# Why an issue, when Dependabot already brings every Angular minor: the
# published packages are versioned after Angular's major.minor (22.2.x for
# Angular 22.2), with peer ranges to match, so a new minor is a release of
# this repository, not a dependency bump. And the rsbuild plugin imports and
# patches @angular/build's internals, which a minor can reshape (22.2 did),
# so the bump can need code. Dependabot's weekly group PR says neither.
set -euo pipefail

latest="${ANGULAR_LATEST:-$(npm view @angular/core dist-tags.latest)}"
current="$(jq -r '.packages["node_modules/@angular/core"].version' package-lock.json)"
published="$(jq -r '.packages["packages/runtime"].version' package-lock.json)"

IFS=. read -r latest_major latest_minor _ <<<"$latest"
IFS=. read -r current_major current_minor _ <<<"$current"
line="$latest_major.$latest_minor"

# Echo to the log and, under GitHub Actions, to the run's summary page, so the
# outcome shows without opening the log.
say() {
  echo "$*"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "$*" >>"$GITHUB_STEP_SUMMARY"
  fi
}

if ((latest_major < current_major || (latest_major == current_major && latest_minor <= current_minor))); then
  say "Angular $latest is the latest release, and this repository is on $current: nothing to do."
  exit 0
fi

# The issue carries its Angular line in an HTML comment, invisible on GitHub,
# and that is what this looks for rather than the title: a retitled issue
# would otherwise get a twin. Closed issues count too, so closing one as
# not-now stays closed.
marker="<!-- angular-release: $line -->"
existing="$(gh issue list --label angular-release --state all --limit 100 --json number,body \
  --jq "map(select(.body | contains(\"$marker\"))) | .[].number" | head -n1)"
if [[ -n "$existing" ]]; then
  say "Angular $line already has issue #$existing."
  exit 0
fi

# npm records when each version was published. Empty for a version that
# doesn't exist, such as an ANGULAR_LATEST that stands in for a future one.
published_at="$(npm view @angular/core time --json | jq -r --arg v "$latest" '.[$v] // empty')"
reached_npm="reached npm"
if [[ -n "$published_at" ]]; then
  reached_npm="reached npm on ${published_at%%T*}"
fi

title="Update Angular to $line"
body="$marker
Angular $latest $reached_npm. This repository is on $current, and the published packages are $published: their version follows Angular's major.minor, so this is a release of AngularLynx, not only a dependency bump.

- [angular/angular v$latest](https://github.com/angular/angular/releases/tag/v$latest)
- [angular/angular-cli v$latest](https://github.com/angular/angular-cli/releases/tag/v$latest)
"
if ((latest_major > current_major)); then
  body+="
A major: run the \`update-angular\` skill, which carries the packages, the ~100 examples, the peer ranges, Dependabot's architect bound and the docs across together. Dependabot ignores Angular majors on purpose."
else
  body+="
What a minor takes, going by 22.2:

- [ ] Move every \`@angular/*\` range in the published packages, the kitchen sink and the examples, and the published packages' peer ranges, to \`^$line.0\`. Dependabot's weekly group brings the bump itself, but leaves the peer ranges alone.
- [ ] Check the rsbuild plugin against \`@angular/build\` $line: it imports and patches that package's internals, which 22.2 reshaped.
- [ ] \`npm run set-version $line.0\`, then release."
fi

if [[ -n "${DRY_RUN:-}" ]]; then
  say "Dry run: would open \"$title\"."
  printf '\n%s\n' "$body"
  exit 0
fi

# Leave the label's color and description alone when it exists, so edits
# made on GitHub stick.
gh label create angular-release --color 0E8A16 \
  --description "A newer Angular major or minor than this repository is on" 2>/dev/null || true
url="$(gh issue create --title "$title" --label angular-release --body "$body")"
say "Opened $url for Angular $line."
