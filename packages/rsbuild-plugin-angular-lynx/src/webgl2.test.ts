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

const CALL = `import { ɵenableWebGL2 as __angularLynxEnableWebGL2 } from "@blotch/angular-lynx"; __angularLynxEnableWebGL2(); `;

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
      `import { ɵenableWebGL2 as __angularLynxEnableWebGL2 } from "/app/node_modules/@blotch/angular-lynx/fesm2022/x.mjs"; __angularLynxEnableWebGL2(); ${code}`,
    );
  });

  it('imports under a name of its own, beside a module’s own import of ɵenableWebGL2', () => {
    const code = `import { ɵenableWebGL2 } from '@blotch/angular-lynx';\nɵenableWebGL2();\nexport const gl = (c) => c.getContext('webgl2');`;
    const result = enableWebGL2WhereNamed(code, '/app/src/scene.ts');
    expect(result).toBe(CALL + code);
    // Two bindings of one name would be a syntax error: the module's own
    // stays the only `ɵenableWebGL2`.
    expect(result.match(/import \{ ɵenableWebGL2 \}/g)).toHaveLength(1);
  });

  it('picks a name the module doesn’t use, beside its own import under that alias', () => {
    const code = `import { ɵenableWebGL2 as __angularLynxEnableWebGL2 } from '@blotch/angular-lynx';\nexport const gl = (c) => c.getContext('webgl2');`;
    expect(enableWebGL2WhereNamed(code, '/app/src/scene.ts')).toBe(
      `import { ɵenableWebGL2 as __angularLynxEnableWebGL22 } from "@blotch/angular-lynx"; __angularLynxEnableWebGL22(); ${code}`,
    );
  });

  it('keeps a hashbang first, and adds no line, so a source map still fits', () => {
    const esm = `#!/usr/bin/env node\nexport const name = 'webgl2';\n`;
    expect(enableWebGL2WhereNamed(esm, '/app/node_modules/cli/x.js')).toBe(
      `#!/usr/bin/env node\n${CALL}export const name = 'webgl2';\n`,
    );
    const cjs = `#!/usr/bin/env node\n'use strict'\nmodule.exports = 'webgl2';`;
    expect(enableWebGL2WhereNamed(cjs, '/app/node_modules/cli/y.js')).toBe(
      `#!/usr/bin/env node\n'use strict';require("@blotch/angular-lynx").ɵenableWebGL2(); \nmodule.exports = 'webgl2';`,
    );
    const bare = `#!/usr/bin/env node\nmodule.exports = 'webgl2';`;
    expect(enableWebGL2WhereNamed(bare, '/app/node_modules/cli/z.js')).toBe(
      `#!/usr/bin/env node\n;require("@blotch/angular-lynx").ɵenableWebGL2(); module.exports = 'webgl2';`,
    );
    // Ended by another line terminator: CR, LS or PS.
    for (const terminator of ['\r', '\u2028', '\u2029']) {
      expect(
        enableWebGL2WhereNamed(
          `#!/usr/bin/env node${terminator}export const name = 'webgl2';`,
          '/app/node_modules/cli/v.js',
        ),
      ).toBe(
        `#!/usr/bin/env node${terminator}${CALL}export const name = 'webgl2';`,
      );
    }
    // A hashbang alone, which only names it in a comment.
    expect(
      enableWebGL2WhereNamed('#!webgl2', '/app/node_modules/cli/w.js'),
    ).toBe('#!webgl2');
    for (const code of [esm, cjs]) {
      const result = enableWebGL2WhereNamed(code, '/app/node_modules/cli/x.js');
      expect(result.split('\n')).toHaveLength(code.split('\n').length);
    }
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
      `'use strict';\n"another";;require("@blotch/angular-lynx").ɵenableWebGL2(); \nmodule.exports = 'webgl2';`,
    );
    const bare = `module.exports = 'webgl2';`;
    expect(enableWebGL2WhereNamed(bare, '/app/node_modules/lib/i.js')).toBe(
      `;require("@blotch/angular-lynx").ɵenableWebGL2(); ${bare}`,
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
