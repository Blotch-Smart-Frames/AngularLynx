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
