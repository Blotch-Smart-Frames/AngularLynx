import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rspack } from '@rspack/core';
import {
  applyIntl,
  FORMATJS_POLYFILL,
  renderIntlModule,
  UNICODE_PROPERTY_REGEX_SWC_OPTIONS,
} from './apply-intl';

/**
 * FormatJS's packages are this package's dev dependencies, so a project
 * inside it resolves them, as an app that installed them does.
 */
const packageRoot = path.resolve(import.meta.dirname, '../..');
const formatJs = path.resolve(packageRoot, '../../node_modules/@formatjs');

let rootPath: string;

beforeEach(() => {
  fs.mkdirSync(path.join(packageRoot, 'node_modules/.cache'), {
    recursive: true,
  });
  rootPath = fs.mkdtempSync(
    path.join(packageRoot, 'node_modules/.cache/intl-'),
  );
});

afterEach(() => {
  fs.rmSync(rootPath, { recursive: true, force: true });
});

const imports = (source: string): string[] =>
  [...source.matchAll(/^import "(.*)";$/gm)].map(([, file]) =>
    path.isAbsolute(file!)
      ? path.relative(formatJs, file!).replaceAll(path.sep, '/')
      : file!,
  );

const setupOf = (source: string) =>
  JSON.parse(JSON.parse(/setUpIntl\(JSON\.parse\((.*)\)\);/.exec(source)![1]!));

