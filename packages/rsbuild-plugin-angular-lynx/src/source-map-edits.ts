/**
 * The plugin's passes rewrite a module's code as text: each finds what to
 * change with a parse, then makes its edits to the string. A source map
 * describes the code it was written for, so after a pass it fits only as far
 * as the pass kept every line and column where it was. Before this, only the
 * private-method passes moved the map's columns, and an edit that added a
 * line (the worklet import, the static blocks' declarations) or widened one
 * (the cross-thread IDs, the pure wrappers) left the rest of the module's
 * map pointing at the wrong statement (issue #819).
 *
 * Each pass makes its edits with {@link applyEdits}, and
 * {@link trackSourceMap} records them while it runs the passes, then moves
 * the module's map through each, in order. Only what the passes kept maps
 * back: text a pass adds maps to nothing of its own.
 */

/** A change to a module's code: `text` in place of `start` to `end`. */
export type Edit = { start: number; end: number; text: string };

/**
 * A source map as JSON gives it. Only `mappings` changes as the code does;
 * the rest goes on as it was.
 */
export type SourceMapPayload = {
  version: number;
  mappings: string;
  sources?: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  sourceRoot?: string;
  file?: string;
  [key: string]: unknown;
};

/** One pass's edits, and the code before and after them. */
type Step = { input: string; output: string; edits: readonly Edit[] };

/**
 * The steps {@link trackSourceMap} is recording, or none. The passes are
 * synchronous, so no other module's can run between its start and its end.
 */
let recording: Step[] | undefined;

/**
 * `code` with `edits` made, or `code` itself when there are none. Edits never
 * overlap; two inserted at the same offset go in the order given. While
 * {@link trackSourceMap} runs, the edits are recorded, so the module's map
 * can follow them.
 */
export const applyEdits = (code: string, edits: readonly Edit[]): string => {
  if (edits.length === 0) {
    return code;
  }
  // In source order, which the loop below and the map's move both expect.
  // The sort is stable, so insertions at one offset keep their order.
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let result = '';
  let last = 0;
  for (const { start, end, text } of sorted) {
    result += code.slice(last, start) + text;
    last = end;
  }
  result += code.slice(last);
  recording?.push({ input: code, output: result, edits: sorted });
  return result;
};

/**
 * Runs the passes in `run` over `code`, and moves `map` through every edit
 * they make with {@link applyEdits}, so it describes their output.
 *
 * A change made some other way shows as a gap between one step's output and
 * the next one's input. It's taken as one edit, from where the two first
 * differ to where they last do: exact for text added in one place, and only
 * coarse for more, so the passes make their edits with `applyEdits`.
 *
 * @param map - The module's map, for `code`. Without one, `run` just runs.
 * @returns The passes' code, and the map moved to fit it. A map whose
 * mappings can't be read goes on as it came: the build doesn't stop for it.
 */
export const trackSourceMap = (
  code: string,
  map: SourceMapPayload | undefined,
  run: (code: string) => string,
): { code: string; map?: SourceMapPayload } => {
  if (!map) {
    return { code: run(code) };
  }
  const outer = recording;
  const steps: Step[] = [];
  recording = steps;
  let output: string;
  try {
    output = run(code);
  } finally {
    recording = outer;
  }
  // A pass run inside another's tracking (none is, today) belongs to the
  // outer chain too.
  outer?.push(...steps);
  if (output === code) {
    return { code: output, map };
  }
  let lines: Segment[][];
  try {
    lines = decodeMappings(map.mappings);
  } catch {
    return { code: output, map };
  }
  let current = code;
  const follow = (input: string, next: string, edits: readonly Edit[]) => {
    if (current !== input) {
      lines = moveSegments(lines, current, input, [gapEdit(current, input)]);
    }
    lines = moveSegments(lines, input, next, edits);
    current = next;
  };
  for (const { input, output: next, edits } of steps) {
    follow(input, next, edits);
  }
  if (current !== output) {
    lines = moveSegments(lines, current, output, [gapEdit(current, output)]);
  }
  return { code: output, map: { ...map, mappings: encodeMappings(lines) } };
};

/**
 * The one edit that turns `from` into `to`: what's between their common
 * start and their common end.
 */
const gapEdit = (from: string, to: string): Edit => {
  let start = 0;
  const shorter = Math.min(from.length, to.length);
  while (start < shorter && from[start] === to[start]) start++;
  let end = 0;
  while (
    end < shorter - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  ) {
    end++;
  }
  return {
    start,
    end: from.length - end,
    text: to.slice(start, to.length - end),
  };
};

/**
 * Where each line starts in `code`. A source map counts lines by `\n`, which
 * also ends a `\r\n`.
 */
const lineStarts = (code: string): number[] => {
  const starts = [0];
  for (
    let index = code.indexOf('\n');
    index !== -1;
    index = code.indexOf('\n', index + 1)
  ) {
    starts.push(index + 1);
  }
  return starts;
};

/**
 * The index of the last value in `sorted` at or below `value`.
 */
