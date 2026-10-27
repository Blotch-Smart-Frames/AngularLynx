import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Versions of the third-party packages the `ng add @blotch/angular-lynx`
 * schematics install: the ones AngularLynx is tested with.
 *
 * Keep this map in sync when upgrading any Lynx or build-tooling dependency.
 * It lists none of our own packages or Angular's: those come from
 * {@link ownVersionRange} and the app's own `@angular/core`, so they can't go
 * stale.
 */
export const VERSIONS = {
  /**
   * @lynx-js/types — TypeScript type definitions for the Lynx runtime APIs
   */
  lynxTypes: '^4.3.0',
  /**
   * tailwindcss and @tailwindcss/postcss, for Tailwind CSS 4: the default when
   * the `tailwind` schema option is on. The build plugin rewrites what it
   * writes into CSS Lynx reads.
   */
  tailwindcss4: '^4.3.3',
  /**
   * tailwindcss, for Tailwind CSS 3 (`--tailwind-version=3`)
   */
  tailwindcss: '^3.4.19',
  /**
   * @lynx-js/tailwind-preset — Lynx's preset for Tailwind CSS 3
   */
  tailwindPreset: '^0.6.0',
  /**
   * vitest — fast unit test runner powered by Vite. Only added when the
   * project has none; `ng new` already adds it.
   */
  vitest: '^5.0.0',
  /**
   * jsdom — DOM environment for running component tests. Only added when the
   * project has none; `ng new` already adds it.
   */
  jsdom: '^30.0.0',
} as const;

/**
 * The range the schematics install our other packages at
 * (@blotch/angular-lynx-build, the testing library): the version of
 * @blotch/angular-lynx they shipped in. Every package is released at one
 * version (see packages/release), so a range written out here would go stale
 * at each release unless someone remembered to move it, as `^22.2.1` nearly
 * shipped in 22.2.2. The E2E tests check that a new app gets this range.
 *
 * `../../package.json` is the runtime's package.json both in the repository
 * and in the published package, where ng-packagr copies it into dist/ beside
 * the schematics. (`../package.json` is schematics/package.json, which only
 * marks the schematics as CommonJS.)
 */
export const ownVersionRange = (): string => {
  const { version } = JSON.parse(
    readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
  ) as { version: string };
  return `^${version}`;
};
