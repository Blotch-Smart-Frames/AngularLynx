import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rspack } from '@rspack/core';
import { describe, expect, it } from 'vitest';
import { markHostElementsPure } from './pure-host-elements.js';

const FILE = '/proj/src/components/ui/card/card.mjs';
const mark = (...lines: string[]): string =>
  markHostElementsPure(lines.join('\n'), FILE);

describe('markHostElementsPure', () => {
  it('turns a top-level registration of the runtime’s function into a pure declaration', () => {
    expect(
      mark(
        "import { LYNX_ELEMENTS, registerHostElement } from '@blotch/angular-lynx';",
        'class UiCardTitle {}',
        "registerHostElement(UiCardTitle, 'text');",
        "registerHostElement(UiCardDescription, 'text');",
      ),
    ).toBe(
      [
        "import { LYNX_ELEMENTS, registerHostElement } from '@blotch/angular-lynx';",
        'class UiCardTitle {}',
        "const ɵhostElement0 = /*#__PURE__*/ registerHostElement(UiCardTitle, 'text');",
        "const ɵhostElement1 = /*#__PURE__*/ registerHostElement(UiCardDescription, 'text');",
      ].join('\n'),
    );
  });

  it('follows an `as` name, and leaves a function of the module’s own', () => {
    expect(
      mark(
        "import { registerHostElement as asText } from '@blotch/angular-lynx';",
        'function registerHostElement() {}',
        "asText(UiLabel, 'text');",
        "registerHostElement(UiLabel, 'text');",
      ),
    ).toBe(
      [
        "import { registerHostElement as asText } from '@blotch/angular-lynx';",
        'function registerHostElement() {}',
        "const ɵhostElement0 = /*#__PURE__*/ asText(UiLabel, 'text');",
        "registerHostElement(UiLabel, 'text');",
      ].join('\n'),
    );
  });

  it('follows a namespace import', () => {
    expect(
      mark(
        "import * as i1 from '@blotch/angular-lynx';",
        "i1.registerHostElement(UiText, 'text');",
        "i1.provideRenderer(UiText, 'text');",
        "other.registerHostElement(UiText, 'text');",
        "i1.lib.registerHostElement(UiText, 'text');",
      ),
    ).toBe(
      [
        "import * as i1 from '@blotch/angular-lynx';",
        "const ɵhostElement0 = /*#__PURE__*/ i1.registerHostElement(UiText, 'text');",
        "i1.provideRenderer(UiText, 'text');",
        "other.registerHostElement(UiText, 'text');",
        "i1.lib.registerHostElement(UiText, 'text');",
      ].join('\n'),
    );
  });

  it('leaves a call inside a function, which runs only when called', () => {
    const code = [
      "import { registerHostElement } from '@blotch/angular-lynx';",
      "export const setUp = () => registerHostElement(UiText, 'text');",
      "if (ready) registerHostElement(UiText, 'text');",
    ];
    expect(mark(...code)).toBe(code.join('\n'));
  });

  it('leaves the same name imported from elsewhere, or only as a type', () => {
    const code = [
      "import { registerHostElement } from './host-elements';",
      "import type { registerHostElement as typed } from '@blotch/angular-lynx';",
      "import { type registerHostElement as alsoTyped } from '@blotch/angular-lynx';",
      "import angularLynx from '@blotch/angular-lynx';",
      "import '@blotch/angular-lynx';",
      "registerHostElement(UiText, 'text');",
      "typed(UiText, 'text');",
      "alsoTyped(UiText, 'text');",
    ];
    expect(mark(...code)).toBe(code.join('\n'));
  });

  it('leaves statements that are no call, or no call of a name', () => {
    const code = [
      "import { registerHostElement } from '@blotch/angular-lynx';",
      'registerHostElement;',
      "(0, registerHostElement)(UiText, 'text');",
      "registerHostElement(UiText, 'text')(other);",
    ];
    expect(mark(...code)).toBe(code.join('\n'));
  });

  it('numbers each registration in the order the module makes them', () => {
    expect(
      mark(
        "import { registerHostElement } from '@blotch/angular-lynx';",
        "registerHostElement(A, 'text');",
        'other();',
        "registerHostElement(B, 'text');",
        "registerHostElement(C, 'text')",
      ),
    ).toBe(
      [
        "import { registerHostElement } from '@blotch/angular-lynx';",
        "const ɵhostElement0 = /*#__PURE__*/ registerHostElement(A, 'text');",
        'other();',
        "const ɵhostElement1 = /*#__PURE__*/ registerHostElement(B, 'text');",
        "const ɵhostElement2 = /*#__PURE__*/ registerHostElement(C, 'text')",
      ].join('\n'),
    );
  });

  it('names the declarations so none is a name the module already has', () => {
    expect(
      mark(
        "import { registerHostElement } from '@blotch/angular-lynx';",
        'const ɵhostElement0 = 1, _ɵhostElement = 2;',
        "registerHostElement(UiText, 'text');",
      ),
    ).toBe(
      [
        "import { registerHostElement } from '@blotch/angular-lynx';",
        'const ɵhostElement0 = 1, _ɵhostElement = 2;',
        "const __ɵhostElement0 = /*#__PURE__*/ registerHostElement(UiText, 'text');",
      ].join('\n'),
    );
  });

  it('returns a module that never names it as it is', () => {
    const code = "import { LYNX_ELEMENTS } from '@blotch/angular-lynx';";
    expect(markHostElementsPure(code, FILE)).toBe(code);
  });

  // Angular's development output keeps types, which SWC strips later.
  it('reads a .ts module as TypeScript', () => {
    expect(
      markHostElementsPure(
        [
          "import { registerHostElement } from '@blotch/angular-lynx';",
          'const tag: HostElementTag = <HostElementTag>"text";',
          'registerHostElement(UiText as Type<unknown>, tag);',
        ].join('\n'),
        '/proj/src/app/text.ts',
      ),
    ).toContain(
      'const ɵhostElement0 = /*#__PURE__*/ registerHostElement(UiText as Type<unknown>, tag);',
    );
  });
});

