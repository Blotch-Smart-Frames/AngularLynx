/**
 * The rsbuild plugin `ng build` and `ng serve` apply, for a lynx.config.ts
 * that passes it options or runs under plain rspeedy. A config that lists it
 * keeps that instance; otherwise the builders add `pluginAngularLynx()`
 * themselves. Re-exported so the import works with strict package managers
 * (pnpm, Yarn PnP), where the plugin is a dependency of this package rather
 * than of the app.
 */
export * from '@blotch/rsbuild-plugin-angular-lynx';
