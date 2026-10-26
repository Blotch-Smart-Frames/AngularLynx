// cspell:words ɵcmp
import { describe, expect, it } from 'vitest';
import { buildTransformedCode } from './transform-module';

const base = {
  resourcePath: '/proj/src/app/app.component.ts',
  stylesheets: undefined,
  root: '/proj',
};

describe('buildTransformedCode', () => {
  it('returns the code untouched when there is nothing to do', () => {
    const code = 'export class Foo {}';
    expect(buildTransformedCode({ ...base, code })).toBe(code);
  });

  describe('component stylesheet imports', () => {
    it('prepends a "./"-prefixed import for stylesheets below the component dir', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'BODY',
        // A path inside the component's directory yields a relative specifier
        // without a leading dot, so the transform must prepend "./".
        stylesheets: {
          imports: ['/proj/src/app/styles/x.App.0.css'],
          scopes: [],
        },
      });

      expect(result).toBe('import "./styles/x.App.0.css";BODY');
    });

    it('keeps the relative specifier as-is when it already starts with a dot', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'BODY',
        // A path above the component's directory yields a "../" specifier which
        // is already a valid module specifier — no "./" prefix added.
        stylesheets: { imports: ['/proj/src/shared.css'], scopes: [] },
      });

      expect(result).toBe('import "../shared.css";BODY');
    });

    it('concatenates multiple imports before the body', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'BODY',
        stylesheets: {
          imports: ['/proj/src/app/a.css', '/proj/src/app/b.css'],
          scopes: [],
        },
      });

      expect(result).toBe('import "./a.css";import "./b.css";BODY');
    });
  });

  describe('ɵcmp.id patch', () => {
    it('appends a scope-id assignment for each Emulated component', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'BODY',
        stylesheets: {
          imports: [],
          scopes: [
            { className: 'AppComponent', scopeId: 'abc123' },
            { className: 'Other', scopeId: 'def456' },
          ],
        },
      });

      expect(result).toContain("AppComponent.ɵcmp.id = 'abc123';");
      expect(result).toContain("Other.ɵcmp.id = 'def456';");
    });

    it('does not append anything when the module has no stylesheets', () => {
      const result = buildTransformedCode({ ...base, code: 'BODY' });
      expect(result).not.toContain('ɵcmp.id');
    });
  });

  // A self-accepting entry let HMR re-bootstrap only the background thread,
  // so the main thread kept rendering the old code (see transform-module.ts).
  it('does not make the bootstrap entry accept its own hot updates', () => {
    const code = 'bootstrapApplication(App, config);';

    expect(buildTransformedCode({ ...base, code })).toBe(code);
  });

  describe('worklet transform', () => {
    it('wraps "main thread" directive functions', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'const fn = () => { "main thread"; doStuff(); };',
      });

      expect(result).toContain('mainThreadFn(');
      expect(result).toContain(
        "import { mainThreadFn } from '@blotch/angular-lynx';",
      );
    });

    it('leaves code without a directive untouched by the worklet pass', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'const fn = () => doStuff();',
      });

      expect(result).not.toContain('mainThreadFn');
    });
  });

  // Angular runs on the main thread only, and the background thread runs the
  // modules that define background functions (issues #81 and #84).
  describe('cross-thread transform', () => {
    it('gives module-level background functions IDs and leaves lazy imports alone', () => {
      const result = buildTransformedCode({
        ...base,
        code: [
          "import { backgroundFn } from '@blotch/angular-lynx';",
          'const save = backgroundFn(() => 1);',
          "export const routes = [{ loadComponent: () => import('./home') }];",
        ].join('\n'),
      });

      expect(result).toMatch(/backgroundFn\(\(\) => 1, "[0-9a-f]{10}:0"\)/);
      expect(result).toContain("loadComponent: () => import('./home')");
    });
  });

  it('applies imports, scope id and worklet together in order', () => {
    const result = buildTransformedCode({
      resourcePath: '/proj/src/app/app.component.ts',
      root: '/proj',
      code: 'bootstrapApplication(App);',
      stylesheets: {
        imports: ['/proj/src/app/a.css'],
        scopes: [{ className: 'App', scopeId: 'lzz' }],
      },
    });

    // Imports are prepended, the scope id is appended.
    expect(result.startsWith('import "./a.css";')).toBe(true);
    expect(result).toContain("App.ɵcmp.id = 'lzz';");
  });

  // Set in a development build with hot updates (see hot-updates.ts).
  describe('hot updates', () => {
    const component = [
      'export class Home {}',
      'Home.ɵcmp = i0.ɵɵdefineComponent({ type: Home });',
    ].join('\n');

    it('makes an app entry accept its own updates, so it re-bootstraps', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'bootstrapApplication(App);',
        hot: { entry: true, source: () => '' },
      });

      expect(result).toContain('import.meta.webpackHot.accept();');
    });

    it('hands a component module to the runtime with its source signature', () => {
      const result = buildTransformedCode({
        ...base,
        code: component,
        hot: {
          entry: false,
          source: () => "@Component({ template: 'x' }) export class Home {}",
        },
      });

      expect(result).toMatch(
        /\[Home\] = ɵɵangularLynxHmrAccept\(import\.meta\.webpackHot, \[Home\], "[0-9a-f]{16}", "[0-9a-f]{16}"\);/,
      );
    });

    it('leaves a module without components to pass its updates on', () => {
      const code = 'export const x = 1;';
      expect(
        buildTransformedCode({
          ...base,
          code,
          hot: { entry: false, source: () => code },
        }),
      ).toBe(code);
    });

    it('adds nothing without hot updates', () => {
      expect(buildTransformedCode({ ...base, code: component })).toBe(
        component,
      );
    });
  });
});
