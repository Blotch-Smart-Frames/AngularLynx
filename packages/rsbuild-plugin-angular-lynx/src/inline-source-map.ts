/**
 * The inline source maps Angular's compiler and JavaScript transformer append
 * when angular.json asks for script (or vendor) source maps: a `//` comment
 * at the start of a line, holding the map as base64 JSON.
 */
const INLINE_SOURCE_MAP =
  /^\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/]+=*)[ \t]*$/gm;

/**
 * A module's final code with its inline source map taken out, and the map,
 * which the plugin's transform hands to the next loader itself.
 *
 * The plugin's SWC loaders don't read maps from the code (`inputSourceMap:
 * false`, see layers.ts), because with nothing handed to them, SWC looked for
 * one itself: in a `sourceMappingURL` comment, and failing that in the file
 * next to the module with `.map` added. A library's `.mjs` always has that
 * file (ng-packagr and Angular's own builds write one), but it describes the
 * file as published, and the code SWC was given had been rewritten by then:
 * Angular's linker and the plugin's passes (private methods, static blocks,
 * the cross-thread IDs) move nearly every line. SWC laid the old map over the
 * new code, so `ResizeObserver`'s code in the main-thread script was put down
 * to the runtime's tab outlet, and a third of the script to files it didn't
 * come from (issue #722). The map a module's code does carry, Angular's own,
 * still has to reach SWC, so it goes to the loader chain instead.
 *
 * The last one in the module counts, as for a bundler reading the comment:
 * the plugin appends code after the one Angular left (the scope IDs and hot
 * update code in transform-module.ts). A map that isn't valid JSON is dropped
 * with its comment, as SWC would have ignored it.
 */
export const takeInlineSourceMap = (
  code: string,
): { code: string; map?: string } => {
  let last: RegExpExecArray | undefined;
  for (const match of code.matchAll(INLINE_SOURCE_MAP)) {
    last = match;
  }
  if (!last) {
    return { code };
  }
  const start = last.index;
  const rest = code.slice(start + last[0].length);
  const withoutMap = code.slice(0, start) + rest;
  const json = Buffer.from(last[1]!, 'base64').toString('utf8');
  try {
    JSON.parse(json);
  } catch {
    return { code: withoutMap };
  }
  return { code: withoutMap, map: json };
};
