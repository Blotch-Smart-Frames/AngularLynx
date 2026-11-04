// cspell:words ɵɵdefine ɵcmp
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractComponentStyles,
  fillCssVarNamespace,
  shipLibraryComponentStyles,
  toLynxScopedCss,
  writeModuleStylesheets,
} from './component-styles';
import { generateComponentScopeId } from './utils/angular/component-scope-id';

const FILE = '/proj/src/app/app.ts';

/**
 * The shape Angular's compiler emits for a component definition.
 */
const definition = (fields: string): string =>
  `class App {}\nApp.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: App, selectors: [["app-root"]], decls: 1, vars: 0, ${fields} });\n`;

describe('toLynxScopedCss()', () => {
  it("turns Angular's scoping attributes into classes", () => {
    expect(
      toLynxScopedCss(
        '.title[_ngcontent-%COMP%] {} [_nghost-%COMP%] {} .on[_nghost-%COMP%] .x[_ngcontent-%COMP%] {}',
        'l1',
      ),
    ).toBe(
      '.title._ngcontent-l1 {} ._nghost-l1 {} .on._nghost-l1 .x._ngcontent-l1 {}',
    );
  });

  it('fills the scope ID into scoped keyframe names', () => {
    expect(
      toLynxScopedCss(
        '.a[_ngcontent-%COMP%] { animation: _ngcontent-%COMP%_spin 1s; } @keyframes _ngcontent-%COMP%_spin {}',
        'l1',
      ),
    ).toBe(
      '.a._ngcontent-l1 { animation: _ngcontent-l1_spin 1s; } @keyframes _ngcontent-l1_spin {}',
    );
  });
});

describe('fillCssVarNamespace()', () => {
  it('fills the namespace with the default, an empty string', () => {
    expect(
      fillCssVarNamespace('.a { color: var(--%NS%primary); --%NS%x: 1; }'),
    ).toBe('.a { color: var(--primary); --x: 1; }');
  });
});