const lastAtOrBelow = (sorted: readonly number[], value: number): number => {
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (sorted[middle]! <= value) low = middle;
    else high = middle - 1;
  }
  return low;
};

/**
 * The segments of the map for `input`, moved to where `edits` put the code
 * they point at in `output`. A segment past an edit moves by what the edit
 * added or took away, and so does one at an insertion's offset, which still
 * points at the code that was there. One inside the text an edit replaced
 * moves to the replacement's start, the nearest code the map can still name.
 * Each line's segments stay in the order they came.
 */
const moveSegments = (
  lines: Segment[][],
  input: string,
  output: string,
  edits: readonly Edit[],
): Segment[][] => {
  const inputStarts = lineStarts(input);
  const outputStarts = lineStarts(output);
  const ends = edits.map(({ end }) => end);
  // How far the code after each edit has moved, counting it and the ones
  // before it: `shifts[i]` for the code past edits[i - 1].
  const shifts = [0];
  for (const { start, end, text } of edits) {
    shifts.push(shifts[shifts.length - 1]! + text.length - (end - start));
  }
  const moved: Segment[][] = outputStarts.map(() => []);
  lines.forEach((segments, line) => {
    // A map can name lines past the code's end. They point at nothing.
    if (line >= inputStarts.length) return;
    for (const segment of segments) {
      const offset = inputStarts[line]! + segment[0];
      // The edits that end at or before the segment, which it's past.
      const past =
        ends.length === 0 || ends[0]! > offset
          ? 0
          : lastAtOrBelow(ends, offset) + 1;
      const next = edits[past];
      const to =
        next && next.start < offset
          ? next.start + shifts[past]!
          : offset + shifts[past]!;
      const outputLine = lastAtOrBelow(outputStarts, to);
      const copy = [...segment] as Segment;
      copy[0] = to - outputStarts[outputLine]!;
      moved[outputLine]!.push(copy);
    }
  });
  return moved;
};

/**
 * A decoded segment, its fields counted from the start (the column from its
 * line's, the others from the file's) rather than from the segment before:
 * a column, or a column with a source, line and column, and maybe a name.
 */
type Segment =
  | [number]
  | [number, number, number, number]
  | [number, number, number, number, number];

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * A map's `mappings` as each line's segments. Throws on text that isn't
 * base64 VLQ, a value that never ends, or a segment with two or three
 * fields, which no map writes.
 */
const decodeMappings = (mappings: string): Segment[][] => {
  // The source, line, column and name fields are each relative to the
  // last segment that had one, across lines.
  const state = [0, 0, 0, 0];
  return mappings.split(';').map((line) => {
    let column = 0;
    const segments: Segment[] = [];
    for (const text of line.split(',')) {
      if (text === '') continue;
      const fields: number[] = [];
      let index = 0;
      while (index < text.length) {
        const [value, next] = decodeVlq(text, index);
        fields.push(value);
        index = next;
      }
      if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) {
        throw new Error(`Invalid source map segment: ${text}`);
      }
      column += fields[0]!;
      const segment: number[] = [column];
      for (let field = 1; field < fields.length; field++) {
        state[field - 1]! += fields[field]!;
        segment.push(state[field - 1]!);
      }
      segments.push(segment as Segment);
    }
    return segments;
  });
};

/**
 * Each line's segments as a map's `mappings`.
 */
const encodeMappings = (lines: Segment[][]): string => {
  const state = [0, 0, 0, 0];
  // The lines after the last segment need no `;` of their own.
  let count = lines.length;
  while (count > 0 && lines[count - 1]!.length === 0) count--;
  return lines
    .slice(0, count)
    .map((segments) => {
      let column = 0;
      return segments
        .map((segment) => {
          let text = encodeVlq(segment[0] - column);
          column = segment[0];
          for (let field = 1; field < segment.length; field++) {
            text += encodeVlq(segment[field]! - state[field - 1]!);
            state[field - 1] = segment[field]!;
          }
          return text;
        })
        .join(',');
    })
    .join(';');
};

/**
 * The base64 VLQ value at `start` in `text`, and where the next one starts.
 * Throws on a character that isn't base64, or a value that never ends, which
 * would otherwise read on forever.
 */
const decodeVlq = (
  text: string,
  start: number,
): [value: number, next: number] => {
  let value = 0;
  let shift = 0;
  let index = start;
  let digit: number;
  do {
    digit = index < text.length ? BASE64.indexOf(text[index++]!) : -1;
    if (digit < 0) {
      throw new Error(`Invalid source map segment: ${text}`);
    }
    value += (digit & 31) * 2 ** shift;
    shift += 5;
  } while (digit & 32);
  // The lowest bit is the sign.
  return [value % 2 ? -(value - 1) / 2 : value / 2, index];
};

const encodeVlq = (value: number): string => {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let text = '';
  do {
    const digit = rest % 32;
    rest = Math.floor(rest / 32);
    text += BASE64[rest > 0 ? digit | 32 : digit];
  } while (rest > 0);
  return text;
};
