import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGES_DIR } from './layers.js';
import {
  ANGULAR_UNUSED,
  enableOnDemand,
  namedGlobals,
  resolveRuntimeEntry,
} from './on-demand.js';

const CALL = `import { ɵenableWebGL2 as __angularLynxEnableWebGL2 } from "@blotch/angular-lynx"; __angularLynxEnableWebGL2(); `;

describe('enableOnDemand', () => {
  it('leaves a module that never names the context as it is', () => {
    const code = `export const draw = (canvas) => canvas.getContext('webgl');`;
    expect(enableOnDemand(code, '/app/src/draw.ts')).toBe(code);
  });

  it('calls ɵenableWebGL2() at the top of an app module that asks for it', () => {
    const code = `import { x } from './x';\nexport const gl = (c) => c.getContext('webgl2');`;
    expect(enableOnDemand(code, '/app/src/scene.ts')).toBe(CALL + code);
  });

  it('does the same for a library’s ES module, imported from where the app resolves the runtime', () => {
    const code = `const contextName = 'webgl2';\nexport { contextName };`;
    expect(
      enableOnDemand(
        code,
        '/app/node_modules/three/build/three.module.js',
        '/app/node_modules/@blotch/angular-lynx/fesm2022/x.mjs',
      ),
    ).toBe(
      `import { ɵenableWebGL2 as __angularLynxEnableWebGL2 } from "/app/node_modules/@blotch/angular-lynx/fesm2022/x.mjs"; __angularLynxEnableWebGL2(); ${code}`,
    );
  });

  it('imports under a name of its own, beside a module’s own import of ɵenableWebGL2', () => {
    const code = `import { ɵenableWebGL2 } from '@blotch/angular-lynx';\nɵenableWebGL2();\nexport const gl = (c) => c.getContext('webgl2');`;
    const result = enableOnDemand(code, '/app/src/scene.ts');
    expect(result).toBe(CALL + code);
    // Two bindings of one name would be a syntax error: the module's own
    // stays the only `ɵenableWebGL2`.
    expect(result.match(/import \{ ɵenableWebGL2 \}/g)).toHaveLength(1);
  });

  it('picks a name the module doesn’t use, beside its own import under that alias', () => {
    const code = `import { ɵenableWebGL2 as __angularLynxEnableWebGL2 } from '@blotch/angular-lynx';\nexport const gl = (c) => c.getContext('webgl2');`;
    expect(enableOnDemand(code, '/app/src/scene.ts')).toBe(
      `import { ɵenableWebGL2 as __angularLynxEnableWebGL22 } from "@blotch/angular-lynx"; __angularLynxEnableWebGL22(); ${code}`,
    );
  });

  it('picks a name the module doesn’t bind under an escaped spelling either', () => {
    const code = `import { ɵenableWebGL2 as \\u005f_angularLynxEnableWebGL2 } from '@blotch/angular-lynx';\nexport const gl = (c) => c.getContext('webgl2');`;
    expect(enableOnDemand(code, '/app/src/scene.ts')).toMatch(
      /^import \{ ɵenableWebGL2 as __angularLynxEnableWebGL22 \}/,
    );
  });

  it('keeps a hashbang first, and adds no line, so a source map still fits', () => {
    const esm = `#!/usr/bin/env node\nexport const name = 'webgl2';\n`;
    expect(enableOnDemand(esm, '/app/node_modules/cli/x.js')).toBe(
      `#!/usr/bin/env node\n${CALL}export const name = 'webgl2';\n`,
    );
    const cjs = `#!/usr/bin/env node\n'use strict'\nmodule.exports = 'webgl2';`;
    expect(enableOnDemand(cjs, '/app/node_modules/cli/y.js')).toBe(
      `#!/usr/bin/env node\n'use strict';require("@blotch/angular-lynx").ɵenableWebGL2(); \nmodule.exports = 'webgl2';`,
    );
    const bare = `#!/usr/bin/env node\nmodule.exports = 'webgl2';`;
    expect(enableOnDemand(bare, '/app/node_modules/cli/z.js')).toBe(
      `#!/usr/bin/env node\n;require("@blotch/angular-lynx").ɵenableWebGL2(); module.exports = 'webgl2';`,
    );
    // Ended by another line terminator: CRLF (one, which the call goes
    // after), CR, LS or PS.
    for (const terminator of ['\r\n', '\r', '\u2028', '\u2029']) {
      expect(
        enableOnDemand(
          `#!/usr/bin/env node${terminator}export const name = 'webgl2';`,
          '/app/node_modules/cli/v.js',
        ),
      ).toBe(
        `#!/usr/bin/env node${terminator}${CALL}export const name = 'webgl2';`,
      );
    }
    // A hashbang alone, which only names it in a comment.
    expect(enableOnDemand('#!webgl2', '/app/node_modules/cli/w.js')).toBe(
      '#!webgl2',
    );
    for (const code of [esm, cjs]) {
      const result = enableOnDemand(code, '/app/node_modules/cli/x.js');
      expect(result.split('\n')).toHaveLength(code.split('\n').length);
    }
  });

  it('imports in an .mjs module with no import or export, which has no require', () => {
    const code = `globalThis.name = 'webgl2';`;
    expect(enableOnDemand(code, '/app/node_modules/lib/index.mjs')).toBe(
      CALL + code,
    );
  });

  it('requires the runtime in a CommonJS module, after its directives', () => {
    const code = `'use strict';\n"another";\nmodule.exports = 'webgl2';`;
    expect(enableOnDemand(code, '/app/node_modules/lib/index.cjs')).toBe(
      `'use strict';\n"another";;require("@blotch/angular-lynx").ɵenableWebGL2(); \nmodule.exports = 'webgl2';`,
    );
    const bare = `module.exports = 'webgl2';`;
    expect(enableOnDemand(bare, '/app/node_modules/lib/i.js')).toBe(
      `;require("@blotch/angular-lynx").ɵenableWebGL2(); ${bare}`,
    );
  });

  it('leaves AngularLynx’s own packages alone, which name it for every app', () => {
    const code = `export const t = 'webgl2';`;
    expect(
      enableOnDemand(
        code,
        '/app/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
      ),
    ).toBe(code);
    expect(
      enableOnDemand(
        code,
        path.join(
          PACKAGES_DIR,
          'runtime/dist/fesm2022/blotch-angular-lynx.mjs',
        ),
      ),
    ).toBe(code);
  });

  it('takes only the word: a longer name isn’t a request', () => {
    const code = `export const t = 'webgl2x' + 'my_webgl2';`;
    expect(enableOnDemand(code, '/app/src/a.ts')).toBe(code);
  });
});

