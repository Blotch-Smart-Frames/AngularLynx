import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGES_DIR } from './layers.js';
import { enableWebGL2WhereNamed, resolveRuntimeEntry } from './webgl2.js';

const CALL = `import { ɵenableWebGL2 } from "@blotch/angular-lynx";\nɵenableWebGL2();\n`;

describe('enableWebGL2WhereNamed', () => {
  it('leaves a module that never names the context as it is', () => {
    const code = `export const draw = (canvas) => canvas.getContext('webgl');`;
    expect(enableWebGL2WhereNamed(code, '/app/src/draw.ts')).toBe(code);
  });

  it('calls ɵenableWebGL2() at the top of an app module that asks for it', () => {
    const code = `import { x } from './x';\nexport const gl = (c) => c.getContext('webgl2');`;
    expect(enableWebGL2WhereNamed(code, '/app/src/scene.ts')).toBe(CALL + code);
  });

  it('does the same for a library’s ES module, imported from where the app resolves the runtime', () => {
    const code = `const contextName = 'webgl2';\nexport { contextName };`;
    expect(
      enableWebGL2WhereNamed(
        code,
        '/app/node_modules/three/build/three.module.js',
        '/app/node_modules/@blotch/angular-lynx/fesm2022/x.mjs',
      ),
    ).toBe(
      `import { ɵenableWebGL2 } from "/app/node_modules/@blotch/angular-lynx/fesm2022/x.mjs";\nɵenableWebGL2();\n${code}`,
    );
  });

  it('imports in an .mjs module with no import or export, which has no require', () => {
    const code = `globalThis.name = 'webgl2';`;
    expect(
      enableWebGL2WhereNamed(code, '/app/node_modules/lib/index.mjs'),
    ).toBe(CALL + code);
  });

  it('requires the runtime in a CommonJS module, after its directives', () => {
    const code = `'use strict';\n"another";\nmodule.exports = 'webgl2';`;
    expect(
      enableWebGL2WhereNamed(code, '/app/node_modules/lib/index.cjs'),
    ).toBe(
      `'use strict';\n"another";\nrequire("@blotch/angular-lynx").ɵenableWebGL2();\n\nmodule.exports = 'webgl2';`,
    );
    const bare = `module.exports = 'webgl2';`;
    expect(enableWebGL2WhereNamed(bare, '/app/node_modules/lib/i.js')).toBe(
      `\nrequire("@blotch/angular-lynx").ɵenableWebGL2();\n${bare}`,
    );
  });

  it('leaves AngularLynx’s own packages alone, which name it for every app', () => {
    const code = `export const t = 'webgl2';`;
    expect(
      enableWebGL2WhereNamed(
        code,
        '/app/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
      ),
    ).toBe(code);
    expect(
      enableWebGL2WhereNamed(
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
    expect(enableWebGL2WhereNamed(code, '/app/src/a.ts')).toBe(code);
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
