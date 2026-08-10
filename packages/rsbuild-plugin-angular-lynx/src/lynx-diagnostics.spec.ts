// cspell:words ɵɵelement ɵɵrepeater ɵɵelementStart ɵɵtext
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reportLynxDiagnostics,
  scanCompiledOutputForHtmlElements,
  scanCompiledOutputForStructuralIssues,
  scanSourcesForUnsupportedCss,
  scanSourcesForUnsupportedPatterns,
} from './lynx-diagnostics';

describe('scanCompiledOutputForHtmlElements', () => {
  it('detects HTML elements in compiled Angular output', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      `
      function AppComponent_Template(rf, ctx) {
        if (rf & 1) {
          i0.ɵɵelementStart(0, "div");
          i0.ɵɵtext(1, "Hello");
          i0.ɵɵelementEnd();
          i0.ɵɵelement(2, "span");
        }
      }
    `,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);

    expect(result).toHaveLength(2);
    expect(result[0]!.message).toContain('<div>');
    expect(result[0]!.message).toContain('Use <view> instead');
    expect(result[0]!.category).toBe('html-element');
    expect(result[1]!.message).toContain('<span>');
    expect(result[1]!.message).toContain('Use <text> instead');
  });

  it('does not warn for valid Lynx elements', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      `
      i0.ɵɵelementStart(0, "view");
      i0.ɵɵelement(1, "text");
      i0.ɵɵelement(2, "image");
      i0.ɵɵelement(3, "input");
      i0.ɵɵelement(4, "textarea");
      i0.ɵɵelement(5, "svg");
    `,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);
    expect(result).toHaveLength(0);
  });

  it('does not warn for hyphenated elements (Lynx or Angular components)', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      `
      i0.ɵɵelementStart(0, "scroll-view");
      i0.ɵɵelement(1, "list-item");
      i0.ɵɵelement(2, "app-header");
      i0.ɵɵelement(3, "router-outlet");
    `,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);
    expect(result).toHaveLength(0);
  });

  it('deduplicates warnings per file', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      `
      i0.ɵɵelementStart(0, "div");
      i0.ɵɵelementEnd();
      i0.ɵɵelementStart(1, "div");
      i0.ɵɵelementEnd();
      i0.ɵɵelementStart(2, "div");
      i0.ɵɵelementEnd();
    `,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);
    expect(result).toHaveLength(1);
  });

  it('skips node_modules files', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/node_modules/@angular/material/button.js',
      `i0.ɵɵelementStart(0, "div");`,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);
    expect(result).toHaveLength(0);
  });

  it('reports elements with no Lynx equivalent differently', () => {
    const fileCache = new Map<string, string>();
    fileCache.set('/src/app/app.ts', `i0.ɵɵelement(0, "canvas");`);

    const result = scanCompiledOutputForHtmlElements(fileCache);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain('<canvas>');
    expect(result[0]!.message).toContain('no Lynx equivalent');
  });

  it('handles Uint8Array contents', () => {
    const fileCache = new Map<string, string | Uint8Array>();
    const code = `i0.ɵɵelementStart(0, "div");`;
    fileCache.set('/src/app/app.ts', Buffer.from(code));

    const result = scanCompiledOutputForHtmlElements(fileCache);
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain('<div>');
  });

  it('detects text-replacement elements', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      `
      i0.ɵɵelementStart(0, "h1");
      i0.ɵɵelementStart(1, "p");
      i0.ɵɵelement(2, "strong");
    `,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);

    expect(result).toHaveLength(3);
    for (const d of result) {
      expect(d.message).toContain('Use <text> instead');
    }
  });
});

describe('scanCompiledOutputForStructuralIssues', () => {
  it('detects list-item without list parent', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      `
      i0.ɵɵelementStart(0, "view");
      i0.ɵɵelementStart(1, "list-item");
      i0.ɵɵelementEnd();
      i0.ɵɵelementEnd();
    `,
    );

    const result = scanCompiledOutputForStructuralIssues(fileCache);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain('<list-item>');
    expect(result[0]!.message).toContain('without a <list> parent');
    expect(result[0]!.category).toBe('structural');
  });

  it('does not warn when list-item is inside list', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      `
      i0.ɵɵelementStart(0, "list");
      i0.ɵɵelementStart(1, "list-item");
      i0.ɵɵelementEnd();
      i0.ɵɵelementEnd();
    `,
    );

    const result = scanCompiledOutputForStructuralIssues(fileCache);
    expect(result).toHaveLength(0);
  });

  it('skips node_modules files', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/node_modules/some-lib/index.js',
      `i0.ɵɵelementStart(0, "list-item");`,
    );

    const result = scanCompiledOutputForStructuralIssues(fileCache);
    expect(result).toHaveLength(0);
  });
});

