/**
 * Dependency versions installed by the `ng add @blotch/angular-lynx` schematic.
 *
 * When a user runs `ng add`, the ng-add schematic transforms their Angular
 * project into a Lynx-native application. These are the pinned versions for
 * every devDependency the schematic adds to the target project's package.json.
 *
 * Keep this map in sync when upgrading any Lynx or build-tooling dependency.
 */
export const VERSIONS = {
  /**
   * @blotch/angular-lynx-build — the `ng build` / `ng serve` / `ng test`
   * builders, with rspeedy, the rsbuild plugin that compiles Angular for Lynx
   * and the native app builder
   */
  angularLynxBuild: '^22.2.1',
  /**
   * @lynx-js/types — TypeScript type definitions for the Lynx runtime APIs
   */
  lynxTypes: '^4.3.0',
  /**
   * tailwindcss — utility-first CSS framework (optional, controlled by the `tailwind` schema option)
   */
  tailwindcss: '^3.4.19',
  /**
   * @lynx-js/tailwind-preset — Lynx-specific Tailwind preset with native design tokens
   */
  tailwindPreset: '^0.6.0',
  /**
   * @blotch/angular-lynx-testing-library — Testing Library utilities for AngularLynx components
   */
  angularLynxTestingLibrary: '^22.2.0',
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
  /**
   * @angular/localize — Angular's runtime i18n / $localize support
   */
  angularLocalize: '^22.2.1',
} as const;
