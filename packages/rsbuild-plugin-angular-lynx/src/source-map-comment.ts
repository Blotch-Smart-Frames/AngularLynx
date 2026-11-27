import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import type { SourceMapPayload } from './source-map-edits.js';

/**
 * A `//# sourceMappingURL=` comment: the URL of the module's map, an inline
 * one (base64 JSON in a `data:` URL, as Angular's transformer and compiler
 * append when angular.json asks for script or vendor source maps) or the
 * file a published library ships beside the module. As ECMA-426 reads it:
 * any spaces after the `#`, or the older `@` in its place.
 */
const SOURCE_MAP_COMMENT = /^\/\/[#@]\s*sourceMappingURL=(\S+)/;

/**
 * An inline map's URL, with the base64 JSON it holds.
 */
const INLINE_SOURCE_MAP =
  /^data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/]+=*)$/;

/**
 * Where the module's source map comment is: the last `//` comment at its top
 * level that names one, the one a bundler reads. `comment` is the whole
 * comment, and `url` the map's URL. Only a comment between the module's
 * statements, or before or after them, counts: the same text in a template
 * literal or a block comment is the code's own.
 */
const findSourceMapComment = (
  sourceFile: ts.SourceFile,
): { url: string; comment: { start: number; end: number } } | undefined => {
  const { text } = sourceFile;
  let found:
    | { url: string; comment: { start: number; end: number } }
    | undefined;
  const read = (start: number, end: number, kind: ts.CommentKind) => {
    const match =
      kind === ts.SyntaxKind.SingleLineCommentTrivia &&
      SOURCE_MAP_COMMENT.exec(text.slice(start, end));
    if (match) {
      found = { url: match[1]!, comment: { start, end } };
    }
  };
  ts.forEachLeadingCommentRange(text, 0, read);
  for (const statement of sourceFile.statements) {
    // In source order: a comment on the statement's own line, which
    // TypeScript counts as trailing it, then those on the lines after.
    ts.forEachTrailingCommentRange(text, statement.end, read);
    ts.forEachLeadingCommentRange(text, statement.end, read);
  }
  return found;
};

/**
 * A module's code with its source map comment taken out, and the map it
 * names, which the plugin moves through its passes' edits (see
 * source-map-edits.ts) and hands to the next loader itself.
 *
 * The plugin's SWC loaders don't read maps from the code (`inputSourceMap:
 * false`, see layers.ts), because with nothing handed to them, SWC looked for
 * one itself, in this comment or the file beside the module with `.map`
 * added, and laid it over code the plugin's passes had rewritten since
 * (issue #722). The map has to reach SWC from the plugin, moved to fit.
 *
 * The map is inline when Angular's transformer or compiler wrote it. A
 * library module the transformer had nothing to change in keeps the comment
 * it was published with, naming its `.map` file: the transformer leaves it
 * only when angular.json asks for that library's maps (`vendor`, for
 * node_modules), and strips it otherwise. The file is read as esbuild reads
 * it in Angular's own build, and its sources are made relative to the
 * module's folder, where the next loader resolves them.
 *
 * Which comment holds it is read from the parsed module, so a line of a
 * template literal that reads like one stays in the string. Only a module
 * whose text holds such a comment is parsed: with source maps off, none
 * does. A map that can't be read is dropped with its comment, as SWC would
 * have ignored it.
 *
 * @param code - The module's code, as Angular's transformer left it.
 * @param filename - The module's path, which the parse reports errors by and
 * a map file's URL is relative to.
 */
export const takeSourceMap = (
  code: string,
  filename: string,
): { code: string; map?: SourceMapPayload } => {
  // Every form of the comment has this, which the parse below needn't read
  // a module without.
  if (!code.includes('sourceMappingURL=')) {
    return { code };
  }
  // The transforms before this leave JavaScript, whatever the file's
  // extension.
  const found = findSourceMapComment(
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
  const map = readSourceMap(found.url, filename);
  return map ? { code: withoutMap, map } : { code: withoutMap };
};

/**
 * The map a source map comment's URL names, or none when it can't be read:
 * a URL that isn't `data:` or a file path, a missing file, or text that
 * isn't a map.
 */
const readSourceMap = (
  url: string,
  filename: string,
): SourceMapPayload | undefined => {
  const inline = INLINE_SOURCE_MAP.exec(url);
  let json: string;
  let mapDir: string | undefined;
  if (inline) {
    json = Buffer.from(inline[1]!, 'base64').toString('utf8');
  } else if (hasScheme(url)) {
    // Another scheme (`http:`, a `data:` URL in another encoding), which the
    // build doesn't fetch.
    return undefined;
  } else {
    let file: string;
    try {
      file = path.resolve(path.dirname(filename), decodeURIComponent(url));
      json = fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    mapDir = path.dirname(file);
  }
  let map: unknown;
  try {
    map = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (
    typeof map !== 'object' ||
    map === null ||
    typeof (map as SourceMapPayload).mappings !== 'string'
  ) {
    return undefined;
  }
  return mapDir === undefined
    ? (map as SourceMapPayload)
    : rebaseSources(map as SourceMapPayload, mapDir, path.dirname(filename));
};

/**
 * Whether `url` starts with a scheme (`http:`, `file:`, `data:`).
 */
const hasScheme = (url: string): boolean => /^[a-z][a-z\d+.-]*:/i.test(url);

/**
 * A map file's sources, relative to the module's folder rather than the
 * map's, with its `sourceRoot` taken in: the next loader reads them from
 * the module's. A source that's a URL, or a root that is, stays as it is,
 * as a URL doesn't depend on where the map is.
 */
const rebaseSources = (
  map: SourceMapPayload,
  mapDir: string,
  moduleDir: string,
): SourceMapPayload => {
  const root = map.sourceRoot ?? '';
  if ((mapDir === moduleDir && root === '') || hasScheme(root)) {
    return map;
  }
  const { sourceRoot: _sourceRoot, ...rest } = map;
  return {
    ...rest,
    sources: map.sources?.map((source) =>
      hasScheme(source)
        ? source
        : path
            .relative(moduleDir, path.resolve(mapDir, root, source))
            .split(path.sep)
            .join('/'),
    ),
  };
};

/**
 * The start of a source map comment, apart from what follows it: written
 * out with its URL in this file, it reads as this file's own map comment to
 * the tools that read the plugin's code (Vite, in its tests).
 */
const COMMENT_START = '//# sourceMappingURL=';

/**
 * `code` with `map` inline after it, as Angular's transformer reads a map it
 * should carry through its own transforms.
 */
export const embedSourceMap = (code: string, map: SourceMapPayload): string =>
  `${code}\n${COMMENT_START}data:application/json;charset=utf-8;base64,${Buffer.from(
    JSON.stringify(map),
  ).toString('base64')}`;
