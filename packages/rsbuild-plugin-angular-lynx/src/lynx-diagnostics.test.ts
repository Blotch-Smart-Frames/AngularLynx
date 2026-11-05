// cspell:words ɵɵelement ɵɵrepeater ɵɵelementStart ɵɵtext ɵɵdomElement ɵɵdomElementStart ɵɵdomElementEnd
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLynxDiagnosticsReporter,
  type LynxDiagnostic,
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
          i0.ɵɵelementStart(0, "table");
          i0.ɵɵtext(1, "Hello");
          i0.ɵɵelementEnd();
          i0.ɵɵelement(2, "pre");
        }
      }
    `,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);

    expect(result).toHaveLength(2);
    expect(result[0]!.message).toContain('<table>');
    expect(result[0]!.message).toContain('Use <view> instead');
    expect(result[0]!.category).toBe('html-element');
    expect(result[1]!.message).toContain('<pre>');
    expect(result[1]!.message).toContain('Use <text> instead');
  });

  it('detects HTML elements in the DOM-only instructions of a component without imports', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/plain.ts',
      `
      function Plain_Template(rf, ctx) {
        if (rf & 1) {
          i0.ɵɵdomElementStart(0, "table")(1, "view");
          i0.ɵɵdomElement(2, "td");
          i0.ɵɵdomElementEnd();
        }
      }
    `,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);

    expect(result.map((d) => d.message)).toEqual([
      expect.stringContaining('<table> is not a Lynx element'),
      expect.stringContaining('<td> is not a Lynx element. Use <view>'),
    ]);
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

  it('does not warn for the HTML tags the runtime renders as Lynx elements', () => {
    // The runtime's lists of them (lynx-document/web-tags.ts): a tag there
    // renders, as a view, text or image, so a warning would be wrong.
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-document/web-tags.ts',
      ),
      'utf-8',
    );
    const lists = [...source.matchAll(/const \w+_TAGS = \[([^\]]*)\]/g)];
    const tags = [
      ...lists.flatMap(([, list]) =>
        [...list!.matchAll(/'([a-z0-9]+)'/g)].map(([, tag]) => tag!),
      ),
      'img',
    ];
    expect(tags).toEqual(expect.arrayContaining(['div', 'span', 'button']));
    const fileCache = new Map<string, string>([
      [
        '/src/app/app.ts',
        tags.map((tag, i) => `i0.ɵɵelement(${i}, "${tag}");`).join('\n'),
      ],
    ]);

    expect(scanCompiledOutputForHtmlElements(fileCache)).toEqual([]);
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
      i0.ɵɵelementStart(0, "table");
      i0.ɵɵelementEnd();
      i0.ɵɵelementStart(1, "table");
      i0.ɵɵelementEnd();
      i0.ɵɵelementStart(2, "table");
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
      `i0.ɵɵelementStart(0, "table");`,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);
    expect(result).toHaveLength(0);
  });

  it('reports elements with no Lynx equivalent differently', () => {
    const fileCache = new Map<string, string>();
    fileCache.set('/src/app/app.ts', `i0.ɵɵelement(0, "iframe");`);

    const result = scanCompiledOutputForHtmlElements(fileCache);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain('<iframe>');
    expect(result[0]!.message).toContain('no Lynx equivalent');
  });

  it('handles Uint8Array contents', () => {
    const fileCache = new Map<string, string | Uint8Array>();
    const code = `i0.ɵɵelementStart(0, "table");`;
    fileCache.set('/src/app/app.ts', Buffer.from(code));

    const result = scanCompiledOutputForHtmlElements(fileCache);
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain('<table>');
  });

  it('detects elements emitted via ɵɵrepeaterCreate (@for single root)', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      // The @for insertion-point optimization emits the root tag through
      // ɵɵrepeaterCreate rather than ɵɵelementStart.
      `i0.ɵɵrepeaterCreate(0, AppComponent_For_1_Template, 2, 1, "table", null);`,
    );

    const result = scanCompiledOutputForHtmlElements(fileCache);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain('<table>');
  });

  it('detects text-replacement elements', () => {
    const fileCache = new Map<string, string>();
    fileCache.set(
      '/src/app/app.ts',
      `
      i0.ɵɵelementStart(0, "pre");
      i0.ɵɵelementStart(1, "legend");
      i0.ɵɵelement(2, "caption");
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

  it('detects list-item without list from Uint8Array contents', () => {
    const fileCache = new Map<string, string | Uint8Array>();
    const code = `
      i0.ɵɵelementStart(0, "view");
      i0.ɵɵelementStart(1, "list-item");
      i0.ɵɵelementEnd();
      i0.ɵɵelementEnd();
    `;
    fileCache.set('/src/app/app.ts', Buffer.from(code));

    const result = scanCompiledOutputForStructuralIssues(fileCache);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain('<list-item>');
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

  it('handles unreadable component files gracefully', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = scanSourcesForUnsupportedCss(['/src/app/missing.ts']);
    expect(result).toHaveLength(0);
  });

  it('detects unsupported CSS in quoted (non-backtick) inline styles', () => {
    // When the styles array uses quoted strings instead of backticks, the
    // backtick pass finds nothing and the fallback quoted-string pass runs.
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`
      import { Component } from '@angular/core';
      @Component({
        template: '<view></view>',
        styles: ['.a { float: left; }'],
      })
      export class Example {}
    `);

    const result = scanSourcesForUnsupportedCss(['/src/app/my.ts']);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain("'float'");
  });

  it('resolves and scans external styleUrls for unsupported CSS', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any) => {
      const file = String(p);
      if (file.endsWith('.ts')) {
        return `
          import { Component } from '@angular/core';
          @Component({
            template: '<view></view>',
            styleUrls: ['./my.css'],
          })
          export class Example {}
        `;
      }
      // The resolved external stylesheet contains an unsupported property.
      return '.x { outline: none; }';
    }) as typeof fs.readFileSync);

    const result = scanSourcesForUnsupportedCss(['/src/app/my.ts']);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain("'outline'");
  });

  it('ignores external styleUrls that cannot be read', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any) => {
      const file = String(p);
      if (file.endsWith('.ts')) {
        return `
          import { Component } from '@angular/core';
          @Component({
            template: '<view></view>',
            styleUrls: ['./missing.css'],
          })
          export class Example {}
        `;
      }
      throw new Error('ENOENT: external stylesheet not found');
    }) as typeof fs.readFileSync);

    const result = scanSourcesForUnsupportedCss(['/src/app/my.ts']);
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
        message:
          'src/app.ts: <table> is not a Lynx element. Use <view> instead.',
        category: 'html-element',
      },
      {
        file: '/src/app.ts',
        message:
          'src/app.ts: <iframe> has no Lynx equivalent and will not render correctly.',
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

describe('createLynxDiagnosticsReporter', () => {
  const diagnostic = (file: string): LynxDiagnostic => ({
    file,
    message: `${file}: <table> is not a Lynx element. Use <view> instead.`,
    category: 'html-element',
  });
  const modules = (...files: (string | undefined)[]) =>
    files.map((file) => ({ nameForCondition: () => file }));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports only the diagnostics of files in the bundle', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reporter = createLynxDiagnosticsReporter();

    // A shared library's web component, reached only through a type import,
    // is compiled by Angular but never bundled by rspack.
    reporter.collect([
      diagnostic('/repo/src/app/rendered.ts'),
      diagnostic('/repo/libs/common/page-frame.ts'),
    ]);
    reporter.report(
      modules('/repo/src/app/rendered.ts', '/repo/src/main.ts', undefined),
    );

    expect(warnSpy.mock.calls).toEqual([
      ['[Lynx] HTML elements detected in templates:'],
      [
        '  /repo/src/app/rendered.ts: <table> is not a Lynx element. Use <view> instead.',
      ],
    ]);
  });

  it('matches files whatever form their paths take', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reporter = createLynxDiagnosticsReporter();

    reporter.collect([diagnostic('/repo/src/./app.ts')]);
    reporter.report(modules('/repo/src/lib/../app.ts'));

    expect(warnSpy).toHaveBeenCalledWith(
      '[Lynx] HTML elements detected in templates:',
    );
  });

  it('reports each compile once, and nothing before the first compile', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reporter = createLynxDiagnosticsReporter();

    reporter.report(modules('/repo/src/app.ts'));
    expect(warnSpy).not.toHaveBeenCalled();

    reporter.collect([diagnostic('/repo/src/app.ts')]);
    reporter.report(modules('/repo/src/app.ts'));
    // A rebuild without an Angular compile, e.g. a global CSS edit.
    reporter.report(modules('/repo/src/app.ts'));

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
