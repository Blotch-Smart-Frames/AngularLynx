import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rspack } from '@rspack/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PACKAGE_JAVASCRIPT,
  UNICODE_PROPERTY_ESCAPE,
  UNICODE_PROPERTY_REGEX_SWC_OPTIONS,
  applyUnicodePropertyRegex,
  hasUnicodePropertyEscape,
} from './unicode-property-regex';

/**
 * The rules applyUnicodePropertyRegex() adds in environment `name`, read off
 * a chain that records them.
 */
const rulesIn = (name: string) => {
  let hook:
    | ((chain: unknown, context: { environment: { name: string } }) => void)
    | undefined;
  applyUnicodePropertyRegex({
    modifyBundlerChain: (h: typeof hook) => {
      hook = h;
    },
  } as never);
  const rules: Record<string, unknown>[] = [];
  const chain = {
    module: {
      rule: (ruleName: string) => {
        const rule: Record<string, unknown> = { name: ruleName };
        rules.push(rule);
        const builder = {
          test: (test: unknown) => ((rule['test'] = test), builder),
          enforce: (enforce: string) => ((rule['enforce'] = enforce), builder),
          use: (use: string) => {
            const used: Record<string, unknown> = { name: use };
            rule['use'] = used;
            const useBuilder = {
              loader: (loader: string) => (
                (used['loader'] = loader),
                useBuilder
              ),
              options: (options: unknown) => {
                used['options'] = options;
              },
            };
            return useBuilder;
          },
        };
        return builder;
      },
    },
  };
  hook!(chain, { environment: { name } });
  return rules;
};

/**
 * What SWC makes of `source` with the rule's options.
 */
const spellOut = async (source: string): Promise<string> =>
  (
    await rspack.experiments.swc.transform(
      source,
      UNICODE_PROPERTY_REGEX_SWC_OPTIONS,
    )
  ).code;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unicode-property-regex-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes `source` to `relative` under the test's folder, and returns its
 * path.
 */
const write = (relative: string, source: string): string => {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
};

describe('applyUnicodePropertyRegex', () => {
  it('runs SWC on the packages with an escape, in the lynx environment only', () => {
    expect(rulesIn('web')).toEqual([]);
    expect(rulesIn('lynx')).toEqual([
      {
        name: 'unicode-property-regex',
        test: hasUnicodePropertyEscape,
        enforce: 'pre',
        use: {
          name: 'swc',
          loader: 'builtin:swc-loader',
          options: UNICODE_PROPERTY_REGEX_SWC_OPTIONS,
        },
      },
    ]);
  });
});

describe('hasUnicodePropertyEscape', () => {
  it("takes a package's JavaScript with an escape", () => {
    for (const [file, source] of [
      ['node_modules/slugs/index.js', 'export const a = /^\\p{L}$/u;'],
      ['node_modules/@scope/emoji/dist/index.mjs', 'const b = /\\P{Lu}/u;'],
      [
        'node_modules/.pnpm/a@1.0.0/node_modules/a/index.cjs',
        'module.exports = /\\p{Script=Latin}/u;',
      ],
    ] as const) {
      expect(hasUnicodePropertyEscape(write(file, source)), file).toBe(true);
    }
  });

  it('leaves a package without one, and files outside node_modules', () => {
    expect(
      hasUnicodePropertyEscape(
        write('node_modules/slugs/plain.js', 'export const a = /\\s+/g;'),
      ),
    ).toBe(false);
    // The app's own code: rspeedy's rule spells its escapes out.
    expect(
      hasUnicodePropertyEscape(
        write('src/app/slug.js', 'const a = /\\p{L}/u;'),
      ),
    ).toBe(false);
    expect(
      hasUnicodePropertyEscape(
        write('node_modules/a/styles.css', '.a { content: "\\p{"; }'),
      ),
    ).toBe(false);
  });

  it('leaves a file it can’t read to the build', () => {
    expect(
      hasUnicodePropertyEscape(path.join(dir, 'node_modules/gone/index.js')),
    ).toBe(false);
  });

  it('names JavaScript in node_modules, on Windows too', () => {
    expect(PACKAGE_JAVASCRIPT.test('C:\\app\\node_modules\\a\\index.js')).toBe(
      true,
    );
    expect(PACKAGE_JAVASCRIPT.test('/app/node_modules/a/index.d.ts')).toBe(
      false,
    );
  });
});

describe('what SWC makes of a package', () => {
  it('spells out each escape, General_Category and Script alike, and nothing else', async () => {
    const code = await spellOut(
      [
        'export const isLetter = (c) => /^\\p{L}$/u.test(c);',
        'export const words = (s) => s.split(/[\\p{P}\\p{Z}]+/u);',
        'export const notLatin = /\\P{Script=Latin}/u;',
        '',
      ].join('\n'),
    );
    expect(code).not.toMatch(UNICODE_PROPERTY_ESCAPE);
    // The ideographic space, among the separators, written out.
    expect(code).toContain('u3000');
    // No other syntax is lowered.
    expect(code).toContain('export const isLetter = (c)=>');
  });

  it('reads CommonJS as a script', async () => {
    const code = await spellOut(
      "'use strict';\nmodule.exports = (c) => /^\\p{Lu}/u.test(c);\n",
    );
    expect(code).toContain('module.exports');
    expect(code).not.toMatch(UNICODE_PROPERTY_ESCAPE);
  });
});