describe('extractComponentStyles()', () => {
  it('leaves a module without components untouched', () => {
    const code = 'export const x = 1;';
    expect(extractComponentStyles(code, FILE)).toEqual({
      code,
      components: [],
    });
  });

  it('scopes an Emulated component, which has no encapsulation field', () => {
    const scopeId = generateComponentScopeId('App', FILE);

    const { code, components } = extractComponentStyles(
      definition(
        'styles: [".title[_ngcontent-%COMP%] { color: var(--%NS%primary); }"]',
      ),
      FILE,
    );

    expect(components).toEqual([
      {
        className: 'App',
        scopeId,
        stylesheets: [
          `.title._ngcontent-${scopeId} { color: var(--primary); }`,
        ],
      },
    ]);
    expect(code).not.toContain('styles');
    expect(code).toMatch(/vars: 0,\s*\}\);/);
  });

  it('scopes a component with an explicit Emulated encapsulation', () => {
    const { components } = extractComponentStyles(
      definition('styles: [".a[_ngcontent-%COMP%]{}"], encapsulation: 0'),
      FILE,
    );

    expect(components[0]!.scopeId).toBeDefined();
  });

  it('keeps None and ShadowDom styles global', () => {
    for (const encapsulation of [2, 3]) {
      const { code, components } = extractComponentStyles(
        definition(
          `styles: [".a { color: var(--%NS%x); }"], encapsulation: ${encapsulation}`,
        ),
        FILE,
      );

      expect(components).toEqual([
        {
          className: 'App',
          scopeId: undefined,
          stylesheets: ['.a { color: var(--x); }'],
        },
      ]);
      expect(code).toContain(`vars: 0, encapsulation: ${encapsulation} });`);
    }
  });

  it('extracts each component of a module separately', () => {
    const code =
      'class A {}\nA.ɵcmp = ɵɵdefineComponent({ type: A, styles: [".a{}", ".b{}"] });\n' +
      'class B {}\nB.ɵcmp = ɵɵdefineComponent({ type: B, styles: [".c{}"], encapsulation: 2 });\n';

    const { components } = extractComponentStyles(code, FILE);

    expect(components.map((c) => [c.className, c.stylesheets.length])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
    expect(components[0]!.scopeId).not.toBe(
      generateComponentScopeId('B', FILE),
    );
  });

  it('removes the styles when they come last, with or without a trailing comma', () => {
    for (const code of [
      'X = ɵɵdefineComponent({ type: A, styles: [".a{}"] });',
      'X = ɵɵdefineComponent({ type: A, styles: [".a{}"], });',
    ]) {
      expect(extractComponentStyles(code, FILE).code).toMatch(
        /^X = ɵɵdefineComponent\(\{ type: A,\s*\}\);$/,
      );
    }
  });

  it('reads quoted property names', () => {
    const { components } = extractComponentStyles(
      'X = ɵɵdefineComponent({ "type": A, "styles": [".a{}"] });',
      FILE,
    );

    expect(components).toHaveLength(1);
  });

  it('leaves styles it cannot read in place', () => {
    for (const fields of [
      'styles: [shared]',
      'styles: []',
      'styles: someStyles',
      'styles: [".a{}"], encapsulation: mode',
    ]) {
      const code = `X = ɵɵdefineComponent({ type: A, ${fields} });`;
      const result = extractComponentStyles(code, FILE);

      if (fields.includes('encapsulation: mode')) {
        // An encapsulation the compiler didn't write as a number isn't
        // Emulated, so the styles stay global.
        expect(result.components[0]!.scopeId).toBeUndefined();
      } else {
        expect(result).toEqual({ code, components: [] });
      }
    }
  });

  describe('with inlineScopeIds', () => {
    /**
     * Runs the extracted code and returns the definition it builds.
     */
    const run = (code: string): { id: string; [key: string]: unknown } =>
      new Function('i0', `${code}\nreturn App.ɵcmp;`)({
        // Like Angular's, it works out an ID of its own.
        ɵɵdefineComponent: (definition: object) => ({
          ...definition,
          id: 'c123',
        }),
      });

    it("sets an Emulated component's ID inside its definition", () => {
      const scopeId = generateComponentScopeId('App', FILE);

      const { code } = extractComponentStyles(
        definition('styles: ["[_nghost-%COMP%]{}"]'),
        FILE,
        { inlineScopeIds: true },
      );

      expect(code).toContain(
        `App.ɵcmp = /*@__PURE__*/ /*@__PURE__*/ ((def) => (def.id = "${scopeId}", def))(/*@__PURE__*/ i0.ɵɵdefineComponent({`,
      );
      expect(run(code)).toMatchObject({ id: scopeId, vars: 0 });
      expect(run(code)).not.toHaveProperty('styles');
    });

    it('leaves the ID of a component whose styles are global', () => {
      const { code } = extractComponentStyles(
        definition('styles: [".a{}"], encapsulation: 2'),
        FILE,
        { inlineScopeIds: true },
      );

      expect(code).not.toContain('def.id');
      expect(run(code).id).toBe('c123');
    });
  });

  it('ignores definitions it cannot read', () => {
    for (const code of [
      'X = ɵɵdefineComponent(definition);',
      'X = ɵɵdefineComponent({ type: "A", styles: [".a{}"] });',
      'X = ɵɵdefineComponent({ styles: [".a{}"] });',
      'X = factory()({ type: A, styles: [".a{}"] }); ɵɵdefineComponent;',
      'X = ns[0].ɵɵdefineComponent;',
      'X = ɵɵdefineComponent({ ...rest, [key]: 1 });',
    ]) {
      expect(extractComponentStyles(code, FILE)).toEqual({
        code,
        components: [],
      });
    }
  });
});

