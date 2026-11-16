import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ellipsisClasses,
  scanTemplatesForCappedTextWithoutEllipsis,
} from './capped-text';

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'capped-text-'));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * Writes the files, relative to the test's directory, and returns their paths.
 */
const write = (files: Record<string, string>): string[] =>
  Object.entries(files).map(([name, contents]) => {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  });

/**
 * A component whose template is `template`, inline.
 */
const component = (template: string, metadata = ''): string => `
import { Component } from '@angular/core';

@Component({
  selector: 'app-row',${metadata}
  template: \`${template}\`,
})
export class Row {}
`;

/**
 * The messages for the files.
 */
const scan = async (files: Record<string, string>): Promise<string[]> =>
  (await scanTemplatesForCappedTextWithoutEllipsis(write(files))).map(
    ({ message }) => message,
  );

describe('scanTemplatesForCappedTextWithoutEllipsis', () => {
  it('flags a text capped without an ellipsis, at its line and column', async () => {
    const [file] = write({
      'row.ts': component(`
    <view>
      <text text-maxline="2">{{ title }}</text>
    </view>`),
    });

    const diagnostics = await scanTemplatesForCappedTextWithoutEllipsis([
      file!,
    ]);

    // The template starts on line 6 of the file, so its third line is 8.
    expect(diagnostics).toEqual([
      {
        file,
        message: `${path.relative(process.cwd(), file!)}:8:7: <text> sets text-maxline without text-overflow: ellipsis. Add the text-ellipsis class.`,
        category: 'text',
        excusedByStylesheet: expect.any(Function),
      },
    ]);
  });

  // The app's global stylesheets are only known once the bundle is, so the
  // report asks each diagnostic whether one of them excuses it.
  it('is excused by a stylesheet that ends one of the text’s classes with an ellipsis', async () => {
    const [classed, bare] = await scanTemplatesForCappedTextWithoutEllipsis(
      write({
        'row.ts': component(`
          <text class="summary text-sm" text-maxline="2">A</text>
          <text text-maxline="2">B</text>`),
      }),
    );

    expect(
      classed!.excusedByStylesheet!('.summary { text-overflow: ellipsis; }'),
    ).toBe(true);
    expect(
      classed!.excusedByStylesheet!('.title { text-overflow: ellipsis; }'),
    ).toBe(false);
    expect(
      bare!.excusedByStylesheet!('.summary { text-overflow: ellipsis; }'),
    ).toBe(false);
  });

  it('counts the column from the quote on the template’s first line', async () => {
    expect(
      await scan({ 'row.ts': component(`<text [text-maxline]="1">A</text>`) }),
    ).toEqual([
      expect.stringMatching(/row\.ts:6:14: <text> sets text-maxline/),
    ]);
  });

  it('flags [text-maxline] and [attr.text-maxline] like the attribute', async () => {
    expect(
      await scan({
        'row.ts': component(`
          <text [text-maxline]="lines">A</text>
          <text [attr.text-maxline]="lines">B</text>`),
      }),
    ).toHaveLength(2);
  });

  it('suggests maxLines for a ui-text, whose input sets both', async () => {
    expect(
      await scan({
        'row.ts': component(`
          <ui-text text-maxline="2">A</ui-text>
          <ui-text [maxLines]="2">B</ui-text>`),
      }),
    ).toEqual([
      expect.stringContaining(
        '<ui-text> sets text-maxline without text-overflow: ellipsis. Use [maxLines] instead, which sets both.',
      ),
    ]);
  });

  it.each([
    ['the text-ellipsis class', `class="text-sm text-ellipsis"`],
    ['the truncate class', `class="truncate"`],
    ['an inline style', `style="color: red; text-overflow: ellipsis"`],
    ['a class binding', `[class.text-ellipsis]="capped"`],
    ['a style binding', `[style.text-overflow]="'ellipsis'"`],
    ['a camelCase style binding', `[style.textOverflow]="'ellipsis'"`],
  ])('accepts an ellipsis set by %s', async (_, attribute) => {
    expect(
      await scan({
        'row.ts': component(`<text text-maxline="2" ${attribute}>A</text>`),
      }),
    ).toEqual([]);
  });

  it('finds texts inside control flow, structural directives and other elements', async () => {
    expect(
      await scan({
        'row.ts': component(`
          @if (open) {
            @for (item of items; track item) {
              <view><text text-maxline="1">{{ item }}</text></view>
            }
          }
          <text *ngIf="open" text-maxline="1">B</text>`),
      }),
    ).toHaveLength(2);
  });

  describe('with classes the template can’t read', () => {
    it('trusts a class binding when the component sets an ellipsis somewhere', async () => {
      expect(
        await scan({
          'row.ts': `${component(`<text [class]="titleClass()" text-maxline="1">A</text>`)}
const titleClass = () => 'text-ellipsis text-sm';
`,
        }),
      ).toEqual([]);
    });

    it('flags a class binding when the component never sets one', async () => {
      expect(
        await scan({
          'row.ts': component(
            `<text [class]="titleClass()" text-maxline="1">A</text>`,
          ),
        }),
      ).toHaveLength(1);
    });

    it.each([
      ['[ngClass]', `[ngClass]="classes"`],
      ['[style]', `[style]="styles"`],
      ['[attr.class]', `[attr.class]="classes"`],
      ['an interpolated class', `class="row {{ tone }}"`],
    ])('trusts %s the same way', async (_, attribute) => {
      expect(
        await scan({
          'row.ts': component(
            `<text ${attribute} text-maxline="1">A</text>`,
            `\n  styles: ['.title { text-overflow: ellipsis; }'],`,
          ),
        }),
      ).toEqual([]);
    });

    it('trusts a static class when the component’s styles set an ellipsis', async () => {
      expect(
        await scan({
          'row.ts': component(
            `<text class="title" text-maxline="1">A</text>`,
            `\n  styles: \`.title { text-overflow: ellipsis; }\`,`,
          ),
        }),
      ).toEqual([]);
    });

    it('reads the styles from styleUrl and styleUrls', async () => {
      expect(
        await scan({
          'title.css': '.title { text-overflow: ellipsis; }',
          'one.ts': component(
            `<text class="title" text-maxline="1">A</text>`,
            `\n  styleUrl: './title.css',`,
          ),
          'many.ts': component(
            `<text class="title" text-maxline="1">A</text>`,
            `\n  styleUrls: ['./title.css', './missing.css'],`,
          ),
        }),
      ).toEqual([]);
    });

    it('flags a static class when the component’s styles end only other classes with one', async () => {
      expect(
        await scan({
          'row.ts': component(
            `<text class="title" text-maxline="1">A</text>`,
            `\n  styles: ['.caption { text-overflow: ellipsis; }'],`,
          ),
        }),
      ).toHaveLength(1);
    });

    it('flags a static class the component’s styles don’t cap', async () => {
      expect(
        await scan({
          'row.ts': component(
            `<text class="title" text-maxline="1">A</text>`,
            `\n  styles: [\`.title { color: red; }\`, sharedStyles],`,
          ),
        }),
      ).toHaveLength(1);
    });

    it('doesn’t take an ellipsis elsewhere in the component for a static class', async () => {
      expect(
        await scan({
          'row.ts': component(`
            <text class="text-sm" text-maxline="1">A</text>
            <text class="text-ellipsis" text-maxline="1">B</text>`),
        }),
      ).toHaveLength(1);
    });
  });

  it('reads a templateUrl, and reports the HTML’s line for the component', async () => {
    const [html, file] = write({
      'row.html': '<view>\n  <text text-maxline="3">A</text>\n</view>\n',
      'row.ts': `
import { Component } from '@angular/core';

@Component({ selector: 'app-row', templateUrl: './row.html' })
export class Row {}
`,
    });

    const diagnostics = await scanTemplatesForCappedTextWithoutEllipsis([
      html!,
      file!,
    ]);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        file,
        message: expect.stringContaining(
          `${path.relative(process.cwd(), html!)}:2:3: <text>`,
        ),
      }),
    ]);
  });

  it('ignores what isn’t a component template it can read', async () => {
    expect(
      await scan({
        // Not a component.
        'plain.ts': `export const lines = '<text text-maxline="1">A</text>';`,
        // Under node_modules: a library's to fix.
        'node_modules/lib/row.ts': component(`<text text-maxline="1">A</text>`),
        // A template that caps nothing.
        'empty.ts': component(`<text>A</text>`),
        // A templateUrl that isn't there, or doesn't cap.
        'missing.ts': `@Component({ templateUrl: './missing.html' }) class A {}`,
        'missing-capped.ts': `@Component({ templateUrl: './missing.html' }) class A {} // text-maxline`,
        'uncapped.html': '<text>A</text>',
        'uncapped.ts': `@Component({ templateUrl: './uncapped.html' }) class A {} // text-maxline`,
        // Metadata it can't read: a template from a variable, a computed or
        // shorthand property, no metadata, a decorator that isn't a call.
        'dynamic.ts': `
          const template = '<text text-maxline="1">A</text>';
          @Component({ template, ['template']: template, ...base }) class A {}
          @Component({ template: template }) class B {}
          @Component() class C {}
          @Component(metadata) class D {}
          @Component class E {}
          @(factory()({})) class F {}
          @factory()({ template: '<text text-maxline="1">A</text>' }) class H {}
          @Component({ templateUrl: url, styles: sharedStyles }) class I {}
          @ns.Directive({ template: '<text text-maxline="1">A</text>' }) class G {}
        `,
      }),
    ).toEqual([]);
    expect(
      await scanTemplatesForCappedTextWithoutEllipsis([
        path.join(directory, 'does-not-exist.ts'),
      ]),
    ).toEqual([]);
  });

  it('reads a component decorator through a namespace', async () => {
    expect(
      await scan({
        'row.ts': `
import * as core from '@angular/core';

@core.Component({ selector: 'app-row', template: '<text text-maxline="1">A</text>' })
export class Row {}
`,
      }),
    ).toHaveLength(1);
  });
});

describe('ellipsisClasses', () => {
  it('finds the classes of the rules that set an ellipsis', () => {
    expect(
      ellipsisClasses(`
        /* .commented { text-overflow: ellipsis; } */
        .card .title, .caption:first-child { text-overflow:ellipsis }
        .plain { color: red; }
        @media (min-width: 600px) {
          .wide { overflow: hidden; text-overflow: ellipsis; }
        }
        text { text-overflow: ellipsis; }
      `),
    ).toEqual(new Set(['card', 'title', 'caption', 'wide']));
  });

  it('finds none in a stylesheet without one', () => {
    expect(ellipsisClasses('.a { text-overflow: clip; }')).toEqual(new Set());
  });
});
