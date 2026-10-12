import { describe, expect, it } from 'vitest';
import {
  filterAngularDiagnostics,
  toAngularDiagnosticError,
} from './angular-diagnostics';

describe('filterAngularDiagnostics', () => {
  it('drops unknown-element noise for Lynx native elements and keeps real diagnostics', () => {
    const typeError = { text: "TS2322: Type 'number' is not assignable" };
    const unusedWarning = { text: 'NG8113: Hello is not used' };

    expect(
      filterAngularDiagnostics({
        errors: [{ text: "NG8001: 'view' is not a known element" }, typeError],
        warnings: [
          { text: "NG8002: 'src' isn't a known property of 'image'" },
          unusedWarning,
        ],
      }),
    ).toEqual({ errors: [typeError], warnings: [unusedWarning] });
  });

  it('returns empty lists when Angular reports no errors or warnings', () => {
    expect(filterAngularDiagnostics({})).toEqual({ errors: [], warnings: [] });
  });
});

describe('toAngularDiagnosticError', () => {
  it('points the error at the file, line and 1-based column, with a code frame', () => {
    const error = toAngularDiagnosticError(
      {
        text: "TS2307: Cannot find module 'vitest'.",
        location: {
          file: '/app/src/app/hello.test.ts',
          line: 1,
          column: 37,
          length: 8,
          lineText: "import { describe, expect, it } from 'vitest';",
        },
      },
      'error',
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AngularCompilerError');
    expect(error.file).toBe('/app/src/app/hello.test.ts:1:38');
    expect(error.message).toBe(
      [
        "TS2307: Cannot find module 'vitest'.",
        '',
        "1 | import { describe, expect, it } from 'vitest';",
        `  | ${' '.repeat(37)}^^^^^^^^`,
      ].join('\n'),
    );
    // The stack points into the plugin, not at the user's code.
    expect(error.hideStack).toBe(true);
  });

  it('names warnings as warnings', () => {
    expect(
      toAngularDiagnosticError({ text: 'NG8113: unused' }, 'warning').name,
    ).toBe('AngularCompilerWarning');
  });

  it('appends related information as notes, with their locations', () => {
    const error = toAngularDiagnosticError(
      {
        text: 'NG2003: No suitable injection token.',
        notes: [
          {
            text: 'Consider using @Inject.',
            location: { file: '/app/src/a.ts', line: 4, column: 2 },
          },
          { text: 'Without a location.' },
          { location: { file: '/app/src/b.ts' } },
        ],
      },
      'error',
    );

    expect(error.message).toBe(
      [
        'NG2003: No suitable injection token.',
        '/app/src/a.ts:4:3: Consider using @Inject.',
        'Without a location.',
        '/app/src/b.ts',
      ].join('\n\n'),
    );
  });

  it('reports the file alone when the diagnostic has no line', () => {
    const error = toAngularDiagnosticError(
      {
        text: 'TS6059: File is not under rootDir.',
        location: { file: '/a.ts' },
      },
      'error',
    );

    expect(error.file).toBe('/a.ts');
    expect(error.message).toBe('TS6059: File is not under rootDir.');
  });

  it('defaults a missing column and length to a single caret at the line start', () => {
    const error = toAngularDiagnosticError(
      {
        text: 'TS1005: ; expected.',
        location: { file: '/a.ts', line: 12, lineText: 'const a = 1' },
      },
      'error',
    );

    expect(error.file).toBe('/a.ts:12:1');
    expect(error.message).toBe(
      ['TS1005: ; expected.', '', '12 | const a = 1', '   | ^'].join('\n'),
    );
  });

  it('leaves out the file and code frame when the diagnostic has no location', () => {
    const error = toAngularDiagnosticError(
      { text: 'TS5023: Unknown compiler option.', location: null },
      'error',
    );

    expect(error.file).toBeUndefined();
    expect(error.message).toBe('TS5023: Unknown compiler option.');
  });

  it('leaves out the file when the location has no file', () => {
    expect(
      toAngularDiagnosticError({ text: 'x', location: { line: 1 } }, 'error')
        .file,
    ).toBeUndefined();
  });

  it('still produces a readable error when Angular sends no text', () => {
    expect(toAngularDiagnosticError({}, 'error').message).toBe(
      'Unknown Angular compiler diagnostic',
    );
  });
});