/**
 * The import and calls enableOnDemand() puts at the top of an ES module.
 */
const calls = (...names: string[]): string => {
  const locals = names.map(
    (name) => `__angularLynx${name.charAt(1).toUpperCase()}${name.slice(2)}`,
  );
  return `import { ${names.map((name, i) => `${name} as ${locals[i]}`).join(', ')} } from "@blotch/angular-lynx"; ${locals.map((local) => `${local}(); `).join('')}`;
};

describe('enableOnDemand, for the main thread’s globals', () => {
  it('gives a module that uses fetch or its classes fetch', () => {
    for (const code of [
      `export const get = (url) => fetch(url);`,
      `export const h = new Headers();`,
      `export const isResponse = (r) => r instanceof Response;`,
      `export const r = (url) => new Request(url);`,
      // A library's own name for the global.
      `const root = typeof self === 'object' ? self : globalThis;\nexport const get = (url) => root.fetch(url);`,
      // Looked up by a string of the name.
      `export const has = 'fetch' in globalThis;`,
      'export const f = globalThis[`fetch`];',
    ]) {
      expect(enableOnDemand(code, '/app/node_modules/lib/index.mjs')).toBe(
        calls('ɵenableFetch') + code,
      );
    }
  });

  it('gives fetch to a module that provides HttpClient, whose default backend uses it', () => {
    for (const code of [
      `import { provideHttpClient } from '@angular/common/http';\nexport const appConfig = { providers: [provideHttpClient()] };`,
      `import { HttpClientModule } from '@angular/common/http';\nexport const imports = [HttpClientModule];`,
      `import { provideHttpClient, withFetch } from '@angular/common/http';\nexport const p = provideHttpClient(withFetch());`,
      `import { FetchBackend } from '@angular/common/http';\nexport const b = FetchBackend;`,
    ]) {
      expect(enableOnDemand(code, '/app/src/app/app.config.ts')).toBe(
        calls('ɵenableFetch') + code,
      );
    }
  });

  it('gives XMLHttpRequest to a module that uses it, or asks HttpClient for its XHR backend', () => {
    expect(
      enableOnDemand(
        `export const x = () => new XMLHttpRequest();`,
        '/app/src/x.ts',
      ),
    ).toBe(
      calls('ɵenableXMLHttpRequest') +
        `export const x = () => new XMLHttpRequest();`,
    );
    const code = `import { provideHttpClient, withXhr } from '@angular/common/http';\nexport const p = provideHttpClient(withXhr());`;
    expect(enableOnDemand(code, '/app/src/app/app.config.ts')).toBe(
      calls('ɵenableFetch', 'ɵenableXMLHttpRequest') + code,
    );
    const backend = `import { HttpXhrBackend } from '@angular/common/http';\nexport const b = HttpXhrBackend;`;
    expect(enableOnDemand(backend, '/app/src/b.ts')).toBe(
      calls('ɵenableXMLHttpRequest') + backend,
    );
  });

  it('gives IntersectionObserver to a module that uses it, or compiles @defer (on viewport)', () => {
    const observer = `export const o = new IntersectionObserver(() => {});`;
    expect(enableOnDemand(observer, '/app/src/o.ts')).toBe(
      calls('ɵenableIntersectionObserver') + observer,
    );
    for (const instruction of [
      'ɵɵdeferOnViewport',
      'ɵɵdeferPrefetchOnViewport',
      'ɵɵdeferHydrateOnViewport',
    ]) {
      const template = `import * as i0 from '@angular/core';\nfunction App_Template(rf) { if (rf & 1) { i0.ɵɵdefer(1, 0); i0.${instruction}(0, -1); } }`;
      expect(enableOnDemand(template, '/app/src/app/app.ts')).toBe(
        calls('ɵenableIntersectionObserver') + template,
      );
    }
  });

  it('gives each of the body and encoding APIs to a module that names it', () => {
    for (const [code, enable] of [
      [`export const e = new TextEncoder();`, 'ɵenableTextEncoder'],
      [`export const d = new TextDecoder();`, 'ɵenableTextDecoder'],
      [
        `export const streams = typeof ReadableStream !== 'undefined';`,
        'ɵenableReadableStream',
      ],
      [`export const b = new Blob(['x']);`, 'ɵenableBlob'],
      // A canvas's toBlob() and convertToBlob() make a Blob.
      [`export const save = (c, cb) => c.toBlob(cb);`, 'ɵenableBlob'],
      [`export const save = (c) => c.convertToBlob();`, 'ɵenableBlob'],
    ] as const) {
      expect(enableOnDemand(code, '/app/src/x.ts')).toBe(calls(enable) + code);
    }
    // Only what it names: a Blob's methods use the others' classes, not the
    // globals.
    const both = `export const t = (b) => new TextDecoder().decode(b) + Blob.name;`;
    expect(enableOnDemand(both, '/app/src/t.ts')).toBe(
      calls('ɵenableTextDecoder', 'ɵenableBlob') + both,
    );
    // A comment or a message isn't a use.
    const prose = `// Reads a Blob with a TextDecoder.
export const m = 'Not a Blob';`;
    expect(enableOnDemand(prose, '/app/src/m.ts')).toBe(prose);
  });

  it('gives @angular/localize the TextEncoder its message ids are hashed with', () => {
    const code = `let textEncoder;\nfunction fingerprint(str) { textEncoder ??= new TextEncoder(); }`;
    expect(
      enableOnDemand(
        code,
        '/app/node_modules/@angular/localize/fesm2022/_localize-chunk.mjs',
      ),
    ).toBe(calls('ɵenableTextEncoder') + code);
  });

  it('reads a name spelled with escapes, which is as static as one without', () => {
    for (const code of [
      `export const get = (u) => globalThis['\\u0066etch'](u);`,
      `export const get = (u) => globalThis['\\u{66}etch'](u);`,
      `export const get = (u) => globalThis['\\x66etch'](u);`,
      `export const get = (u) => \\u0066etch(u);`,
    ]) {
      expect(enableOnDemand(code, '/app/src/get.ts')).toBe(
        calls('ɵenableFetch') + code,
      );
    }
    // An escape alone isn't a name.
    const other = `export const s = '\\u0041';`;
    expect(enableOnDemand(other, '/app/src/s.ts')).toBe(other);
  });

  it('imports in a .js module of a "type": "module" package with no import or export, which has no require', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'on-demand-')));
    try {
      const dir = path.join(root, 'node_modules/lib');
      mkdirSync(path.join(dir, 'dist'), { recursive: true });
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      const code = `globalThis.get = (u) => fetch(u);`;
      expect(enableOnDemand(code, path.join(dir, 'dist/polyfill.js'))).toBe(
        calls('ɵenableFetch') + code,
      );
      // A CommonJS package's .js file keeps require.
      const cjs = path.join(root, 'node_modules/cjs');
      mkdirSync(cjs, { recursive: true });
      writeFileSync(
        path.join(cjs, 'package.json'),
        JSON.stringify({ type: 'commonjs' }),
      );
      expect(enableOnDemand(code, path.join(cjs, 'index.js'))).toBe(
        `;require("@blotch/angular-lynx").ɵenableFetch(); ${code}`,
      );
      // So does one whose package.json can't be read.
      const broken = path.join(root, 'node_modules/broken');
      mkdirSync(broken, { recursive: true });
      writeFileSync(path.join(broken, 'package.json'), '{');
      expect(enableOnDemand(code, path.join(broken, 'index.js'))).toBe(
        `;require("@blotch/angular-lynx").ɵenableFetch(); ${code}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves a module that only mentions them in comments or other strings as it is', () => {
    const code = `// Fetch the user, then read the Response.\n/* new XMLHttpRequest() */\nexport const m = 'Response status: ' + \`fetch failed\`;\nexport const fetcher = 1;\nclass A { #fetch = 1; }`;
    expect(enableOnDemand(code, '/app/src/a.ts')).toBe(code);
  });

  it('imports everything a module asks for in one import, the WebGL2 context first', () => {
    const code = `export const draw = (c, url) => fetch(url).then(() => c.getContext('webgl2'));\nexport const o = IntersectionObserver;`;
    expect(enableOnDemand(code, '/app/src/scene.ts')).toBe(
      calls('ɵenableWebGL2', 'ɵenableFetch', 'ɵenableIntersectionObserver') +
        code,
    );
    const cjs = `'use strict';\nmodule.exports = (url) => fetch(url).then(() => 'webgl2');`;
    expect(enableOnDemand(cjs, '/app/node_modules/lib/index.cjs')).toBe(
      `'use strict';;require("@blotch/angular-lynx").ɵenableWebGL2();require("@blotch/angular-lynx").ɵenableFetch(); \nmodule.exports = (url) => fetch(url).then(() => 'webgl2');`,
    );
  });

  it('gives each import a name the module doesn’t use', () => {
    const code = `const __angularLynxEnableFetch = 1;\nexport const get = (url) => fetch(url) && 'webgl2';`;
    expect(enableOnDemand(code, '/app/src/a.ts')).toBe(
      `import { ɵenableWebGL2 as __angularLynxEnableWebGL2, ɵenableFetch as __angularLynxEnableFetch2 } from "@blotch/angular-lynx"; __angularLynxEnableWebGL2(); __angularLynxEnableFetch2(); ${code}`,
    );
  });

  it('leaves the names Angular’s packages use but an app doesn’t run, wherever the package is installed', () => {
    const cases: [string, string][] = [
      [
        '/app/node_modules/@angular/router/fesm2022/_router-chunk.mjs',
        `export const r = () => typeof fetch === 'function' && fetch;`,
      ],
      [
        '/app/node_modules/.pnpm/@angular+platform-browser@22.3.0/node_modules/@angular/platform-browser/fesm2022/_browser-chunk.mjs',
        `export const r = () => fetch;`,
      ],
      [
        'C:\\app\\node_modules\\@angular\\core\\fesm2022\\_debug_node-chunk.mjs',
        `export const o = () => new IntersectionObserver(() => {});\nexport function ɵɵdeferOnViewport() {}`,
      ],
      [
        '/app/node_modules/@angular/common/fesm2022/_module-chunk.mjs',
        `export class FetchBackend { f = fetch; h = Headers; x = XMLHttpRequest; }\nexport function provideHttpClient() {}`,
      ],
      [
        // HttpRequest's body checks and FetchBackend's decoding, which run
        // only with the fetch that brings them.
        '/app/node_modules/@angular/common/fesm2022/_module-chunk.mjs',
        `const isBlob = (v) => typeof Blob !== 'undefined' && v instanceof Blob;\nexport const text = (b) => new TextDecoder().decode(b);`,
      ],
      [
        // The HTTP transfer cache's keys.
        '/app/node_modules/@angular/common/fesm2022/http.mjs',
        `export const hash = (v) => new TextEncoder().encode(v);`,
      ],
    ];
    for (const [file, code] of cases) {
      expect(enableOnDemand(code, file)).toBe(code);
    }
    // Only the names listed for the package: core naming fetch would use it.
    const fetching = `export const f = fetch;`;
    expect(
      enableOnDemand(
        fetching,
        '/app/node_modules/@angular/core/fesm2022/core.mjs',
      ),
    ).toBe(calls('ɵenableFetch') + fetching);
  });

  it('leaves AngularLynx’s own packages alone, which use them for the apps that ask', () => {
    const code = `export const f = fetch;\nexport const o = IntersectionObserver;`;
    expect(
      enableOnDemand(
        code,
        '/app/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
      ),
    ).toBe(code);
  });
});

