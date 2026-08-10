import { describe, expect, it } from 'vitest';
import { injectLynxSchema } from './inject-lynx-schema';

const IMPORT_LINE = `import { CUSTOM_ELEMENTS_SCHEMA as __LynxCES__ } from '@angular/core';\n`;

describe('injectLynxSchema', () => {
  it('returns source unchanged when CUSTOM_ELEMENTS_SCHEMA already present', () => {
    const source = `import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
@Component({ schemas: [CUSTOM_ELEMENTS_SCHEMA] })
class MyComponent {}`;

    expect(injectLynxSchema(source)).toBe(source);
  });

  it('returns source unchanged when NO_ERRORS_SCHEMA already present', () => {
    const source = `import { NO_ERRORS_SCHEMA } from '@angular/core';
@Component({ schemas: [NO_ERRORS_SCHEMA] })
class MyComponent {}`;

    expect(injectLynxSchema(source)).toBe(source);
  });

  it('returns source unchanged when no @Component decorator is present', () => {
    const source = `import { Injectable } from '@angular/core';
@Injectable()
class MyClass {}`;

    expect(injectLynxSchema(source)).toBe(source);
  });

  it('injects schema and import for a basic @Component', () => {
    const source = `@Component({
  selector: 'app-root',
})
class App {}`;

    const result = injectLynxSchema(source);

    expect(result).toContain(IMPORT_LINE);
    expect(result).toContain('@Component({ schemas: [__LynxCES__],');
    expect(result.startsWith(IMPORT_LINE)).toBe(true);
  });

  it('handles whitespace between @Component and opening brace', () => {
    const source = `@Component  ({
  selector: 'app-root',
})
class App {}`;

    const result = injectLynxSchema(source);

    expect(result).toContain(IMPORT_LINE);
    expect(result).toContain('@Component({ schemas: [__LynxCES__],');
  });

  it('handles newline between @Component and opening brace', () => {
    const source = `@Component\n({
  selector: 'app-root',
})
class App {}`;

    const result = injectLynxSchema(source);

    expect(result).toContain(IMPORT_LINE);
    expect(result).toContain('@Component({ schemas: [__LynxCES__],');
  });

  it('patches all @Component decorators in the file', () => {
    const source = `@Component({ selector: 'app-a' })
class ComponentA {}

@Component({ selector: 'app-b' })
class ComponentB {}`;

    const result = injectLynxSchema(source);

    expect(result).toContain(IMPORT_LINE);
    // Import appears exactly once
    expect(result.split(IMPORT_LINE).length - 1).toBe(1);
    // Both components are patched
    expect(
      result.match(/@Component\({ schemas: \[__LynxCES__\],/g)?.length,
    ).toBe(2);
  });

  it('prepends the import before everything else', () => {
    const source = `import { Component } from '@angular/core';
@Component({ selector: 'app-root' })
class App {}`;

    const result = injectLynxSchema(source);

    expect(result.indexOf(IMPORT_LINE)).toBe(0);
  });

  it('preserves existing properties after injected schema', () => {
    const source = `@Component({ selector: 'app-root', template: '<view></view>' })
class App {}`;

    const result = injectLynxSchema(source);

    expect(result).toContain(
      `@Component({ schemas: [__LynxCES__], selector: 'app-root', template: '<view></view>' })`,
    );
  });
});
