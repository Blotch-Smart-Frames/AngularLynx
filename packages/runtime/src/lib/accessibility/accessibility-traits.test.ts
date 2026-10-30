// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type AccessibilityTraitStates,
  LynxAccessibilityTraits,
} from './accessibility-traits';

/**
 * Sets an Angular InputSignal's value using Angular's internal reactive node API.
 * Needed because JIT mode doesn't wire up signal inputs for template binding or setInput().
 */
const setInputSignal = (signalFn: any, value: any): void => {
  const symbols = Object.getOwnPropertySymbols(signalFn);
  const signalSymbol = symbols.find((s) => s.toString() === 'Symbol(SIGNAL)')!;
  const node = signalFn[signalSymbol];
  const proto = Object.getPrototypeOf(node);
  proto.applyValueToInputSignal(node, value);
};

describe('LynxAccessibilityTraits', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Creates the directive on an element that keeps the traits added to it,
   * as a Lynx element does, and records each call that adds or takes one
   * away. `bind` sets the input and runs the directive's effect.
   */
  const create = () => {
    const added = new Set<string>();
    const calls: [string, boolean][] = [];
    const element = {
      setAccessibilityTrait: (trait: string, on: boolean) => {
        calls.push([trait, on]);
        if (on) added.add(trait);
        else added.delete(trait);
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ElementRef, useValue: new ElementRef(element) }],
    });
    const directive = TestBed.runInInjectionContext(
      () => new LynxAccessibilityTraits(),
    );
    const bind = (states: AccessibilityTraitStates | null | undefined) => {
      setInputSignal(directive.lynxAccessibilityTraits, states);
      TestBed.tick();
    };
    return { added, calls, bind };
  };

  it('adds the traits that are true', () => {
    const { added, bind } = create();

    bind({ selected: true, disabled: false });

    expect([...added]).toEqual(['selected']);
  });

  it('takes a trait away when it turns false', () => {
    const { added, bind } = create();

    bind({ selected: true });
    bind({ selected: false });

    expect([...added]).toEqual([]);
  });

  it('takes a trait away when the map leaves it out', () => {
    const { added, bind } = create();

    bind({ selected: true, disabled: true });
    bind({ disabled: true });
    expect([...added]).toEqual(['disabled']);

    bind(null);
    expect([...added]).toEqual([]);
  });

  it("leaves alone a trait it didn't add", () => {
    // The element's own traits, or ones the runtime adds, such as an active
    // router link's `selected`, aren't this binding's to take away.
    const { calls, bind } = create();

    bind(undefined);
    bind({ selected: false });

    expect(calls).toEqual([]);
  });
});