/**
 * The modules of each Angular package an app bundles, with the globals
 * (namedGlobals()) each names. The CLI's and the build's packages aren't in
 * an app's bundle.
 */
const angularMentions = (): Record<string, Map<string, number>> => {
  const require = createRequire(import.meta.url);
  const scope = path.dirname(
    path.dirname(require.resolve('@angular/core/package.json')),
  );
  const mentions: Record<string, Map<string, number>> = {};
  for (const name of readdirSync(scope)) {
    const dir = path.join(scope, name, 'fesm2022');
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
      const full = path.join(dir, file);
      const found = namedGlobals(readFileSync(full, 'utf8'), full);
      if (found.size > 0) mentions[`@angular/${name}/${file}`] = found;
    }
  }
  return mentions;
};

describe('the globals Angular’s packages name', () => {
  // When one of these fails after an Angular update, look at what the new
  // mention does: code every app runs needs the global in every app (take it
  // out of ANGULAR_UNUSED), and code only some apps reach needs a name of
  // its own in those apps' modules, as `@defer (on viewport)` has (GLOBALS).
  const mentions = angularMentions();

  it('are each one ANGULAR_UNUSED leaves out, or the JIT compiler’s', () => {
    const left: Record<string, string[]> = {};
    for (const [module, found] of Object.entries(mentions)) {
      const unused = ANGULAR_UNUSED[module.split('/').slice(0, 2).join('/')];
      const names = [...found.keys()].filter((name) => !unused?.includes(name));
      if (names.length > 0) left[module] = names.sort();
    }
    // The compiler compiles `@defer (on viewport)` at run time, where an app
    // bundles it: such an app does need the observer. It hashes i18n message
    // ids with a TextEncoder, and so does `$localize` (an app with it needs
    // one).
    expect(left).toEqual({
      '@angular/compiler/compiler.mjs': [
        'TextEncoder',
        'ɵɵdeferHydrateOnViewport',
        'ɵɵdeferOnViewport',
        'ɵɵdeferPrefetchOnViewport',
      ],
      '@angular/localize/_localize-chunk.mjs': ['TextEncoder'],
    });
  });

  it('name the body APIs, in @angular/common, only in its HTTP modules', () => {
    // Each read by hand: HttpRequest's body checks (`isBlob()`),
    // FetchBackend's decoding and `responseType: 'blob'`, the HTTP transfer
    // cache's keys and the testing backend. Each runs only in an app that
    // makes requests, whose fetch brings them all (network/index.ts's
    // installFetch()).
    const uses = Object.entries(mentions).flatMap(([module, found]) =>
      module.startsWith('@angular/common/')
        ? ['TextEncoder', 'TextDecoder', 'ReadableStream', 'Blob']
            .filter((name) => found.has(name))
            .map((name) => `${module} ${name}`)
        : [],
    );
    expect(uses).toEqual([
      '@angular/common/_module-chunk.mjs TextDecoder',
      '@angular/common/_module-chunk.mjs Blob',
      '@angular/common/http-testing.mjs Blob',
      '@angular/common/http.mjs TextEncoder',
      '@angular/common/http.mjs Blob',
    ]);
  });

  it('name fetch and IntersectionObserver only where an app doesn’t reach them', () => {
    // Each read by hand: `_debug_node-chunk`'s observer is made by
    // `@defer (on viewport)`'s trigger, and the others load a component's
    // resources under `ngJitMode`.
    const uses = Object.fromEntries(
      Object.entries(mentions).flatMap(([module, found]) =>
        ['fetch', 'IntersectionObserver']
          .filter(
            (name) => found.has(name) && !module.startsWith('@angular/common/'),
          )
          .map((name) => [`${module} ${name}`, found.get(name)]),
      ),
    );
    expect(uses).toEqual({
      '@angular/core/_debug_node-chunk.mjs IntersectionObserver': 1,
      '@angular/platform-browser/_browser-chunk.mjs fetch': 3,
      '@angular/router/_router-chunk.mjs fetch': 2,
    });
  });
});

describe('resolveRuntimeEntry', () => {
  it('resolves the runtime from the app’s folder, or falls back to its name', () => {
    // Real, as Node resolves symlinks: macOS's tmpdir is under one.
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'webgl2-')));
    try {
      expect(resolveRuntimeEntry(root)).toBe('@blotch/angular-lynx');
      const dir = path.join(root, 'node_modules/@blotch/angular-lynx');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: '@blotch/angular-lynx',
          exports: { '.': { default: './entry.mjs' } },
        }),
      );
      writeFileSync(path.join(dir, 'entry.mjs'), '');
      expect(resolveRuntimeEntry(root)).toBe(path.join(dir, 'entry.mjs'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
