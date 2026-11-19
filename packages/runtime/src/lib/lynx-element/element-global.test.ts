// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installElementGlobal } from './element-global';

/**
 * A Lynx element, as the global tells one apart: by shape.
 */
const element = (tagName = 'view') => ({
  element: { node: true },
  tagName,
  observeLayout: () => () => {},
});

const restore: (() => void)[] = [];

afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

/**
 * Installs onto the jsdom realm's own Element, as in the web preview's frame,
 * and takes it off again after the test.
 */
const installOnDom = (): Record<string, any> => {
  const target = { Element } as Record<string, any>;
  installElementGlobal(target);
  restore.push(() => {
    delete (Element as any)[Symbol.hasInstance];
    delete (Element as any)[Symbol.for('angular-lynx.element-global')];
  });
  return target;
};

describe('installElementGlobal', () => {
  // On iOS and Android, where the main thread has no Element at all, the
  // assertion Angular's @defer triggers make threw a ReferenceError (#459).
  it('makes a template’s elements, and nothing else, Elements where there’s no DOM', () => {
    const target: Record<string, any> = {};
    installElementGlobal(target);
    expect(element() instanceof target['Element']).toBe(true);
    expect(element('canvas') instanceof target['Element']).toBe(true);
    expect({} instanceof target['Element']).toBe(false);
    expect(null instanceof target['Element']).toBe(false);
    expect({ element: {} } instanceof target['Element']).toBe(false);
  });

  it('leaves out text nodes and anchors, which the DOM’s Element does too', () => {
    const target: Record<string, any> = {};
    installElementGlobal(target);
    expect(element('raw-text') instanceof target['Element']).toBe(false);
    expect(element('comment') instanceof target['Element']).toBe(false);
  });

  // In the web preview's frame and the testing library's jsdom, a
  // LynxElement wraps a DOM element rather than being one.
  it('makes the DOM’s Element take a template’s elements too', () => {
    const target = installOnDom();
    expect(target['Element']).toBe(Element);
    expect(element() instanceof Element).toBe(true);
    expect(document.createElement('div') instanceof Element).toBe(true);
    expect(document.createTextNode('') instanceof Element).toBe(false);
    expect({} instanceof Element).toBe(false);
  });

  it('leaves the DOM’s subclasses of Element as they were', () => {
    installOnDom();
    expect(element() instanceof HTMLElement).toBe(false);
    expect(element() instanceof HTMLDivElement).toBe(false);
    expect(document.createElement('div') instanceof HTMLDivElement).toBe(true);
    expect(document.createElement('span') instanceof HTMLDivElement).toBe(
      false,
    );
  });

  it('wraps the DOM’s Element once', () => {
    const target = installOnDom();
    const check = (Element as any)[Symbol.hasInstance];
    installElementGlobal(target);
    expect((Element as any)[Symbol.hasInstance]).toBe(check);
  });
});
