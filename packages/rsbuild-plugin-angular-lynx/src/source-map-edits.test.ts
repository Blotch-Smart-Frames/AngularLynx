import { SourceMap } from 'node:module';
import { describe, expect, it } from 'vitest';
import { transformCrossThread } from './cross-thread-transform.js';
import { importEsBuiltinsWhereNamed } from './es-builtins.js';
import { addEntryHotAccept, addHotAccept } from './hot-updates.js';
import { enableOnDemand } from './on-demand.js';
import { wrapPureClasses } from './pure-classes.js';
import { markHostElementsPure } from './pure-host-elements.js';
import { wrapPureInitializers } from './pure-initializers.js';
import {
  type SourceMapPayload,
  applyEdits,
  trackSourceMap,
} from './source-map-edits.js';
import { buildTransformedCode } from './transform-module.js';
import { transformWorklets } from './worklet-transform.js';

const DIGITS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const vlq = (value: number): string => {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let text = '';
  do {
    const digit = rest % 32;
    rest = Math.floor(rest / 32);
    text += DIGITS[rest > 0 ? digit | 32 : digit];
  } while (rest > 0);
  return text;
};

/**
 * A map of `code` to itself, with a segment at the start of each identifier,
 * as a compiler writes one for each name.
 */
const identityMap = (code: string): SourceMapPayload => {
  let previousLine = 0;
  let previousColumn = 0;
  const mappings = code
    .split('\n')
    .map((line, index) => {
      let column = 0;
      return [...line.matchAll(/[A-Za-z_$][\w$]*/g)]
        .map(({ index: at }) => {
          const text =
            vlq(at - column) +
            vlq(0) +
            vlq(index - previousLine) +
            vlq(at - previousColumn);
          column = at;
          previousLine = index;
          previousColumn = at;
          return text;
        })
        .join(',');
    })
    .join(';');
  return {
    version: 3,
    sources: ['input.js'],
    sourcesContent: [code],
    names: [],
    mappings,
  };
};

/**
 * Each segment of `map` for `output`, with the identifier at its place there
 * and the one at the place it names in `input`.
 */
const segments = (output: string, map: SourceMapPayload, input: string) => {
  const outputLines = output.split('\n');
  const inputLines = input.split('\n');
  const name = (line: string | undefined, column: number) =>
    /^[A-Za-z_$][\w$]*/.exec(line?.slice(column) ?? '')?.[0];
  const found: { generated?: string; original?: string }[] = [];
  // Node types `file` as always set, which a map needn't.
  const sourceMap = new SourceMap(
    map as ConstructorParameters<typeof SourceMap>[0],
  );
  outputLines.forEach((line, lineNumber) => {
    for (const match of line.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const entry = sourceMap.findEntry(lineNumber, match.index);
      if (
        !('generatedLine' in entry) ||
        entry.generatedLine !== lineNumber ||
        entry.generatedColumn !== match.index
      ) {
        continue;
      }
      found.push({
        generated: match[0],
        original: name(inputLines[entry.originalLine], entry.originalColumn),
      });
    }
  });
  return found;
};

/**
 * Runs `pass` over `input` with a map of `input` to itself, and checks that
 * every identifier the map names in the output is the one it points at in
 * the input, and that the pass did change the code.
 */
const expectMapFollows = (input: string, pass: (code: string) => string) => {
  const { code, map } = trackSourceMap(input, identityMap(input), pass);
  expect(code).not.toBe(input);
  const found = segments(code, map!, input);
  // Every identifier of the input is still there, and still named.
  expect(found.length).toBe(input.match(/[A-Za-z_$][\w$]*/g)!.length);
  for (const { generated, original } of found) {
    expect(generated).toBe(original);
  }
  return code;
};

describe('applyEdits', () => {
  it('makes each edit, in source order', () => {
    expect(
      applyEdits('abcdef', [
        { start: 4, end: 5, text: 'E' },
        { start: 0, end: 0, text: '<' },
        { start: 2, end: 2, text: '|' },
      ]),
    ).toBe('<ab|cdEf');
  });

  it('keeps two insertions at one offset in the order given', () => {
    expect(
      applyEdits('ab', [
        { start: 1, end: 1, text: '1' },
        { start: 1, end: 1, text: '2' },
      ]),
    ).toBe('a12b');
  });

  it('returns the code itself with no edits', () => {
    const code = 'a';
    expect(applyEdits(code, [])).toBe(code);
  });
});