describe('scanSourcesForUnsupportedPatterns', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects ViewEncapsulation.ShadowDom', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`
      import { Component, ViewEncapsulation } from '@angular/core';
      @Component({
        encapsulation: ViewEncapsulation.ShadowDom,
        template: '<view></view>',
      })
      export class Example {}
    `);

    const result = scanSourcesForUnsupportedPatterns(['/src/app/my.ts']);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain('ViewEncapsulation.ShadowDom');
    expect(result[0]!.message).toContain('not supported in Lynx');
    expect(result[0]!.category).toBe('structural');
  });

  it('does not warn for ViewEncapsulation.Emulated', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`
      import { Component, ViewEncapsulation } from '@angular/core';
      @Component({
        encapsulation: ViewEncapsulation.Emulated,
        template: '<view></view>',
      })
      export class Example {}
    `);

    const result = scanSourcesForUnsupportedPatterns(['/src/app/my.ts']);
    expect(result).toHaveLength(0);
  });

  it('skips node_modules files', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const result = scanSourcesForUnsupportedPatterns([
      '/node_modules/@angular/material/dialog.ts',
    ]);

    expect(result).toHaveLength(0);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('handles unreadable files gracefully', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = scanSourcesForUnsupportedPatterns(['/src/app/missing.ts']);
    expect(result).toHaveLength(0);
  });
});

describe('scanSourcesForUnsupportedCss', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects unsupported CSS properties in inline styles', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`
      import { Component } from '@angular/core';
      @Component({
        template: '<view></view>',
        styles: [\`
          .container { float: left; text-transform: uppercase; }
        \`],
      })
      export class Example {}
    `);

    const result = scanSourcesForUnsupportedCss(['/src/app/my.ts']);

    expect(result).toHaveLength(2);
    expect(result[0]!.message).toContain("'float'");
    expect(result[0]!.message).toContain('flex layout');
    expect(result[0]!.category).toBe('css');
    expect(result[1]!.message).toContain("'text-transform'");
  });

  it('does not warn for supported CSS properties', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`
      import { Component } from '@angular/core';
      @Component({
        template: '<view></view>',
        styles: [\`
          .container {
            display: flex;
            background-color: red;
            border-radius: 4px;
            padding: 16px;
          }
        \`],
      })
      export class Example {}
    `);

    const result = scanSourcesForUnsupportedCss(['/src/app/my.ts']);
    expect(result).toHaveLength(0);
  });

  it('deduplicates CSS property warnings per file', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`
      import { Component } from '@angular/core';
      @Component({
        template: '<view></view>',
        styles: [\`
          .a { float: left; }
          .b { float: right; }
        \`],
      })
      export class Example {}
    `);

    const result = scanSourcesForUnsupportedCss(['/src/app/my.ts']);
    expect(result).toHaveLength(1);
  });

  it('ignores CSS properties inside comments', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`
      import { Component } from '@angular/core';
      @Component({
        template: '<view></view>',
        styles: [\`
          /* float: left; */
          .container { display: flex; }
        \`],
      })
      export class Example {}
    `);

    const result = scanSourcesForUnsupportedCss(['/src/app/my.ts']);
    expect(result).toHaveLength(0);
  });

  it('skips files without @Component', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`
      export class MyClass {
        float = 'left';
      }
    `);

    const result = scanSourcesForUnsupportedCss(['/src/app/my.service.ts']);
    expect(result).toHaveLength(0);
  });

  it('skips node_modules files', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const result = scanSourcesForUnsupportedCss([
      '/node_modules/@angular/material/button.ts',
    ]);

    expect(result).toHaveLength(0);
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe('reportLynxDiagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when there are no diagnostics', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    reportLynxDiagnostics([]);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('groups HTML element warnings under a header', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    reportLynxDiagnostics([
      {
        file: '/src/app.ts',
        message: 'src/app.ts: <div> is not a Lynx element. Use <view> instead.',
        category: 'html-element',
      },
      {
        file: '/src/app.ts',
        message:
          'src/app.ts: <canvas> has no Lynx equivalent and will not render correctly.',
        category: 'html-element',
      },
    ]);

    expect(warnSpy).toHaveBeenCalledWith(
      '[Lynx] HTML elements detected in templates:',
    );
  });

  it('groups structural warnings under a header', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    reportLynxDiagnostics([
      {
        file: '/src/modal.ts',
        message:
          'src/modal.ts: ViewEncapsulation.ShadowDom is not supported in Lynx (falls back to None). Use Emulated instead.',
        category: 'structural',
      },
    ]);

    expect(warnSpy).toHaveBeenCalledWith('[Lynx] Structural issues:');
  });

  it('groups CSS warnings under a header', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    reportLynxDiagnostics([
      {
        file: '/src/app.ts',
        message: "src/app.ts: 'float' — use flex layout.",
        category: 'css',
      },
    ]);

    expect(warnSpy).toHaveBeenCalledWith('[Lynx] Unsupported CSS properties:');
  });
});
