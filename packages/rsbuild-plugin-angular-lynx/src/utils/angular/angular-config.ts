import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { NormalizedOptions } from './options.js';

export const applyAngularConfig = (
  api: RsbuildPluginAPI,
  buildOptions: NormalizedOptions,
): void => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    config.output.cleanDistPath = true;
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
    //    which template strings may reference at module evaluation
    // 3. User polyfills from angular.json
    // 4. Global stylesheets — must load before components so CSS is available
    //    when the first component renders
    config.source.preEntry.push(path.resolve(__dirname, './polyfills'));
    if (buildOptions.i18n.hasDefinedSourceLocale) {
      config.source.preEntry.push('@angular/localize/init');
    }
    const polyfills = buildOptions.polyfills;
    if (polyfills) {
      config.source.preEntry.push(...polyfills);
    }
    config.source.preEntry.push(...buildOptions.styles);
    config.source.tsconfigPath = buildOptions.tsconfig;
    config.source.define ??= {};
    config.source.define['__LYNX_SOURCE_LOCALE__'] = JSON.stringify(
      buildOptions.i18n.sourceLocale,
    );
    const isProd =
      process.env.NODE_ENV === 'production' || config.mode === 'production';
    if (isProd) {
      config.source.define.ngDevMode = false;
    }
  });
};
