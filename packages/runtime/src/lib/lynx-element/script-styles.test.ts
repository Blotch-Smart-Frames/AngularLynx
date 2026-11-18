import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainThreadElement } from '../main-thread/main-thread-element';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';
import { setSafeAreaInsets } from './safe-area-insets';

// A main-thread script's setStyleProperty() goes through the element's
// LynxElement (see script-styles.ts).
describe('a main-thread script’s inline styles', () => {
  let ref: ElementRef;
  let nextUid = 1;

  beforeEach(() => {
    ref = {} as ElementRef;
    // Each ref gets its own id, as LynxElement's registry needs.
    const uidByRef = new WeakMap<object, number>();
    vi.stubGlobal(
      '__GetElementUniqueID',
      vi.fn((element: object) => {
        let id = uidByRef.get(element);
        if (id == null) uidByRef.set(element, (id = nextUid++));
        return id;
      }),
    );
    vi.stubGlobal('__SetInlineStyles', vi.fn());
    vi.stubGlobal('__AddInlineStyle', vi.fn());
    vi.stubGlobal('__FlushElementTree', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSafeAreaInsets(undefined);
  });

  // Native parses the string waiting for the flush as soon as
  // __AddInlineStyle reaches the element, and doesn't note the variable's
  // change there: the text already drawn under it kept the old color (#477).
  it('go into the inline style string of an element that sets a variable', async () => {
    const element = new LynxElement(ref);
    element.setStyle('--primary', 'red');

    element.setStyle('--primary', 'blue');
    new MainThreadElement(ref).setStyleProperty('transform', 'translateX(4px)');

    expect(__SetInlineStyles).toHaveBeenLastCalledWith(
      ref,
      '--primary: blue; transform: translateX(4px)',
    );
    expect(__AddInlineStyle).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(__FlushElementTree).toHaveBeenCalled();
  });

  it('set several at once the same way', () => {
    const element = new LynxElement(ref);
    element.setStyle('--primary', 'red');

    new MainThreadElement(ref).setStyleProperties({
      transform: 'translateX(4px)',
      opacity: '0.5',
    });

    expect(__SetInlineStyles).toHaveBeenLastCalledWith(
      ref,
      '--primary: red; transform: translateX(4px); opacity: 0.5',
    );
    expect(__AddInlineStyle).not.toHaveBeenCalled();
  });

  // __SetInlineStyles replaces every inline style native has.
  it('are kept when the element writes its whole inline style again', () => {
    const element = new LynxElement(ref);
    new MainThreadElement(ref).setStyleProperty('transform', 'scale(2)');
    expect(__AddInlineStyle).toHaveBeenLastCalledWith(
      ref,
      'transform',
      'scale(2)',
    );

    element.setStyle('--primary', 'red');

    expect(__SetInlineStyles).toHaveBeenLastCalledWith(
      ref,
      '--primary: red; transform: scale(2)',
    );
  });

  // As a script's `element.style` write and a binding do on the web.
  it('and a [style.x] binding of the same name: the last one set wins', () => {
    const element = new LynxElement(ref);
    element.setStyle('--primary', 'red');
    element.setStyle('opacity', 1);

    new MainThreadElement(ref).setStyleProperty('opacity', '0.5');
    expect(__SetInlineStyles).toHaveBeenLastCalledWith(
      ref,
      '--primary: red; opacity: 0.5',
    );

    element.setStyle('opacity', 0.8);
    expect(__SetInlineStyles).toHaveBeenLastCalledWith(
      ref,
      '--primary: red; opacity: 0.8',
    );
  });

  // __AddInlineStyle drops a name that isn't a CSS property.
  it('can set a CSS variable', () => {
    new LynxElement(ref);

    new MainThreadElement(ref).setStyleProperty('--offset', '12px');

    expect(__SetInlineStyles).toHaveBeenLastCalledWith(ref, '--offset: 12px');
  });

  // As the DOM's style.setProperty() does.
  it('are removed by an empty value', () => {
    const element = new LynxElement(ref);
    element.setStyle('--primary', 'red');
    const script = new MainThreadElement(ref);
    script.setStyleProperty('transform', 'scale(2)');
    script.setStyleProperty('--offset', '12px');

    script.setStyleProperties({ transform: '', '--offset': '' });

    expect(__SetInlineStyles).toHaveBeenLastCalledWith(ref, '--primary: red');
  });

  it('lay out display: block as Lynx’s linear, as a binding does', () => {
    new LynxElement(ref);

    new MainThreadElement(ref).setStyleProperty('display', 'block');

    expect(__AddInlineStyle).toHaveBeenLastCalledWith(ref, 'display', 'linear');
  });

  // Kept as written, so the element writes them again when the insets
  // change (see safe-area-insets.ts).
  it('get the new safe-area insets when they change', () => {
    setSafeAreaInsets({ edgeToEdge: true, safeAreaTop: 62 });
    new LynxElement(ref);
    new MainThreadElement(ref).setStyleProperty(
      'padding-top',
      'env(safe-area-inset-top)',
    );
    expect(__AddInlineStyle).toHaveBeenLastCalledWith(
      ref,
      'padding-top',
      '62px',
    );

    setSafeAreaInsets({ edgeToEdge: true, safeAreaTop: 0 });
    LynxElement.refreshSafeAreaInsets();

    expect(__AddInlineStyle).toHaveBeenLastCalledWith(
      ref,
      'padding-top',
      '0px',
    );
  });

  it('go straight to native on an element no LynxElement drives', () => {
    new LynxElement(ref);
    const other = {} as ElementRef;

    new MainThreadElement(other).setStyleProperty('opacity', '0.5');

    expect(__AddInlineStyle).toHaveBeenCalledWith(other, 'opacity', '0.5');
  });
});
