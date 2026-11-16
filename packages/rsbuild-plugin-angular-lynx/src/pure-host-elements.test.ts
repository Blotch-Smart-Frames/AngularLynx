import { describe, expect, it } from 'vitest';
import { markHostElementsPure } from './pure-host-elements.js';

const FILE = '/proj/src/components/ui/card/card.mjs';
const mark = (...lines: string[]): string =>
  markHostElementsPure(lines.join('\n'), FILE);

describe('markHostElementsPure', () => {
  it('marks a top-level registration of the runtime’s function pure', () => {
    expect(
      mark(
        "import { LYNX_ELEMENTS, registerHostElement } from '@blotch/angular-lynx';",
        'class UiCardTitle {}',
        "registerHostElement(UiCardTitle, 'text');",
        "registerHostElement(UiCardDescription, 'text');",
      ),
    ).toBe(
      [
        "import { LYNX_ELEMENTS, registerHostElement } from '@blotch/angular-lynx';",
        'class UiCardTitle {}',
        "/*#__PURE__*/ registerHostElement(UiCardTitle, 'text');",
        "/*#__PURE__*/ registerHostElement(UiCardDescription, 'text');",
      ].join('\n'),
    );
  });

  it('follows an `as` name, and leaves a function of the module’s own', () => {
    expect(
      mark(
        "import { registerHostElement as asText } from '@blotch/angular-lynx';",
        'function registerHostElement() {}',
        "asText(UiLabel, 'text');",
        "registerHostElement(UiLabel, 'text');",
      ),
    ).toBe(
      [
        "import { registerHostElement as asText } from '@blotch/angular-lynx';",
        'function registerHostElement() {}',
        "/*#__PURE__*/ asText(UiLabel, 'text');",
        "registerHostElement(UiLabel, 'text');",
      ].join('\n'),
    );
  });

  it('follows a namespace import', () => {
    expect(
      mark(
        "import * as i1 from '@blotch/angular-lynx';",
        "i1.registerHostElement(UiText, 'text');",
        "i1.provideRenderer(UiText, 'text');",
        "other.registerHostElement(UiText, 'text');",
        "i1.lib.registerHostElement(UiText, 'text');",
      ),
    ).toBe(
      [
        "import * as i1 from '@blotch/angular-lynx';",
        "/*#__PURE__*/ i1.registerHostElement(UiText, 'text');",
        "i1.provideRenderer(UiText, 'text');",
        "other.registerHostElement(UiText, 'text');",
        "i1.lib.registerHostElement(UiText, 'text');",
      ].join('\n'),
    );
  });

  it('leaves a call inside a function, which runs only when called', () => {
    const code = [
      "import { registerHostElement } from '@blotch/angular-lynx';",
      "export const setUp = () => registerHostElement(UiText, 'text');",
      "if (ready) registerHostElement(UiText, 'text');",
    ];
    expect(mark(...code)).toBe(code.join('\n'));
  });

  it('leaves the same name imported from elsewhere, or only as a type', () => {
    const code = [
      "import { registerHostElement } from './host-elements';",
      "import type { registerHostElement as typed } from '@blotch/angular-lynx';",
      "import { type registerHostElement as alsoTyped } from '@blotch/angular-lynx';",
      "import angularLynx from '@blotch/angular-lynx';",
      "import '@blotch/angular-lynx';",
      "registerHostElement(UiText, 'text');",
      "typed(UiText, 'text');",
      "alsoTyped(UiText, 'text');",
    ];
    expect(mark(...code)).toBe(code.join('\n'));
  });

  it('leaves statements that are no call, or no call of a name', () => {
    const code = [
      "import { registerHostElement } from '@blotch/angular-lynx';",
      'registerHostElement;',
      "(0, registerHostElement)(UiText, 'text');",
      "registerHostElement(UiText, 'text')(other);",
    ];
    expect(mark(...code)).toBe(code.join('\n'));
  });

  it('returns a module that never names it as it is', () => {
    const code = "import { LYNX_ELEMENTS } from '@blotch/angular-lynx';";
    expect(markHostElementsPure(code, FILE)).toBe(code);
  });

  // Angular's development output keeps types, which SWC strips later.
  it('reads a .ts module as TypeScript', () => {
    expect(
      markHostElementsPure(
        [
          "import { registerHostElement } from '@blotch/angular-lynx';",
          'const tag: HostElementTag = <HostElementTag>"text";',
          'registerHostElement(UiText as Type<unknown>, tag);',
        ].join('\n'),
        '/proj/src/app/text.ts',
      ),
    ).toContain(
      '/*#__PURE__*/ registerHostElement(UiText as Type<unknown>, tag);',
    );
  });
});
