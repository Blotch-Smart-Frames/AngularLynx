// Types for what the bundler handles in app code: asset and CSS module
// imports, `import.meta.env`, `import.meta.webpackHot`. Apps reference them
// from here (`/// <reference types="@blotch/angular-lynx-build/client" />`)
// rather than from rspeedy, which is this package's dependency, not theirs:
// under strict package managers (pnpm, Yarn PnP) the app couldn't resolve it.
/// <reference types="@lynx-js/rspeedy/client" />

export {};
