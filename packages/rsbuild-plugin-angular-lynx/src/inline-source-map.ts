import * as ts from 'typescript';

/**
 * The inline source map Angular's transformer and compiler append when
 * angular.json asks for script (or vendor) source maps, as the text of a `//`
 * comment: the map as base64 JSON.
 */
const INLINE_SOURCE_MAP =
  /^\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/]+=*)/;

/**
 * Where the module's inline source map is: in the last `//` comment at its
 * top level that holds one, the one a bundler reads. `comment` is the whole
 * comment, and `start` and `end` its base64. Only a comment between the
 * module's statements, or before or after them, counts: the same text in a
 * template literal or a block comment is the code's own. The map isn't always
 * the last thing in the module: the plugin appends the code that takes hot
 * updates, and component scope IDs, after the one Angular's compiler left
 * (transform-module.ts).
 */
export const findInlineSourceMap = (
  sourceFile: ts.SourceFile,
):
  | { start: number; end: number; comment: { start: number; end: number } }
  | undefined => {
  const { text } = sourceFile;
  let found:
    | { start: number; end: number; comment: { start: number; end: number } }
    | undefined;
  const readComments = (position: number) =>
    ts.forEachLeadingCommentRange(text, position, (start, end, kind) => {
      const match =
        kind === ts.SyntaxKind.SingleLineCommentTrivia &&
        INLINE_SOURCE_MAP.exec(text.slice(start, end));
      if (match) {
        // The base64 from the match, which starts the comment: the
        // comment's range takes in any spaces or tabs after it.
        const payloadEnd = start + match[0].length;
        found = {
          start: payloadEnd - match[1]!.length,
          end: payloadEnd,
          comment: { start, end },
        };
      }
    });
  readComments(0);
  for (const statement of sourceFile.statements) {
    readComments(statement.end);
  }
  return found;
};

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
 * Which comment holds it is read from the parsed module, as
 * {@link findInlineSourceMap} does, so a line of a template literal that
 * reads like one stays in the string. Only a module whose text holds such a
 * comment is parsed: with source maps off, none does. A map that isn't valid
 * JSON is dropped with its comment, as SWC would have ignored it.
 *
 * @param code - The module's final code.
 * @param filename - The module's path, which the parse reports errors by.
 */
export const takeInlineSourceMap = (
  code: string,
  filename: string,
): { code: string; map?: string } => {
  if (!code.includes('//# sourceMappingURL=data:application/json')) {
    return { code };
  }
  // The plugin's transforms leave JavaScript, whatever the file's extension.
  const found = findInlineSourceMap(
    ts.createSourceFile(
      filename,
      code,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JS,
    ),
  );
  if (!found) {
    return { code };
  }
  // Only the comment's text goes, so every line stays where it was.
  const withoutMap =
    code.slice(0, found.comment.start) + code.slice(found.comment.end);
  const json = Buffer.from(
    code.slice(found.start, found.end),
    'base64',
  ).toString('utf8');
  try {
    JSON.parse(json);
  } catch {
    return { code: withoutMap };
  }
  return { code: withoutMap, map: json };
};
