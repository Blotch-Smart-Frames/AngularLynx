/// <reference types="node" />
// Not copied into apps (it reads the components' source with Node), like the
// theme checks. It sits outside `components/`, whose folders are each a
// component to the coverage script.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Relative to the package, where `ng test` runs: the test runs from a build
 * of it elsewhere, so `import.meta.url` doesn't point next to the source.
 */
const COMPONENTS = 'src/lib/components';

/**
 * Where a bracket that opens at `start` closes: `<…>` or `(…)`. In a type
 * argument, the `>` of a function type's `=>` doesn't close anything.
 */
const closingBracket = (source: string, start: number): number => {
  const [open, close] = source[start] === '<' ? '<>' : '()';
  let depth = 0;
  for (let at = start; ; at++) {
    if (source[at] === open) depth++;
    else if (source[at] === close && source[at - 1] !== '=') depth--;
    if (depth === 0) return at;
  }
};

/**
 * Each `input()` or `input.required()` field in a file, with its type
 * argument and its arguments, as written.
 */
const inputs = (source: string) =>
  [...source.matchAll(/(\w+) = input(?:\.required)?(?=[<(])/g)].map((match) => {
    let at = match.index + match[0].length;
    let type = '';
    if (source[at] === '<') {
      const end = closingBracket(source, at);
      type = source.slice(at + 1, end);
      at = end + 1;
    }
    const args = source.slice(at + 1, closingBracket(source, at));
    return { name: match[1]!, type, args };
  });

describe('boolean inputs', () => {
  // An app shouldn't have to read a component's source to know whether it
  // takes `<ui-card pressable>` or needs `[pressable]="true"`, so every one
  // takes the bare attribute (#156). `model()`s can't: Angular's `model()`
  // takes no transform.
  it('take a bare attribute, through a transform such as booleanAttribute', () => {
    const files = readdirSync(COMPONENTS, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort();
    const booleans = files.flatMap((file) =>
      inputs(readFileSync(`${COMPONENTS}/${file}`, 'utf8'))
        .filter(
          ({ type, args }) =>
            /^boolean\b/.test(type) || /^(true|false)\b/.test(args.trim()),
        )
        .map((input) => ({ ...input, field: `${file}: ${input.name}` })),
    );

    // The parse finds them all, rather than none (which would pass).
    expect(booleans.map(({ field }) => field)).toContain(
      'card/card.ts: pressable',
    );
    expect(booleans.map(({ field }) => field)).toContain(
      'menu/menu.ts: checked',
    );
    expect(
      booleans
        .filter(({ args }) => !/\btransform:/.test(args))
        .map(({ field }) => field),
    ).toEqual([]);
  });
});
