// @vitest-environment jsdom
//
// Which element directives the Lynx renderer stops Angular matching, read
// from definitions Angular's JIT compiler makes. Emptying a directive's
// selectors lasts for the rest of the file, so the tests read the selectors
// each directive declares from the copy taken below, before any test runs.
import '@angular/compiler';
import {
  Component,
  Directive,
  type Type,
  ɵgetComponentDef as getComponentDef,
  ɵgetDirectiveDef as getDirectiveDef,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import { LynxElementBase } from './base';
import {
  DECLARATION_ONLY_TAGS,
  stopMatchingDeclarationOnlyElements,
} from './declaration-only';
import {
  LYNX_ELEMENTS,
  LynxImage,
  LynxInput,
  LynxSvg,
  LynxText,
  LynxView,
} from './index';

const selectorsOf = (type: Type<unknown>): unknown =>
  getDirectiveDef(type)!.selectors;

// Before any test empties them.
const declaredSelectors = new Map<Type<unknown>, unknown>(
  LYNX_ELEMENTS.map((type: Type<unknown>) => [type, selectorsOf(type)]),
);

/**
 * A directive of an app's own on every `<view>`.
 */
@Directive({ selector: 'view' })
class AppView {}

@Component({
  imports: [LYNX_ELEMENTS, AppView],
  template: ` <view><text>a</text><image src="b" /><input value="c" /></view> `,
})
class Screen {}

describe('DECLARATION_ONLY_TAGS', () => {
  it("is the tags of the element directives that only declare attributes, which is every one that keeps LynxElementBase's ngOnChanges", () => {
    const declarationOnly = LYNX_ELEMENTS.filter(
      (type: Type<unknown>) =>
        Object.getPrototypeOf(type) === LynxElementBase &&
        (type.prototype as Partial<LynxElementBase>).ngOnChanges ===
          LynxElementBase.prototype.ngOnChanges,
    );
    const tags = declarationOnly.map((type) => {
      const selectors = declaredSelectors.get(type) as string[][];
      expect(selectors).toHaveLength(1);
      expect(selectors[0]).toHaveLength(1);
      return selectors[0][0];
    });

    expect(new Set(tags)).toEqual(DECLARATION_ONLY_TAGS);
    expect(DECLARATION_ONLY_TAGS).not.toContain('input');
    expect(DECLARATION_ONLY_TAGS).not.toContain('textarea');
  });

  it('names directives that add nothing to the element: no host bindings, outputs, queries, providers or methods', () => {
    const declarationOnly = LYNX_ELEMENTS.filter((type: Type<unknown>) => {
      const selectors = declaredSelectors.get(type) as string[][];
      return DECLARATION_ONLY_TAGS.has(selectors[0]?.[0]);
    });
    expect(declarationOnly).toHaveLength(DECLARATION_ONLY_TAGS.size);
    for (const type of declarationOnly) {
      const definition = getDirectiveDef(type)!;
      expect(definition.hostBindings).toBeNull();
      expect(definition.hostAttrs).toBeNull();
      expect(definition.outputs).toEqual({});
      expect(definition.viewQuery).toBeNull();
      expect(definition.contentQueries).toBeNull();
      expect(definition.providersResolver).toBeNull();
      expect(definition.exportAs).toBeNull();
      expect(Object.getOwnPropertyNames(type.prototype)).toEqual([
        'constructor',
      ]);
    }
  });
});

describe('stopMatchingDeclarationOnlyElements', () => {
  it("empties the selectors of the declaration-only element directives a component's template can use, and no others", () => {
    stopMatchingDeclarationOnlyElements(getComponentDef(Screen)!);

    expect(selectorsOf(LynxView)).toEqual([]);
    expect(selectorsOf(LynxText)).toEqual([]);
    expect(selectorsOf(LynxImage)).toEqual([]);
    // It shows a field's value as its text, which the renderer doesn't.
    expect(selectorsOf(LynxInput)).toEqual(declaredSelectors.get(LynxInput));
    // The app's own directive on the same tag still matches.
    expect(selectorsOf(AppView)).toEqual([['view']]);
    // The component itself.
    expect(getComponentDef(Screen)!.selectors).toEqual([['ng-component']]);
  });

  it('reads a list of definitions as well as the function Angular compiles', () => {
    stopMatchingDeclarationOnlyElements({
      directiveDefs: [getDirectiveDef(LynxSvg), null],
    } as never);

    expect(selectorsOf(LynxSvg)).toEqual([]);
  });

  it('leaves a renderer type with no directives, or seen before, alone', () => {
    const type = { id: 'x', encapsulation: 0, styles: [], data: {} };

    expect(() => stopMatchingDeclarationOnlyElements(type)).not.toThrow();

    let reads = 0;
    const component = {
      get directiveDefs() {
        reads++;
        return null;
      },
    };
    stopMatchingDeclarationOnlyElements(component as never);
    stopMatchingDeclarationOnlyElements(component as never);
    expect(reads).toBe(1);
  });
});
