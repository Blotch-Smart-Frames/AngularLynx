import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { RsbuildConfig } from '@rsbuild/core';
import type { NormalizedOptions } from './options.js';

/**
 * Matches the `ios` and `android` folders right inside the dist folder, and
 * nothing deeper, so an asset that happens to sit in a folder of that name
 * is still cleaned. It's anchored to the absolute path because Rsbuild tests
 * `keep` against each entry's absolute path, in POSIX form even on Windows:
 * an unanchored `/ios/` would keep everything in a project under ~/ios.
 */
const nativeOutputPattern = (
  rootPath: string,
  distPath: NonNullable<RsbuildConfig['output']>['distPath'],
): RegExp => {
  const root = typeof distPath === 'string' ? distPath : distPath?.root;
  const dist = path
    .resolve(rootPath, root ?? 'dist')
    .replaceAll(path.sep, '/')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${dist}/(?:ios|android)$`);
};

/**
 * The plugin's polyfills (polyfills.js), the first module of every bundle's
 * preEntry. Next to the plugin's bundled index in its dist folder.
 */
export const POLYFILLS_ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './polyfills',
);

export const applyAngularConfig = (
  api: RsbuildPluginAPI,
  buildOptions: NormalizedOptions,
): void => {
  api.modifyRsbuildConfig((config) => {
    // output
    config.output = config.output ?? {};
    if (buildOptions.outputPath) {
      // distPath can be string | DistPathConfig in newer rspeedy; always use object form
      config.output.distPath = {
        ...(typeof config.output.distPath === 'object'
          ? config.output.distPath
          : {}),
        root: buildOptions.outputPath,
      };
    }
    // `ng build --platform` writes its apps into <outputPath>/ios and
    // <outputPath>/android. Emptying those too would delete the other
    // platform's app on every build, and both on `ng serve`, leaving nothing
    // to install. Each native build empties its own folder instead
    // (`buildNativeApp`).
    config.output.cleanDistPath = {
      enable: true,
      keep: [nativeOutputPattern(api.context.rootPath, config.output.distPath)],
    };
    // const hashFormat = getOutputHashFormat(OutputHashing.None, 8);
    // config.output.filename ??= {};
    // config.output.filename.js = `[name]${hashFormat.chunk}.js`;
    // config.output.filename.css = `[name]${hashFormat.file}.css`;
    // config.output.distPath.js = "";
    // config.output.distPath.jsAsync = "";
    // config.output.distPath.css = "";
    // config.html ??= {};
    // config.html.template ??= buildOptions.index;
    config.source ??= {};
    // if (!config.source.entry.index) {
    //   const indexPath = relativePrefix(buildOptions.browser);
    //   config.source.entry.index = indexPath;
    // }
    if (typeof config.source.preEntry === 'string') {
      config.source.preEntry = [config.source.preEntry];
    } else {
      config.source.preEntry ??= [];
    }
    // preEntry order matters — these run before the app's main entry:
    // 1. Polyfills (AbortController, URL, etc.) must come first since Angular
    //    and user code assume they exist at import time
    // 2. @angular/localize/init (if i18n is configured) — registers $localize
    //    which template strings may reference at module evaluation. Only when
    //    the app's polyfills don't load it already, as they do after
    //    `add-i18n`, which puts it there for `ng test` as Angular's own
    //    `ng add @angular/localize` does.
    // 3. User polyfills from angular.json. The `intl` option's module goes
    //    in before them, in the lynx environment only (intl/apply-intl.ts).
    // 4. Global stylesheets — must load before components so CSS is available
    //    when the first component renders
    config.source.preEntry.push(POLYFILLS_ENTRY);
    const polyfills = buildOptions.polyfills ?? [];
    if (
      buildOptions.i18n.hasDefinedSourceLocale &&
      !polyfills.some((polyfill) => polyfill.startsWith('@angular/localize'))
    ) {
      config.source.preEntry.push('@angular/localize/init');
    }
    config.source.preEntry.push(...polyfills);
    config.source.preEntry.push(...buildOptions.styles);
    config.source.tsconfigPath = buildOptions.tsconfig;
    config.source.define ??= {};
    config.source.define['__LYNX_SOURCE_LOCALE__'] = JSON.stringify(
      buildOptions.i18n.sourceLocale,
    );
    // Angular's compile-time flags, defined as Angular's CLI defines them for
    // a browser build (`getEsBuildCommonOptions` in @angular/build, and
    // `ngI18nClosureMode` in its `createCompilerPlugin`). Angular reads them
    // as globals, usually behind a `typeof` check but not always: since
    // @angular/core 22.2.6 bootstrap reads `ngDevMode || ngServerMode` bare,
    // so with `ngDevMode` false, as in production, an undefined
    // `ngServerMode` threw a ReferenceError before the app started. Defining
    // every flag the CLI defines keeps a bare read of another from doing the
    // same.
    //
    // - `ngServerMode`: false. A Lynx bundle, lynx or web, is never rendered
    //   on a server.
    // - `ngJitMode`: whether the app compiles just in time (`aot: false`).
    // - `ngHmrMode`: false, as the CLI's is without Angular's template hot
    //   replacement, which the plugin doesn't compile for (Angular's
    //   `_enableHmr`). The runtime's own hot updates don't read it.
    // - `ngI18nClosureMode`: false, unless the project defines it, as the
    //   CLI's compiler plugin leaves it.
    // - `ngDevMode`: false only in a production build, the build that
    //   optimizes scripts, as the CLI's is. Left undefined otherwise: Angular
    //   makes it an object of debug counters, which a constant would break.
    config.source.define.ngServerMode = false;
    config.source.define.ngJitMode = !buildOptions.aot;
    config.source.define.ngHmrMode = false;
    config.source.define.ngI18nClosureMode ??= false;
    const isProd =
      process.env.NODE_ENV === 'production' || config.mode === 'production';
    if (isProd) {
      config.source.define.ngDevMode = false;
    }
  });
};