describe('trackSourceMap', () => {
  it('only runs the passes without a map', () => {
    expect(trackSourceMap('a', undefined, (code) => `${code}b`)).toEqual({
      code: 'ab',
    });
  });

  it('hands on the same map when nothing changed', () => {
    const map = identityMap('a');
    expect(trackSourceMap('a', map, (code) => code)).toEqual({
      code: 'a',
      map,
    });
  });

  it('moves the segments past a line added above them', () => {
    const input = 'const a = 1;\nconst b = a;';
    const code = expectMapFollows(input, (code) =>
      applyEdits(code, [{ start: 0, end: 0, text: 'import x;\n' }]),
    );
    expect(code).toBe(`import x;\n${input}`);
  });

  it('moves a segment inside replaced text to the replacement start', () => {
    const input = 'call(first, second);';
    const { code, map } = trackSourceMap(input, identityMap(input), (code) =>
      applyEdits(code, [{ start: 5, end: 18, text: 'replaced' }]),
    );
    expect(code).toBe('call(replaced);');
    // `first` and `second` both now start the replacement.
    expect(segments(code, map!, input)).toEqual([
      { generated: 'call', original: 'call' },
      { generated: 'replaced', original: 'second' },
    ]);
  });

  it('follows several passes in turn, and edits that split a line', () => {
    expectMapFollows('let a = b + c; let d = e;', (code) =>
      applyEdits(applyEdits(code, [{ start: 15, end: 15, text: '\n' }]), [
        { start: 4, end: 4, text: 'x, ' },
      ]),
    );
  });

  // A change made without applyEdits shows as a gap between the steps.
  it('takes a change made some other way as one edit', () => {
    expectMapFollows('let a = b;\nlet c = d;', (code) => {
      const first = applyEdits(code, [{ start: 0, end: 0, text: '/*1*/' }]);
      const second = `/* prefix */\n${first}`;
      return applyEdits(second, [
        { start: second.length, end: second.length, text: '\nmore();' },
      ]).concat('\n// suffix');
    });
  });

  it('keeps names, and drops segments on lines past the code', () => {
    const map: SourceMapPayload = {
      version: 3,
      sources: ['a.ts'],
      names: ['a'],
      // `a` at 0:0 named `a`, and a segment on a third line the code
      // doesn't have.
      mappings: 'AAAAA;;AAAA',
    };
    const { map: moved } = trackSourceMap('a;\n', map, (code) =>
      applyEdits(code, [{ start: 0, end: 0, text: '  ' }]),
    );
    // Two columns on (`E`), the rest as it was.
    expect(moved).toEqual({ ...map, mappings: `${'E'}AAAA` });
  });

  it("hands on a map whose mappings it can't read as it came", () => {
    for (const mappings of ['A!AA', 'g', 'AA']) {
      const map = { version: 3, mappings };
      expect(
        trackSourceMap('a', map, (code) =>
          applyEdits(code, [{ start: 0, end: 0, text: 'b' }]),
        ),
      ).toEqual({ code: 'ba', map });
    }
  });

  it('records nothing once the passes throw', () => {
    expect(() =>
      trackSourceMap('a', identityMap('a'), () => {
        throw new Error('pass failed');
      }),
    ).toThrow('pass failed');
    // Applied outside tracking again, so nothing holds on to it.
    expect(applyEdits('a', [{ start: 0, end: 0, text: 'b' }])).toBe('ba');
  });

  it("passes a nested tracking's edits on to the one around it", () => {
    expectMapFollows('let a = b;', (code) => {
      const inner = trackSourceMap(code, identityMap(code), (input) =>
        applyEdits(input, [{ start: 0, end: 0, text: 'x;\n' }]),
      );
      return applyEdits(inner.code, [{ start: 3, end: 3, text: 'y; ' }]);
    });
  });
});

// Each of these passes only adds code, so every name of the module's must
// still map to itself (issue #819). Before, most left the map as it was.
describe("the plugin's passes with a source map", () => {
  it('transformWorklets', () => {
    expectMapFollows(
      "export const tap = (event) => {\n  'main thread';\n  return event.detail;\n};\nexport const other = 1;",
      (code) => transformWorklets(code, '/proj/src/app/tap.ts'),
    );
  });

  it('transformCrossThread', () => {
    expectMapFollows(
      "import { backgroundFn } from '@blotch/angular-lynx';\nexport const save = backgroundFn((value) => value);\nexport const after = save;",
      (code) =>
        transformCrossThread(code, '/proj/src/app/save.ts', { root: '/proj' }),
    );
  });

  it('wrapPureClasses', () => {
    expectMapFollows(
      'export class Element { static #byId = new Map(); find(id) { return Element.#byId.get(id); } }\nexport const after = Element;',
      (code) => wrapPureClasses(code, '/proj/node_modules/lib/index.mjs'),
    );
  });

  it('wrapPureInitializers', () => {
    expectMapFollows(
      'const TYPES = [GL.A, GL.B];\nexport const after = TYPES;',
      (code) =>
        wrapPureInitializers(
          code,
          '/proj/node_modules/@blotch/angular-lynx/fesm2022/index.mjs',
        ),
    );
  });

  it('markHostElementsPure', () => {
    expectMapFollows(
      "import { registerHostElement } from '@blotch/angular-lynx';\nclass UiCardTitle {}\nregisterHostElement(UiCardTitle, 'text');",
      (code) =>
        markHostElementsPure(code, '/proj/src/components/ui/card/card.mjs'),
    );
  });

  it('enableOnDemand', () => {
    expectMapFollows(
      'export const load = (url) => fetch(url);\nexport const after = load;',
      (code) => enableOnDemand(code, '/proj/src/app/load.ts'),
    );
  });

  it('importEsBuiltinsWhereNamed', () => {
    expectMapFollows(
      'export const last = (list) => list.at(-1);\nexport const after = last;',
      (code) => importEsBuiltinsWhereNamed(code, '/proj/src/app/last.ts'),
    );
  });

  it('buildTransformedCode, with stylesheets, scope IDs and hot updates', () => {
    const input =
      "import * as i0 from '@angular/core';\nexport class Card {\n  static ɵcmp = i0.ɵɵdefineComponent({ type: Card });\n}";
    expectMapFollows(input, (code) =>
      buildTransformedCode({
        code,
        resourcePath: '/proj/src/app/card.ts',
        stylesheets: {
          imports: ['/proj/node_modules/.cache/card.css'],
          scopes: [{ className: 'Card', scopeId: 'abc' }],
        },
        root: '/proj',
        hot: { entry: false, source: () => 'source' },
      }),
    );
    expectMapFollows(input, (code) => addEntryHotAccept(code));
    expectMapFollows(input, (code) =>
      addHotAccept(code, {
        components: ['Card'],
        signature: 'signature',
        compiled: code,
      }),
    );
  });
});
