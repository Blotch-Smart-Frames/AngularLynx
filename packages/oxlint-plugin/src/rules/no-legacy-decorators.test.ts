import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

type Diagnostic = {
  message: string;
  code: string;
  severity: string;
};

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

const lint = (code: string): Diagnostic[] => {
  const dir = mkdtempSync(join(tmpdir(), 'oxlint-test-'));
  const file = join(dir, 'test.ts');
  writeFileSync(file, code);
  try {
    const output = execSync(`npx oxlint --format=json ${file}`, {
      encoding: 'utf-8',
      cwd: ROOT,
    });
    const result = JSON.parse(output);
    return result.diagnostics.filter((d: Diagnostic) =>
      d.code.includes('no-legacy-decorators'),
    );
  } catch (e: any) {
    const result = JSON.parse(e.stdout);
    return result.diagnostics.filter((d: Diagnostic) =>
      d.code.includes('no-legacy-decorators'),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
};

const fix = (code: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'oxlint-test-'));
  const file = join(dir, 'test.ts');
  writeFileSync(file, code);
  try {
    execSync(`npx oxlint --fix ${file}`, {
      encoding: 'utf-8',
      cwd: ROOT,
    });
  } catch {
    // oxlint exits non-zero when it reports errors even after fixing
  }
  const result = readFileSync(file, 'utf-8');
  rmSync(dir, { recursive: true });
  return result;
};