describe('writeModuleStylesheets()', () => {
  let basePath: string;
  let cacheDir: string;
  const fileName = () => path.join(basePath, 'src', 'app', 'app.ts');

  beforeEach(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-css-'));
    cacheDir = path.join(basePath, 'cache');
    fs.mkdirSync(cacheDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(basePath, { recursive: true, force: true });
  });

  it('returns nothing for a module without component styles', () => {
    expect(
      writeModuleStylesheets({
        basePath,
        cacheDir,
        fileName: fileName(),
        components: [],
      }),
    ).toBeUndefined();
  });

  it('writes one CSS file per stylesheet and records the Emulated scopes', () => {
    const onWritten = vi.fn();

    const result = writeModuleStylesheets({
      basePath,
      cacheDir,
      fileName: fileName(),
      components: [
        { className: 'App', scopeId: 'l1', stylesheets: ['.a{}', '.b{}'] },
        { className: 'Plain', scopeId: undefined, stylesheets: ['.c{}'] },
      ],
      onWritten,
    });

    const files = [
      path.join(cacheDir, 'src__app__app.App.0.css'),
      path.join(cacheDir, 'src__app__app.App.1.css'),
      path.join(cacheDir, 'src__app__app.Plain.0.css'),
    ];
    expect(result).toEqual({
      imports: files,
      scopes: [{ className: 'App', scopeId: 'l1' }],
    });
    expect(files.map((file) => fs.readFileSync(file, 'utf-8'))).toEqual([
      '.a{}',
      '.b{}',
      '.c{}',
    ]);
    expect(onWritten.mock.calls).toEqual(files.map((file) => [file]));
  });

  it('only rewrites and reports files whose CSS changed', () => {
    const write = (css: string, onWritten = vi.fn()) => {
      writeModuleStylesheets({
        basePath,
        cacheDir,
        fileName: fileName(),
        components: [{ className: 'App', scopeId: 'l1', stylesheets: [css] }],
        onWritten,
      });
      return onWritten;
    };
    write('.a{}');

    expect(write('.a{}')).not.toHaveBeenCalled();
    expect(write('.a{color:red}')).toHaveBeenCalledOnce();
  });

  describe('with nameByContent', () => {
    const write = (css: string) =>
      writeModuleStylesheets({
        basePath,
        cacheDir,
        fileName: fileName(),
        components: [{ className: 'App', scopeId: 'l1', stylesheets: [css] }],
        nameByContent: true,
      })!;

    it('names each file after its CSS', () => {
      const { imports, scopes } = write('.a{}');

      expect(imports).toEqual([
        expect.stringMatching(/src__app__app\.App\.0\.[0-9a-f]{10}\.css$/),
      ]);
      expect(fs.readFileSync(imports[0]!, 'utf-8')).toBe('.a{}');
      expect(scopes).toEqual([{ className: 'App', scopeId: 'l1' }]);
    });

    it('writes changed CSS to a new file, and the same CSS once', () => {
      const first = write('.a{}').imports[0];
      const writeFile = vi.spyOn(fs, 'writeFileSync');

      expect(write('.a{}').imports[0]).toBe(first);
      expect(writeFile).not.toHaveBeenCalled();
      expect(write('.a{color:red}').imports[0]).not.toBe(first);
      // Under a temporary name, renamed when complete.
      expect(
        fs.readdirSync(cacheDir).filter((f) => f.endsWith('.tmp')),
      ).toEqual([]);
      expect(fs.readdirSync(cacheDir)).toHaveLength(2);
    });
  });

  it('works without a write callback', () => {
    expect(() =>
      writeModuleStylesheets({
        basePath,
        cacheDir,
        fileName: fileName(),
        components: [
          { className: 'App', scopeId: undefined, stylesheets: ['.a{}'] },
        ],
      }),
    ).not.toThrow();
  });
});

describe('shipLibraryComponentStyles()', () => {
  let basePath: string;
  let cacheDir: string;

  beforeEach(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-css-'));
    cacheDir = path.join(basePath, 'node_modules', '.cache', 'css');
    fs.mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(basePath, { recursive: true, force: true });
  });

  /**
   * The shape Angular's linker gives a library component compiled with
   * ng-packagr: the class in a pure IIFE.
   */
  const linked = (styles: string): string =>
    'export let Frame = /*#__PURE__*/ (() => {\nclass Frame {\n' +
    `static ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: Frame, selectors: [["lib-frame"]], ${styles} });\n` +
    '}\nreturn Frame;\n})();\n';

  it("imports a library component's scoped CSS and sets its ID in its definition", () => {
    const fileName = path.join(
      basePath,
      'node_modules',
      'lib',
      'fesm2022',
      'lib.mjs',
    );
    const scopeId = generateComponentScopeId('Frame', fileName);

    const code = shipLibraryComponentStyles(
      linked(
        'styles: ["[_nghost-%COMP%]{display:block}three-d-frame[_ngcontent-%COMP%]{height:100%}"]',
      ),
      fileName,
      { basePath, cacheDir },
    );

    const [, specifier] = /^import "([^"]+)";/.exec(code)!;
    expect(specifier).toMatch(
      /^\.\.\/\.\.\/\.cache\/css\/node_modules__lib__fesm2022__lib\.Frame\.0\.[0-9a-f]{10}\.css$/,
    );
    expect(
      fs.readFileSync(
        path.resolve(path.dirname(fileName), specifier!),
        'utf-8',
      ),
    ).toBe(
      `._nghost-${scopeId}{display:block}three-d-frame._ngcontent-${scopeId}{height:100%}`,
    );
    expect(code).toContain(`def.id = "${scopeId}"`);
    expect(code).not.toContain('styles');
    // Nothing outside the class's pure IIFE uses it, so a bundler can still
    // drop the component when the app doesn't.
    expect(code).not.toContain('Frame.ɵcmp');
  });

  it('leaves a module without component styles as it is', () => {
    const code = linked('decls: 0');

    expect(
      shipLibraryComponentStyles(code, path.join(basePath, 'lib.mjs'), {
        basePath,
        cacheDir,
      }),
    ).toBe(code);
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });
});