describe('renderIntlModule', () => {
  it('loads the polyfills each after those it calls, with every locale’s data, the source locale’s first', () => {
    const module = renderIntlModule({
      apis: ['DateTimeFormat'],
      sourceLocale: 'fr',
      locales: ['en-US', 'zh-TW'],
      rootPath,
      runtimePath: '/plugin/dist/intl-runtime.js',
    });
    expect(imports(module.source)).toEqual([
      './canonical-locales.js',
      'intl-locale/polyfill.js',
      'intl-pluralrules/polyfill.js',
      'intl-pluralrules/locale-data/fr.js',
      'intl-pluralrules/locale-data/en.js',
      'intl-pluralrules/locale-data/zh.js',
      'intl-numberformat/polyfill.js',
      'intl-numberformat/locale-data/fr.js',
      'intl-numberformat/locale-data/en.js',
      'intl-numberformat/locale-data/zh-Hant.js',
      'intl-datetimeformat/polyfill.js',
      'intl-datetimeformat/locale-data/fr.js',
      'intl-datetimeformat/locale-data/en.js',
      'intl-datetimeformat/locale-data/zh-Hant.js',
    ]);
    expect(module.source).toContain(
      'import { setUpIntl } from "/plugin/dist/intl-runtime.js";',
    );
    expect(setupOf(module.source)).toEqual({ sourceLocale: 'fr' });
    // Intl.getCanonicalLocales from the index intl-locale imports, not
    // the polyfill's own bundle with a second copy of its data.
    expect(module.canonicalLocalesSource).toContain(
      `import { getCanonicalLocales } from ${JSON.stringify(
        path.join(formatJs, 'intl-getcanonicallocales/index.js'),
      )};`,
    );
    expect(module.dataFiles.get('DateTimeFormat')?.get('zh-TW')).toBe(
      path.join(formatJs, 'intl-datetimeformat/locale-data/zh-Hant.js'),
    );
    expect(module.missingLocales.size).toBe(0);
  });

  it('loads a data file once when two locales share it', () => {
    const module = renderIntlModule({
      apis: ['PluralRules'],
      sourceLocale: 'en-US',
      locales: ['en-GB', 'en-AU'],
      rootPath,
      runtimePath: '/runtime.js',
    });
    expect(imports(module.source)).toEqual([
      './canonical-locales.js',
      'intl-locale/polyfill.js',
      'intl-pluralrules/polyfill.js',
      'intl-pluralrules/locale-data/en.js',
    ]);
  });

  it('adds the collation tables for the Collator, which has no package', () => {
    const module = renderIntlModule({
      apis: ['Collator'],
      sourceLocale: 'en-US',
      locales: ['sv'],
      rootPath,
      runtimePath: '/runtime.js',
    });
    expect(imports(module.source)).toEqual([
      './canonical-locales.js',
      'intl-locale/polyfill.js',
    ]);
    const { collation } = setupOf(module.source);
    expect(Object.keys(collation.l)).toEqual(['en-US', 'sv']);
    expect(collation.t).toHaveLength(2);
  });

  it('lists the locales FormatJS has no data for', () => {
    const module = renderIntlModule({
      apis: ['ListFormat'],
      sourceLocale: 'en',
      locales: ['tlh'],
      rootPath,
      runtimePath: '/runtime.js',
    });
    expect(module.missingLocales.get('ListFormat')).toEqual(['tlh']);
  });

  it('says which packages to install when they are missing', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'intl-'));
    try {
      expect(() =>
        renderIntlModule({
          apis: ['DisplayNames'],
          sourceLocale: 'en',
          locales: [],
          rootPath: elsewhere,
          runtimePath: '/runtime.js',
        }),
      ).toThrow(
        "The `intl` build option (DisplayNames) uses FormatJS's polyfills, which aren't installed. Install them: npm install @formatjs/intl-getcanonicallocales @formatjs/intl-locale @formatjs/intl-displaynames",
      );
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('applyIntl', () => {
  const createApi = () => {
    let handler: ((config: any, context: { name: string }) => void) | undefined;
    let chainHandler:
      | ((chain: any, context: { environment: { name: string } }) => void)
      | undefined;
    const api = {
      context: { rootPath },
      logger: { warn: vi.fn() },
      modifyEnvironmentConfig: vi.fn((h) => {
        handler = h;
      }),
      modifyBundlerChain: vi.fn((h) => {
        chainHandler = h;
      }),
    };
    return {
      api,
      /** The rules the chain hook adds in environment `name`. */
      chain: (name: string) => {
        const rules: Record<string, any>[] = [];
        const chain = {
          module: {
            rule: (ruleName: string) => {
              const rule: Record<string, any> = { name: ruleName };
              rules.push(rule);
              const builder = {
                test: (test: unknown) => ((rule['test'] = test), builder),
                enforce: (enforce: string) => (
                  (rule['enforce'] = enforce),
                  builder
                ),
                use: (useName: string) => {
                  const use: Record<string, unknown> = { name: useName };
                  rule['use'] = [use];
                  const useBuilder = {
                    loader: (loader: string) => (
                      (use['loader'] = loader),
                      useBuilder
                    ),
                    options: (options: unknown) => (
                      (use['options'] = options),
                      useBuilder
                    ),
                  };
                  return useBuilder;
                },
              };
              return builder;
            },
          },
        };
        chainHandler!(chain, { environment: { name } });
        return rules;
      },
      run: (name: string, preEntry: string | string[] | undefined) => {
        const config = { source: { preEntry } };
        handler!(config, { name });
        return config.source.preEntry;
      },
    };
  };
  const file = () =>
    path.join(rootPath, 'node_modules/.cache/angular-lynx/intl/intl.js');

  it('does nothing without APIs', () => {
    const { api } = createApi();
    applyIntl(api as never, {
      apis: [],
      sourceLocale: 'en',
      locales: [],
      polyfillsEntry: '/polyfills',
    });
    expect(api.modifyEnvironmentConfig).not.toHaveBeenCalled();
    expect(fs.existsSync(file())).toBe(false);
  });

  it('writes the module and puts it after the polyfills, in the lynx environment only', () => {
    const { api, run } = createApi();
    applyIntl(api as never, {
      apis: ['PluralRules'],
      sourceLocale: 'en',
      locales: [],
      polyfillsEntry: '/polyfills',
    });
    expect(fs.readFileSync(file(), 'utf8')).toContain('intl-runtime.js');
    expect(run('lynx', ['/polyfills', 'app-polyfill', 'styles.css'])).toEqual([
      '/polyfills',
      file(),
      'app-polyfill',
      'styles.css',
    ]);
    expect(run('lynx', '/other')).toEqual([file(), '/other']);
    expect(run('lynx', undefined)).toEqual([file()]);
    expect(run('web', ['/polyfills'])).toEqual(['/polyfills']);
  });

  it("leaves the module as it is when it hasn't changed, so a watch build doesn't rebuild it", () => {
    const options = {
      apis: ['PluralRules'] as const,
      sourceLocale: 'en',
      locales: [],
      polyfillsEntry: '/polyfills',
      runtimePath: '/runtime.js',
    };
    applyIntl(createApi().api as never, options);
    const written = fs.statSync(file()).mtimeMs;
    fs.utimesSync(file(), new Date(0), new Date(0));
    applyIntl(createApi().api as never, options);
    expect(fs.statSync(file()).mtimeMs).toBe(0);
    expect(written).toBeGreaterThan(0);
  });

  it("spells out FormatJS's and our runtime's Unicode property escapes for PrimJS, in the lynx environment only", async () => {
    const { api, chain } = createApi();
    const runtimePath = '/app/node_modules/@blotch/plugin/dist/intl-runtime.js';
    applyIntl(api as never, {
      apis: ['ListFormat'],
      sourceLocale: 'en',
      locales: [],
      polyfillsEntry: '/polyfills',
      runtimePath,
    });
    expect(chain('web')).toEqual([]);
    expect(chain('lynx')).toEqual([
      {
        name: 'intl-unicode-property-regex',
        // The runtime too, which every `intl` list imports: rspeedy's own
        // compile, which spells the escapes out, skips `node_modules`, where
        // it is in an app (#316).
        test: [FORMATJS_POLYFILL, runtimePath],
        enforce: 'pre',
        use: [
          {
            name: 'swc',
            loader: 'builtin:swc-loader',
            options: UNICODE_PROPERTY_REGEX_SWC_OPTIONS,
          },
        ],
      },
    ]);
    const listFormat = path.join(formatJs, 'intl-listformat/polyfill.js');
    expect(FORMATJS_POLYFILL.test(listFormat)).toBe(true);
    expect(
      FORMATJS_POLYFILL.test(path.join(formatJs, 'intl-listformat/index.js')),
    ).toBe(false);
    // What SWC makes of it has no escape PrimJS can't compile.
    const { code } = await rspack.experiments.swc.transform(
      fs.readFileSync(listFormat, 'utf8'),
      UNICODE_PROPERTY_REGEX_SWC_OPTIONS,
    );
    expect(code).not.toMatch(/\\p\{/);
    // Hebrew's letters, written out.
    expect(code).toContain('u05D0-');

    // Nor what it makes of our Collator's, punctuation and spaces among them.
    const collator = fs.readFileSync(
      path.join(import.meta.dirname, 'collator.ts'),
      'utf8',
    );
    expect(collator).toMatch(/\\p\{/);
    const { code: collatorCode } = await rspack.experiments.swc.transform(
      collator,
      {
        ...UNICODE_PROPERTY_REGEX_SWC_OPTIONS,
        jsc: { parser: { syntax: 'typescript' } },
      },
    );
    expect(collatorCode).not.toMatch(/\\p\{/);
    // U+3000, the ideographic space, written out.
    expect(collatorCode).toContain('u3000');
  });

  it('warns about locales without data', () => {
    const warnings = (locales: string[]) => {
      const { api } = createApi();
      applyIntl(api as never, {
        apis: ['ListFormat'],
        sourceLocale: 'en',
        locales,
        polyfillsEntry: '/polyfills',
      });
      return api.logger.warn.mock.calls.map(([message]) => message);
    };
    expect(warnings(['tlh'])).toEqual([
      'Intl.ListFormat: FormatJS has no data for tlh, so it formats it in the source locale.',
    ]);
    expect(warnings(['tlh', 'ain'])).toEqual([
      'Intl.ListFormat: FormatJS has no data for tlh, ain, so it formats them in the source locale.',
    ]);
    expect(warnings(['fr'])).toEqual([]);
  });
});
