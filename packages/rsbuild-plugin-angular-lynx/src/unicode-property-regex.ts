import fs from 'node:fs';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';

/**
 * Text that may be a Unicode property escape, `\p{…}` or `\P{…}`. It also
 * matches one in a string or a comment, which only costs SWC a pass that
 * changes nothing.
 */
export const UNICODE_PROPERTY_ESCAPE = /\\[pP]\{/;

/**
 * The SWC options that spell out each Unicode property escape (`\p{…}`) as
 * the characters it stands for, and change nothing else: the targets have
 * every other feature the code uses. `isModule: 'unknown'` reads a package's
 * CommonJS as a script, as strict mode would reject some of it.
 */
export const UNICODE_PROPERTY_REGEX_SWC_OPTIONS = {
  env: {
    targets: 'chrome 120',
    include: ['transform-unicode-property-regex'],
  },
  isModule: 'unknown' as const,
};

/** JavaScript in an installed package. */
export const PACKAGE_JAVASCRIPT = /[\\/]node_modules[\\/].*\.[cm]?js$/;

/**
 * Whether `file` is an installed package's JavaScript with a Unicode
 * property escape in it, which the rule below hands to SWC.
 *
 * It reads the file, so SWC runs on the few packages that have one rather
 * than all of them. A file it can't read is left to the build, which reports
 * it as it would without this rule.
 */
export const hasUnicodePropertyEscape = (file: string): boolean => {
  if (!PACKAGE_JAVASCRIPT.test(file)) return false;
  try {
    return UNICODE_PROPERTY_ESCAPE.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
};

/**
 * Spells out the Unicode property escapes in installed packages' regular
 * expression literals, in the lynx environment, so the build's bytecode
 * compiler takes them.
 *
 * That compiler, which the build runs on the main thread's script, fails the
 * build on any Unicode property escape in a regex literal ("invalid escape
 * sequence in regular expression"), `\p{L}` as much as `\p{Script=Hebrew}`,
 * though PrimJS on the device runs them (from `new RegExp()`). An app's own
 * code never reaches it with one: rspeedy's SWC rule runs
 * `transform-unicode-property-regex`. That rule skips `node_modules`, and the
 * plugin's own compile of a package (layers.ts) targets ES2019 on the main
 * thread, which keeps the escapes, so a package with one, such as a slug or
 * emoji library, failed the app's build (issue #473; #316 fixed it for
 * FormatJS's polyfills alone).
 *
 * The rule's condition is a function, which reads the file: Rspack's own SWC
 * loader then runs only on the files with an escape, and every other module
 * goes on as it was.
 */
export const applyUnicodePropertyRegex = (api: RsbuildPluginAPI): void => {
  api.modifyBundlerChain((chain, { environment }) => {
    if (environment.name !== 'lynx') return;
    chain.module
      .rule('unicode-property-regex')
      .test(hasUnicodePropertyEscape)
      .enforce('pre')
      .use('swc')
      .loader('builtin:swc-loader')
      .options(UNICODE_PROPERTY_REGEX_SWC_OPTIONS);
  });
};
