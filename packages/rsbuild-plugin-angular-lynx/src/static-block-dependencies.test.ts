// cspell:words ɵɵDirectiveDeclaration ɵɵComponentDeclaration ɵɵPipeDeclaration ɵɵdefineComponent
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createDependencyResolver,
  parseSelector,
} from './static-block-dependencies.js';

describe('parseSelector', () => {
  it.each([
    ['view', [['view']]],
    ['[routerLink]', [['', 'routerLink', '']]],
    ['[mode=aspectFit]', [['', 'mode', '']]],
    [
      'button[uiButton], a[uiButton]',
      [
        ['button', 'uiButton', ''],
        ['a', 'uiButton', ''],
      ],
    ],
    ['.card.raised', [['', 8, 'card', 'raised']]],
    ['view:not(.x)', [['view', 1]]],
    ['view > text', [['view', 1]]],
  ])('reads %s', (selector, expected) => {
    expect(parseSelector(selector)).toEqual(expected);
  });
});

describe('createDependencyResolver', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-deps-'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, text: string) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
  };
  write(
    'node_modules/lib/package.json',
    JSON.stringify({ name: 'lib', types: './index.d.ts' }),
  );
  write(
    'node_modules/lib/index.d.ts',
    [
      "export { V as LynxView, Link } from './chunk';",
      "export * from './more';",
    ].join('\n'),
  );
  write(
    'node_modules/lib/chunk.d.ts',
    [
      'import * as i0 from "@angular/core";',
      'declare class LynxElementBase {}',
      'declare class V extends LynxElementBase {',
      '  static ɵdir: i0.ɵɵDirectiveDeclaration<V, "view", never, {}, {}, never, never, true, never>;',
      '}',
      'declare class Link {',
      '  static ɵdir: i0.ɵɵDirectiveDeclaration<Link, "[routerLink]", never, {}, {}, never, never, true, never>;',
      '}',
      'export { V, Link };',
    ].join('\n'),
  );
  write(
    'node_modules/lib/more.d.ts',
    [
      'import * as i0 from "@angular/core";',
      'export declare class DatePipe {',
      '  static ɵpipe: i0.ɵɵPipeDeclaration<DatePipe, "date", true>;',
      '}',
      'export declare class Host {',
      '  static ɵdir: i0.ɵɵDirectiveDeclaration<Host, never, never, {}, {}, never, never, true, never>;',
      '}',
      'import { ɵɵDirectiveDeclaration } from "@angular/core";',
      'export declare class MyView {',
      '  static ɵfac: i0.ɵɵFactoryDeclaration<MyView, never>;',
      '  method(): void;',
      '  static ɵdir: ɵɵDirectiveDeclaration<MyView, "view", never, {}, {}, never, never, true, never>;',
      '}',
      'export declare class Wide {',
      '  static ɵdir: i0.ɵɵDirectiveDeclaration<Wide, string, never, {}, {}, never, never, true, never>;',
      '}',
      "export { Gone } from './nowhere';",
      "export * from './nowhere';",
      "export * from './loop';",
      'export declare class Card {',
      '  static ɵcmp: i0.ɵɵComponentDeclaration<Card, "ui-card", never, {}, {}, never, ["*"], true, never>;',
      '}',
    ].join('\n'),
  );
  write('node_modules/lib/loop.d.ts', "export * from './loop';");
  const app = path.join(root, 'src/app.ts');
  const button = path.join(root, 'src/button.ts');
  write('src/button.ts', '');
  write('src/index.ts', '');
  write('src/not-compiled.ts', '');
  const compiled: Record<string, string> = {
    [button]:
      'export class UiButton { static ɵcmp = i0.ɵɵdefineComponent({ type: UiButton, selectors: [["button", "uiButton", ""]] }); }',
    [path.join(root, 'src/index.ts')]: "export * from './button';",
  };
  const resolve = createDependencyResolver((file) => compiled[file], {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
  })(app);

  it('reads a library’s declarations through its re-exports', () => {
    expect(resolve('lib', 'Link')).toEqual([['', 'routerLink', '']]);
    expect(resolve('lib', 'DatePipe')).toBe('pipe');
    expect(resolve('lib', 'Host')).toEqual([]);
    expect(resolve('lib', 'Card')).toEqual([['ui-card']]);
  });

  it('takes the element directives the runtime stops matching to match nothing', () => {
    expect(resolve('lib', 'LynxView')).toEqual([]);
  });

  it('reads the app’s compiled modules', () => {
    expect(resolve('./button', 'UiButton')).toEqual([
      ['button', 'uiButton', ''],
    ]);
    expect(resolve('./index', 'UiButton')).toEqual([
      ['button', 'uiButton', ''],
    ]);
  });

  it('reads a directive of the app’s own that selects a Lynx tag', () => {
    expect(resolve('lib', 'MyView')).toEqual([['view']]);
  });

  it('knows nothing of what it can’t find', () => {
    expect(resolve('lib', 'Wide')).toBeNull();
    expect(resolve('lib', 'Gone')).toBeNull();
    expect(resolve('./not-compiled', 'X')).toBeNull();
    expect(resolve('lib', 'Missing')).toBeNull();
    expect(resolve('./missing', 'X')).toBeNull();
    expect(resolve('unknown-package', 'X')).toBeNull();
  });
});
