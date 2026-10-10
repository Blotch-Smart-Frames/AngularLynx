// cspell:words ɵcmp
import { describe, expect, it } from 'vitest';
import { buildTransformedCode } from './transform-module';

const base = {
  resourcePath: '/proj/src/app/app.component.ts',
  componentStyles: undefined,
  scopeInfo: undefined,
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
          imports: ['/proj/src/app/styles/x.__scoped_abc.css'],
        },
      });

      expect(result).toBe('import "./styles/x.__scoped_abc.css";BODY');
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
        scopeInfo: { className: 'AppComponent', scopeId: 'abc123' },
      });

      expect(result).toContain("AppComponent.ɵcmp.id = 'abc123';");
    });

    it('does not append anything when scopeInfo is absent', () => {
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

  it('applies imports, scope id and worklet together in order', () => {
    const result = buildTransformedCode({
      resourcePath: '/proj/src/app/app.component.ts',
      code: 'bootstrapApplication(App);',
      componentStyles: { imports: ['/proj/src/app/a.css'] },
      scopeInfo: { className: 'App', scopeId: 'lzz' },
    });

    // Imports are prepended, the scope id is appended.
    expect(result.startsWith('import "./a.css";')).toBe(true);
    expect(result).toContain("App.ɵcmp.id = 'lzz';");
  });
});
