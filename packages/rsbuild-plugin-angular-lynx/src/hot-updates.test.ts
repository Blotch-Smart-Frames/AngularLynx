// cspell:words ɵɵdefine
import { describe, expect, it } from 'vitest';
import {
  addEntryHotAccept,
  addHotAccept,
  componentClassNames,
  hotUpdateSignature,
  hotUpdatesEnabled,
} from './hot-updates';

describe('hotUpdatesEnabled', () => {
  const environment = (
    name: string,
    config: { mode?: string; dev?: { hmr?: boolean } },
  ) => ({ name, config });

  it('is on for a development build of a Lynx environment', () => {
    expect(
      hotUpdatesEnabled(environment('lynx', { mode: 'development' })),
    ).toBe(true);
    expect(
      hotUpdatesEnabled(
        environment('lynx', { mode: 'development', dev: { hmr: true } }),
      ),
    ).toBe(true);
  });

  it('is off for the web preview, a production build and `dev.hmr: false`', () => {
    expect(hotUpdatesEnabled(environment('web', { mode: 'development' }))).toBe(
      false,
    );
    expect(hotUpdatesEnabled(environment('lynx', { mode: 'production' }))).toBe(
      false,
    );
    expect(
      hotUpdatesEnabled(
        environment('lynx', { mode: 'development', dev: { hmr: false } }),
      ),
    ).toBe(false);
  });
});

describe('hotUpdateSignature', () => {
  const component = (metadata: string, body = 'count = 0;') => `
import { Component } from '@angular/core';

@Component({
  selector: 'app-home',
${metadata}
})
export class Home {
  ${body}
}
`;

  const signature = (source: string) => hotUpdateSignature(source, 'home.ts');

  it('ignores edits to the template and styles', () => {
    const before = signature(
      component(`  template: '<text>Hi</text>',\n  styles: ['.a {}'],`),
    );
    expect(
      signature(
        component(`  template: '<text>Bye</text>',\n  styles: ['.b {}'],`),
      ),
    ).toBe(before);
  });

  it('ignores edits to the file paths of an external template and stylesheets', () => {
    const before = signature(
      component(
        `  templateUrl: './a.html',\n  styleUrl: './a.css',\n  styleUrls: ['./x.css'],`,
      ),
    );
    expect(
      signature(
        component(
          `  templateUrl: './b.html',\n  styleUrl: './b.css',\n  styleUrls: ['./y.css'],`,
        ),
      ),
    ).toBe(before);
  });

  it('ignores the template under a quoted key too', () => {
    expect(signature(component(`  'template': '<text>Hi</text>',`))).toBe(
      signature(component(`  'template': '<text>Bye</text>',`)),
    );
  });

  it("notices an edit to the component's class", () => {
    const before = signature(component(`  template: ''`));
    expect(signature(component(`  template: ''`, 'count = 1;'))).not.toBe(
      before,
    );
  });

  it('notices an edit to the other metadata, such as imports', () => {
    expect(signature(component(`  imports: [A],`))).not.toBe(
      signature(component(`  imports: [A, B],`)),
    );
  });

  it('notices an edit outside the class', () => {
    const source = component(`  template: ''`);
    expect(signature(`${source}\nconst x = 1;`)).not.toBe(
      signature(`${source}\nconst x = 2;`),
    );
  });

  it('only leaves out the fields of `@Component()`, by its name', () => {
    const decorated = (decorator: string, template: string) => `
${decorator}({ template: '${template}' })
export class Home {}
`;
    // A namespace import of Angular counts.
    expect(signature(decorated('@core.Component', 'a'))).toBe(
      signature(decorated('@core.Component', 'b')),
    );
    // Other decorators, and decorators that aren't called, don't.
    expect(signature(decorated('@Directive', 'a'))).not.toBe(
      signature(decorated('@Directive', 'b')),
    );
    const bare = (template: string) => `
@Component
export class Home { t = '${template}'; }
`;
    expect(signature(bare('a'))).not.toBe(signature(bare('b')));
    const computed = (template: string) => `
@(decorators[0])({ template: '${template}' })
export class Home {}
`;
    expect(signature(computed('a'))).not.toBe(signature(computed('b')));
    const noMetadata = (template: string) => `
@Component(metadata)
export class Home { t = '${template}'; }
`;
    expect(signature(noMetadata('a'))).not.toBe(signature(noMetadata('b')));
  });

  it('only leaves out plain property assignments', () => {
    const computed = (template: string) =>
      component(`  ['template']: '${template}',`);
    expect(signature(computed('a'))).not.toBe(signature(computed('b')));
    const shorthand = (name: string) =>
      `const template = '${name}';\n${component('  template,')}`;
    expect(signature(shorthand('a'))).not.toBe(signature(shorthand('b')));
  });
});

describe('componentClassNames', () => {
  it('lists the classes the module defines components for, in order', () => {
    const code = `
class Home {}
Home.ɵcmp = i0.ɵɵdefineComponent({ type: Home, selectors: [] });
export class Card {
  static ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: Card });
}
`;
    expect(componentClassNames(code, 'home.js')).toEqual(['Home', 'Card']);
  });

  it('returns nothing for a module without components', () => {
    expect(componentClassNames('export const x = 1;', 'x.js')).toEqual([]);
  });

  it('only lists classes declared at the top of the module, once each', () => {
    const code = `
export function make() {
  class Inner {}
  Inner.ɵcmp = ɵɵdefineComponent({ type: Inner });
  return Inner;
}
class Home {}
Home.ɵcmp = ɵɵdefineComponent({ type: Home });
Home.ɵcmp = ɵɵdefineComponent({ type: Home });
export default class {}
`;
    expect(componentClassNames(code, 'home.js')).toEqual(['Home']);
  });

  it('skips definitions it cannot read a class name from', () => {
    const code = `
class Home {}
ɵɵdefineComponent(definition);
ɵɵdefineComponent({ type: classes.Home });
ɵɵdefineComponent({ 'type': Home });
ɵɵdefineComponent({ ...rest });
other.ɵɵdefineComponent;
(0, i0['ɵɵdefineComponent'])({ type: Home });
`;
    expect(componentClassNames(code, 'home.js')).toEqual([]);
  });
});

describe('addHotAccept', () => {
  it("passes the module's component classes to the runtime and reassigns them", () => {
    const result = addHotAccept('class A {}\nclass B {}', {
      components: ['A', 'B'],
      signature: 'sig',
      compiled: 'compiled code',
    });

    expect(result).toContain(
      "import { ɵhmrAccept as ɵɵangularLynxHmrAccept } from '@blotch/angular-lynx';",
    );
    expect(result).toMatch(
      /if \(import\.meta\.webpackHot\) \{\n {2}\[A, B\] = ɵɵangularLynxHmrAccept\(import\.meta\.webpackHot, \[A, B\], "sig", "[0-9a-f]{16}"\);\n\}/,
    );
  });

  it("hashes the compiled code, so it changes with the module's output", () => {
    const hashOf = (compiled: string) =>
      /"([0-9a-f]{16})"\);/.exec(
        addHotAccept('', { components: ['A'], signature: 's', compiled }),
      )![1];
    expect(hashOf('a')).toBe(hashOf('a'));
    expect(hashOf('a')).not.toBe(hashOf('b'));
  });
});

describe('addEntryHotAccept', () => {
  it('makes the module accept its own hot updates', () => {
    expect(addEntryHotAccept('bootstrap();')).toBe(`bootstrap();
if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
`);
  });
});
