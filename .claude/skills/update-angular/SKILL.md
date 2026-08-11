---
name: update-angular
description: Update Angular across the entire monorepo to a new major version. Use when the user says "update angular", "upgrade angular", "bump angular version", "angular 22", "angular 23", or wants to migrate to a newer Angular release.
invocationControl: user
---

# Update Angular

Update all Angular packages across the monorepo to a new major version. Covers the 3 published packages, 71+ examples, and the kitchen-sink-app.

## Gather version targets

Before starting, determine the following values. Check the [Angular compatibility matrix](https://angular.dev/reference/versions) and ask the user to confirm:

- **TARGET_MAJOR** — target major version number (e.g., `22`)
- **TARGET_RANGE** — caret range for Angular deps (e.g., `^22.0.0`)
- **TARGET_TS** — TypeScript version for most packages (e.g., `~5.10.0`)
- **TARGET_TS_PLUGIN** — TypeScript version for rsbuild-plugin (may be newer, e.g., `^6.1.0`)
- **OLD_MAJOR** — current major version being upgraded from (e.g., `21`)

Use these as substitution variables throughout the steps below.

## Steps

Run sequentially. Stop and report on any failure before continuing.

### 1. Pre-flight checks

```sh
git status --short
npm ls @angular/core --depth=0 2>/dev/null | head -5
```

Warn the user if the working tree is dirty. Report current Angular version.

### 2. Research breaking changes

Check the Angular blog, changelog, and update guide for breaking changes in TARGET_MAJOR. Pay attention to:
- Removed/deprecated APIs (especially Renderer2, signals, forms, router)
- TypeScript version requirements
- Node.js version requirements
- New required peer dependencies
- Changes to `@angular/build` or `@angular-devkit/build-angular`

Summarize anything relevant to this monorepo for the user.

### 3. Update published package versions

Set `"version": "TARGET_MAJOR.0.0"` in:
- `packages/runtime/package.json`
- `packages/rsbuild-plugin-angular-lynx/package.json`
- `packages/testing-library/package.json`
- `packages/create-angular-lynx/package.json`

### 4. Update peer dependencies

**`packages/runtime/package.json`** peerDependencies — set all `@angular/*` entries to TARGET_RANGE:
- `@angular/common`, `@angular/core`, `@angular/forms`, `@angular/localize`, `@angular/platform-browser`, `@angular/router`

**`packages/rsbuild-plugin-angular-lynx/package.json`** peerDependencies:
- `@angular-devkit/build-angular`, `@angular-devkit/core`, `@angular/build`, `@angular/localize` → TARGET_RANGE

**`packages/testing-library/package.json`** peerDependencies:
- `@angular/compiler`, `@angular/core`, `@angular/platform-browser` → TARGET_RANGE
- `@blotch/angular-lynx` → TARGET_RANGE

### 5. Update dev dependencies in published packages

**`packages/runtime/package.json`** devDependencies:
- All `@angular/*`, `@angular-devkit/*`, `@schematics/angular`, `ng-packagr` → TARGET_RANGE
- `typescript` → TARGET_TS

**`packages/rsbuild-plugin-angular-lynx/package.json`** devDependencies:
- All `@angular-devkit/*`, `@angular/build` → TARGET_RANGE
- `typescript` → TARGET_TS_PLUGIN

**`packages/testing-library/package.json`** devDependencies:
- All `@angular/*` → TARGET_RANGE
- `typescript` → TARGET_TS

### 6. Update schematic versions file

Edit `packages/runtime/schematics/ng-add/versions.ts`:
- `angularLynxTestingLibrary` → `'TARGET_RANGE'`
- `angularLocalize` → `'TARGET_RANGE'`
- Also check if `rsbuildPluginAngularLynx` version needs updating

### 7. Update kitchen-sink-app

Update `packages/kitchen-sink-app/package.json`:
- All `@angular/*` dependencies and devDependencies → TARGET_RANGE
- `@angular-devkit/build-angular` → TARGET_RANGE
- `typescript` → TARGET_TS
- Check `zone.js` and `rxjs` against Angular's compatibility matrix

### 8. Bulk-update all examples

```sh
find examples -name "package.json" -not -path "*/node_modules/*" -exec sed -i '' 's/"\^OLD_MAJOR\.0\.0"/"\^TARGET_MAJOR\.0\.0"/g' {} \;
```

Then update TypeScript in examples:

```sh
find examples -name "package.json" -not -path "*/node_modules/*" -exec sed -i '' 's/"typescript": "~CURRENT_TS"/"typescript": "TARGET_TS"/g' {} \;
```

Spot-check 2-3 example `package.json` files to confirm the substitution worked.

### 9. Update create-example skill template

Edit `.claude/skills/create-example/SKILL.md` — update the embedded `package.json` template to use TARGET_RANGE for all `@angular/*` and `@angular-devkit/*` entries.

### 10. Install dependencies

```sh
npm install
```

If peer dependency conflicts occur:
1. Identify which package is behind
2. Update its version to TARGET_RANGE
3. Re-run `npm install`

Do NOT use `--legacy-peer-deps` unless absolutely necessary as a temporary workaround.

### 11. Run Angular migrations

If Angular ships code migrations for TARGET_MAJOR, run them:

```sh
cd packages/kitchen-sink-app && npx ng update @angular/core@TARGET_MAJOR @angular/cli@TARGET_MAJOR --allow-dirty && cd ../..
```

Review the migration changes. If they affect patterns used in the runtime or testing-library source code, apply the same transformations there.

### 12. Build

```sh
npm run build
```

Fix any errors. Common causes:
- Removed APIs in the new Angular version
- TypeScript strictness changes
- ng-packagr version mismatch

### 13. Test

```sh
npm run test
```

Fix any failures.

### 14. Lint and format

```sh
npm run format:check && npm run lint && npm run cspell
```

Fix any issues.

### 15. Final verification

Confirm no stale version references remain:

```sh
grep -r "\^OLD_MAJOR\.0\.0" --include="package.json" . | grep -v node_modules
```

This should return no results.

## After running

Summarize as a checklist:

```
Angular update: OLD_MAJOR → TARGET_MAJOR

- [x] Published package versions → TARGET_MAJOR.0.0
- [x] Peer dependencies → TARGET_RANGE
- [x] Dev dependencies updated
- [x] Schematic versions.ts updated
- [x] kitchen-sink-app updated
- [x] All examples bulk-updated
- [x] create-example skill template updated
- [x] npm install succeeded
- [x] Angular migrations applied
- [x] Build passes
- [x] Tests pass
- [x] Lint/format/cspell pass
- [x] No stale version references
```

Remind the user:
1. Review the diff before committing
2. Release is triggered by: `git tag vTARGET_MAJOR.0.0 && git push origin vTARGET_MAJOR.0.0`
3. Test on-device if possible (kitchen-sink-app on iPhone)

## Common issues

| Problem | Solution |
|---------|----------|
| Peer dep conflict on `npm install` | Find which package is behind and bump it to TARGET_RANGE |
| TypeScript version mismatch | rsbuild-plugin may need TARGET_TS_PLUGIN (newer than runtime) |
| `ng-packagr` incompatible | Bump to TARGET_RANGE in runtime devDeps |
| Example builds fail | Usually a missing dep or new required peer — check error output |
| Angular migration fails | Run with `--force` or apply the migration pattern manually |
| `@angular/build` not found | Ensure rsbuild-plugin devDeps include it at TARGET_RANGE |
| `zone.js` incompatible | Check Angular's compatibility matrix for the required version |