// What the pass is for: rspack itself leaving the component, and what it
// imports, out of the bundle. Built without a minifier, so only rspack's tree
// shaking can drop them.
describe('markHostElementsPure in an rspack build', () => {
  /**
   * Builds an entry that imports a component's file only for a function next
   * to it, as a module of the background thread's does, and returns the
   * bundle.
   */
  const build = async (
    transform: (code: string) => string,
  ): Promise<string> => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-host-elements-'));
    const write = (file: string, code: string): void => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), code);
    };
    write(
      'runtime.js',
      'export const registerHostElement = (type, tag) => { globalThis.registered = [type, tag]; };',
    );
    // A side-effect-free package, as @angular/core is: left out when nothing
    // reads it.
    write('node_modules/heavy/package.json', '{"sideEffects": false}');
    write(
      'node_modules/heavy/index.js',
      "export const computed = (fn) => { globalThis.heavy = 'HEAVY_PACKAGE'; return fn; };",
    );
    write(
      'icon.js',
      transform(
        [
          "import { registerHostElement } from '@blotch/angular-lynx';",
          "import { computed } from 'heavy';",
          'export const UiIcon = /*#__PURE__*/ (() => class UiIcon { svg = computed(() => 1); })();',
          "registerHostElement(UiIcon, 'svg');",
          "export const backgroundOnly = () => 'BACKGROUND_FUNCTION';",
        ].join('\n'),
      ),
    );
    write(
      'entry.js',
      "import { backgroundOnly } from './icon.js';\nglobalThis.run = backgroundOnly;",
    );
    const compiler = rspack({
      context: root,
      mode: 'production',
      entry: './entry.js',
      output: { path: path.join(root, 'dist'), filename: 'bundle.js' },
      resolve: {
        alias: { '@blotch/angular-lynx': path.join(root, 'runtime.js') },
      },
      optimization: { minimize: false },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        compiler.run((error, stats) => {
          if (error || stats?.hasErrors()) {
            reject(error ?? new Error(stats!.toString()));
          } else {
            resolve();
          }
        });
      });
      return fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf-8');
    } finally {
      await new Promise((resolve) => compiler.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  it('leaves out the component’s imports', async () => {
    const bundle = await build((code) => markHostElementsPure(code, 'icon.js'));
    expect(bundle).toContain('BACKGROUND_FUNCTION');
    expect(bundle).not.toContain('HEAVY_PACKAGE');
  });

  // The cause: a registration left as its own statement, pure or not, is
  // read by the module itself.
  it('kept them when the registration was a pure statement', async () => {
    const bundle = await build((code) =>
      code.replace(
        'registerHostElement(UiIcon',
        '/*#__PURE__*/ registerHostElement(UiIcon',
      ),
    );
    expect(bundle).toContain('HEAVY_PACKAGE');
  });
});
