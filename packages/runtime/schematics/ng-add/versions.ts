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
   * @blotch/rsbuild-plugin-angular-lynx — Rsbuild plugin that compiles Angular for Lynx
   */
  rsbuildPluginAngularLynx: '^0.0.1',
  /**
   * @lynx-js/rspeedy — Lynx dev-server and production build tool
   */
  rspeedy: '^0.14.3',
  /**
   * @lynx-js/qrcode-rsbuild-plugin — generates a QR code in dev mode for on-device testing
   */
  qrcodePlugin: '^0.4.6',
  /**
   * @lynx-js/types — TypeScript type definitions for the Lynx runtime APIs
   */
  lynxTypes: '^3.8.0',
  /**
   * tailwindcss — utility-first CSS framework (optional, controlled by the `tailwind` schema option)
   */
  tailwindcss: '^3.4.19',
  /**
   * @lynx-js/tailwind-preset — Lynx-specific Tailwind preset with native design tokens
   */
  tailwindPreset: '^0.4.0',
  /**
   * @blotch/angular-lynx-testing-library — Testing Library utilities for AngularLynx components
   */
  angularLynxTestingLibrary: '^22.0.0',
  /**
   * vitest — fast unit test runner powered by Vite
   */
  vitest: '^4.0.0',
  /**
   * jsdom — DOM environment for running component tests
   */
  jsdom: '^25.0.0',
  /**
   * @angular/localize — Angular's runtime i18n / $localize support
   */
  angularLocalize: '^22.0.0',
} as const;
