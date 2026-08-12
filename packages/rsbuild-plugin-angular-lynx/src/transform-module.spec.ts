// cspell:words ɵcmp
import { describe, expect, it } from 'vitest';
import { buildTransformedCode } from './transform-module';

const base = {
  resourcePath: '/proj/src/app/app.component.ts',
  componentStyles: undefined,
  scopeInfo: undefined,
  isDevMode: false,
};

describe('buildTransformedCode', () => {
  it('returns the code untouched when there is nothing to do', () => {
    const code = 'export class Foo {}';
    expect(buildTransformedCode({ ...base, code })).toBe(code);
  });

  describe('scoped style imports', () => {
    it('prepends a "./"-prefixed import for stylesheets below the component dir', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'BODY',
        // A path inside the component's directory yields a relative specifier
        // without a leading dot, so the transform must prepend "./".
        componentStyles: {
          imports: ['/proj/src/app/styles/x.__scoped_labc.css'],
        },
      });

      expect(result).toBe('import "./styles/x.__scoped_labc.css";BODY');
    });

    it('keeps the relative specifier as-is when it already starts with a dot', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'BODY',
        // A path above the component's directory yields a "../" specifier which
        // is already a valid module specifier — no "./" prefix added.
        componentStyles: { imports: ['/proj/src/shared.css'] },
      });

      expect(result).toBe('import "../shared.css";BODY');
    });

    it('concatenates multiple imports before the body', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'BODY',
        componentStyles: {
          imports: ['/proj/src/app/a.css', '/proj/src/app/b.css'],
        },
      });

      expect(result).toBe('import "./a.css";import "./b.css";BODY');
    });
  });

  describe('ɵcmp.id patch', () => {
    it('appends the scope-id assignment when scopeInfo is provided', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'BODY',
        scopeInfo: { className: 'AppComponent', scopeId: 'labc123' },
      });

      expect(result).toContain("AppComponent.ɵcmp.id = 'labc123';");
    });

    it('does not append anything when scopeInfo is absent', () => {
      const result = buildTransformedCode({ ...base, code: 'BODY' });
      expect(result).not.toContain('ɵcmp.id');
    });
  });

  describe('HMR self-accept', () => {
    it('appends module.hot.accept in dev mode for bootstrap entries', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'bootstrapApplication(App, config);',
        isDevMode: true,
      });

      expect(result).toContain('if (module.hot) { module.hot.accept(); }');
    });

    it('does not append HMR in dev mode for non-bootstrap modules', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'export class Foo {}',
        isDevMode: true,
      });

      expect(result).not.toContain('module.hot');
    });

    it('does not append HMR in production even for bootstrap entries', () => {
      const result = buildTransformedCode({
        ...base,
        code: 'bootstrapApplication(App, config);',
        isDevMode: false,
      });

      expect(result).not.toContain('module.hot');
    });
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

  it('applies imports, scope id, HMR and worklet together in order', () => {
    const result = buildTransformedCode({
      resourcePath: '/proj/src/app/app.component.ts',
      code: 'bootstrapApplication(App);',
      componentStyles: { imports: ['/proj/src/app/a.css'] },
      scopeInfo: { className: 'App', scopeId: 'lzz' },
      isDevMode: true,
    });

    // Imports are prepended, scope id + HMR are appended.
    expect(result.startsWith('import "./a.css";')).toBe(true);
    expect(result).toContain("App.ɵcmp.id = 'lzz';");
    expect(result).toContain('module.hot.accept();');
  });
});
