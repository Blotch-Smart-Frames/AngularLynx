import { describe, expect, it } from 'vitest';
import { transformWorklets } from './worklet-transform.js';

describe('transformWorklets', () => {
  it('returns code unchanged when no directive is present', () => {
    const code = `const x = () => { console.log("hello"); };`;
    expect(transformWorklets(code, 'test.js')).toBe(code);
  });

  it('wraps arrow function with "main thread" directive', () => {
    const code = `const fn = (event) => { "main thread"; doStuff(); };`;
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain(
      `const fn = mainThreadFn((event) => { "main thread"; doStuff(); });`,
    );
    expect(result).toContain(
      `import { mainThreadFn } from '@blotch/angular-lynx';`,
    );
  });

  it('wraps arrow function with "main-thread" directive', () => {
    const code = `const fn = () => { "main-thread"; doStuff(); };`;
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain(
      `const fn = mainThreadFn(() => { "main-thread"; doStuff(); });`,
    );
  });

  it('wraps function expression with directive', () => {
    const code = `const fn = function(event) { "main thread"; doStuff(); };`;
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain(
      `const fn = mainThreadFn(function(event) { "main thread"; doStuff(); });`,
    );
  });

  it('does not wrap arrow function without block body', () => {
    const code = `const fn = () => "main thread";`;
    const result = transformWorklets(code, 'test.js');
    expect(result).not.toContain('mainThreadFn');
  });

  it('does not wrap if directive is not the first statement', () => {
    const code = `const fn = () => { const x = 1; "main thread"; };`;
    const result = transformWorklets(code, 'test.js');
    expect(result).not.toContain('mainThreadFn');
  });

  it('does not wrap already-wrapped functions', () => {
    const code = `const fn = mainThreadFn((event) => { "main thread"; doStuff(); });`;
    const result = transformWorklets(code, 'test.js');
    // Should add the import (because the directive string is detected) but not double-wrap
    expect(result).not.toContain('mainThreadFn(mainThreadFn(');
  });

  it('wraps multiple functions in the same file', () => {
    const code = [
      `const a = () => { "main thread"; doA(); };`,
      `const b = (e) => { "main thread"; doB(); };`,
    ].join('\n');
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain('mainThreadFn(() => { "main thread"; doA(); })');
    expect(result).toContain('mainThreadFn((e) => { "main thread"; doB(); })');
  });

  it('wraps class property arrow functions', () => {
    const code = `class C { handler = (event) => { "main thread"; doStuff(); }; }`;
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain(
      'handler = mainThreadFn((event) => { "main thread"; doStuff(); })',
    );
  });

  it('only wraps the inner function when nested', () => {
    const code = `const outer = () => { const inner = () => { "main thread"; doStuff(); }; };`;
    const result = transformWorklets(code, 'test.js');
    // outer should NOT be wrapped; inner should be wrapped
    expect(result).toContain(
      'const inner = mainThreadFn(() => { "main thread"; doStuff(); })',
    );
    expect(result).not.toContain('mainThreadFn(() => { const inner');
  });

  it('adds import only once', () => {
    const code = `const fn = () => { "main thread"; doStuff(); };`;
    const result = transformWorklets(code, 'test.js');
    const importCount = (result.match(/import { mainThreadFn }/g) || []).length;
    expect(importCount).toBe(1);
  });

  it('does not wrap regular string containing "main thread"', () => {
    const code = `const msg = "This runs on main thread"; console.log(msg);`;
    const result = transformWorklets(code, 'test.js');
    expect(result).not.toContain('mainThreadFn');
  });

  it('handles single-quoted directive', () => {
    const code = `const fn = () => { 'main thread'; doStuff(); };`;
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain(
      "mainThreadFn(() => { 'main thread'; doStuff(); })",
    );
  });

  it('does not wrap functions with an empty block body', () => {
    // The empty arrow has a block body with zero statements (exercising the
    // `body.statements.length === 0` guard). The directive lives on a second
    // function so transformWorklets does not bail out at the top-level check.
    const code = [
      `const empty = () => {};`,
      `const fn = () => { "main thread"; run(); };`,
    ].join('\n');
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain('const empty = () => {};');
    expect(result).toContain('mainThreadFn(() => { "main thread"; run(); })');
  });

  it('does not wrap when the first statement is not a string literal', () => {
    // `noop`'s first statement is a call expression, not a string literal, so it
    // fails the directive check; `fn` still triggers the file-level transform.
    const code = [
      `const noop = () => { doStuff(); };`,
      `const fn = () => { "main thread"; run(); };`,
    ].join('\n');
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain('const noop = () => { doStuff(); };');
    expect(result).toContain('mainThreadFn(() => { "main thread"; run(); })');
  });

  it('does not double-wrap a qualified mainThreadFn call (obj.mainThreadFn)', () => {
    // Property-access callee whose name is `mainThreadFn` counts as already
    // wrapped, so the inner function is left untouched and no import is added.
    const code = `const fn = obj.mainThreadFn((event) => { "main thread"; doStuff(); });`;
    const result = transformWorklets(code, 'test.js');
    expect(result).toBe(code);
  });

  it('wraps a function passed to a non-mainThreadFn identifier call', () => {
    // The parent call's callee is an identifier that is NOT `mainThreadFn`, so
    // the directive-bearing arrow is genuinely unwrapped and gets wrapped.
    const code = `const fn = wrap((event) => { "main thread"; doStuff(); });`;
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain(
      'wrap(mainThreadFn((event) => { "main thread"; doStuff(); }))',
    );
  });

  it('wraps a function passed to a non-mainThreadFn property call (obj.other)', () => {
    // Property-access callee whose name is not `mainThreadFn` — the final
    // `return false` path in isAlreadyWrapped — so the arrow is still wrapped.
    const code = `const fn = obj.other((event) => { "main thread"; doStuff(); });`;
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain(
      'obj.other(mainThreadFn((event) => { "main thread"; doStuff(); }))',
    );
  });

  it('handles multiline function bodies', () => {
    const code = [
      'const fn = (event) => {',
      '  "main thread";',
      '  const el = event.currentTarget;',
      '  el.setStyleProperty("color", "red");',
      '};',
    ].join('\n');
    const result = transformWorklets(code, 'test.js');
    expect(result).toContain('mainThreadFn((event) => {');
    expect(result).toContain('})');
  });
});