describe('no-legacy-decorators', () => {
  describe('@Input detection and fix', () => {
    it('reports @Input() decorator', () => {
      const diagnostics = lint(`
        import { Input, Component } from '@angular/core';
        @Component({})
        class Foo { @Input() name = ''; }
      `);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('input()');
    });

    it('reports @Input without parentheses', () => {
      const diagnostics = lint(`
        import { Input, Component } from '@angular/core';
        @Component({})
        class Foo { @Input name = ''; }
      `);
      expect(diagnostics).toHaveLength(1);
    });

    it('fixes @Input() with default value', () => {
      const result = fix(`
import { Input, Component, Output, EventEmitter, ViewChild, ElementRef, ViewChildren, QueryList, ContentChild, ContentChildren, HostBinding, HostListener } from '@angular/core';
@Component({})
class Foo { @Input() name = 'hello'; }
`);
      expect(result).toContain("readonly name = input('hello')");
    });

    it('fixes @Input() with required (definite assignment)', () => {
      const result = fix(`
@Component({})
class Foo { @Input() name!: string; }
`);
      expect(result).toContain('readonly name = input.required<string>()');
    });

    it('fixes @Input({required: true})', () => {
      const result = fix(`
@Component({})
class Foo { @Input({required: true}) name!: string; }
`);
      expect(result).toContain('readonly name = input.required<string>()');
    });

    it('fixes @Input with alias shorthand', () => {
      const result = fix(`
@Component({})
class Foo { @Input('myAlias') name = ''; }
`);
      expect(result).toContain(
        "readonly name = input('', { alias: 'myAlias' })",
      );
    });
  });

  describe('@Output detection and fix', () => {
    it('reports @Output() decorator', () => {
      const diagnostics = lint(`
        import { Output, EventEmitter, Component } from '@angular/core';
        @Component({})
        class Foo { @Output() click = new EventEmitter<void>(); }
      `);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('output()');
    });

    it('fixes @Output() with EventEmitter', () => {
      const result = fix(`
@Component({})
class Foo { @Output() clicked = new EventEmitter<void>(); }
`);
      expect(result).toContain('readonly clicked = output<void>()');
    });

    it('fixes @Output() with typed EventEmitter', () => {
      const result = fix(`
@Component({})
class Foo { @Output() selected = new EventEmitter<string>(); }
`);
      expect(result).toContain('readonly selected = output<string>()');
    });

    it('fixes @Output with alias shorthand', () => {
      const result = fix(`
@Component({})
class Foo { @Output('valueChange') changed = new EventEmitter<number>(); }
`);
      expect(result).toContain(
        "readonly changed = output<number>({ alias: 'valueChange' })",
      );
    });
  });

  describe('@ViewChild detection and fix', () => {
    it('reports @ViewChild() decorator', () => {
      const diagnostics = lint(`
        import { ViewChild, ElementRef, Component } from '@angular/core';
        @Component({})
        class Foo { @ViewChild('myRef') el!: ElementRef; }
      `);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('viewChild()');
    });

    it('fixes @ViewChild with string ref (required)', () => {
      const result = fix(`
@Component({})
class Foo { @ViewChild('canvas') el!: ElementRef; }
`);
      expect(result).toContain(
        "readonly el = viewChild.required<ElementRef>('canvas')",
      );
    });

    it('fixes @ViewChild with component class', () => {
      const result = fix(`
class ChildComp {}
@Component({})
class Foo { @ViewChild(ChildComp) child!: ChildComp; }
`);
      expect(result).toContain(
        'readonly child = viewChild.required<ChildComp>(ChildComp)',
      );
    });

    it('fixes @ViewChild with read option', () => {
      const result = fix(`
@Component({})
class Foo { @ViewChild('canvas', { read: ElementRef }) el!: ElementRef; }
`);
      expect(result).toContain(
        "readonly el = viewChild.required<ElementRef>('canvas', { read: ElementRef })",
      );
    });
  });

  describe('@ViewChildren detection and fix', () => {
    it('reports @ViewChildren() decorator', () => {
      const diagnostics = lint(`
        import { ViewChildren, QueryList, Component } from '@angular/core';
        class Item {}
        @Component({})
        class Foo { @ViewChildren(Item) items!: QueryList<Item>; }
      `);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('viewChildren()');
    });

    it('fixes @ViewChildren with component class', () => {
      const result = fix(`
class Item {}
@Component({})
class Foo { @ViewChildren(Item) items!: QueryList<Item>; }
`);
      expect(result).toContain('readonly items = viewChildren<Item>(Item)');
    });
  });

  describe('@ContentChild detection and fix', () => {
    it('reports @ContentChild() decorator', () => {
      const diagnostics = lint(`
        import { ContentChild, Component } from '@angular/core';
        class Panel {}
        @Component({})
        class Foo { @ContentChild(Panel) panel!: Panel; }
      `);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('contentChild()');
    });

    it('fixes @ContentChild with required', () => {
      const result = fix(`
class Panel {}
@Component({})
class Foo { @ContentChild(Panel) panel!: Panel; }
`);
      expect(result).toContain(
        'readonly panel = contentChild.required<Panel>(Panel)',
      );
    });
  });

  describe('@ContentChildren detection and fix', () => {
    it('reports @ContentChildren() decorator', () => {
      const diagnostics = lint(`
        import { ContentChildren, QueryList, Component } from '@angular/core';
        class Tab {}
        @Component({})
        class Foo { @ContentChildren(Tab) tabs!: QueryList<Tab>; }
      `);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('contentChildren()');
    });

    it('fixes @ContentChildren', () => {
      const result = fix(`
class Tab {}
@Component({})
class Foo { @ContentChildren(Tab) tabs!: QueryList<Tab>; }
`);
      expect(result).toContain('readonly tabs = contentChildren<Tab>(Tab)');
    });
  });

  describe('@HostBinding detection (no fix)', () => {
    it('reports @HostBinding() decorator', () => {
      const diagnostics = lint(`
        import { HostBinding, Component } from '@angular/core';
        @Component({})
        class Foo { @HostBinding('class.active') isActive = false; }
      `);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('host');
    });

    it('does not auto-fix @HostBinding', () => {
      const code = `
@Component({})
class Foo { @HostBinding('class.active') isActive = false; }
`;
      const result = fix(code);
      // Should remain unchanged — no auto-fix for HostBinding
      expect(result).toContain('@HostBinding');
    });
  });

  describe('@HostListener detection (no fix)', () => {
    it('reports @HostListener() decorator', () => {
      const diagnostics = lint(`
        import { HostListener, Component } from '@angular/core';
        @Component({})
        class Foo { @HostListener('click') onClick() {} }
      `);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('host');
    });

    it('does not auto-fix @HostListener', () => {
      const code = `
@Component({})
class Foo { @HostListener('click') onClick() {} }
`;
      const result = fix(code);
      expect(result).toContain('@HostListener');
    });
  });

  describe('no false positives', () => {
    it('does not report signal-based input()', () => {
      const diagnostics = lint(`
        import { input, Component } from '@angular/core';
        @Component({})
        class Foo { readonly name = input(''); }
      `);
      expect(diagnostics).toHaveLength(0);
    });

    it('does not report signal-based output()', () => {
      const diagnostics = lint(`
        import { output, Component } from '@angular/core';
        @Component({})
        class Foo { readonly click = output<void>(); }
      `);
      expect(diagnostics).toHaveLength(0);
    });

    it('does not report signal-based viewChild()', () => {
      const diagnostics = lint(`
        import { viewChild, ElementRef, Component } from '@angular/core';
        @Component({})
        class Foo { readonly el = viewChild.required<ElementRef>('canvas'); }
      `);
      expect(diagnostics).toHaveLength(0);
    });

    it('does not report signal-based viewChildren()', () => {
      const diagnostics = lint(`
        import { viewChildren, Component } from '@angular/core';
        class Item {}
        @Component({})
        class Foo { readonly items = viewChildren(Item); }
      `);
      expect(diagnostics).toHaveLength(0);
    });

    it('does not report unrelated decorators', () => {
      const diagnostics = lint(`
        import { Component } from '@angular/core';
        function Custom() { return (target: any) => target; }
        @Component({})
        class Foo { @Custom() value = ''; }
      `);
      expect(diagnostics).toHaveLength(0);
    });
  });
});
