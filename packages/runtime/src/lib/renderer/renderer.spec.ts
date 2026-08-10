import { RendererStyleFlags2 } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxBackgroundDocument } from '../lynx-document';
import { LynxBackgroundElement } from '../lynx-element';
import { LynxRenderer } from './renderer';

const createRenderer = () => {
  const doc = new LynxBackgroundDocument();
  return { renderer: new LynxRenderer(doc), doc };
};

describe('LynxRenderer', () => {
  describe('data', () => {
    it('returns the same object reference on repeated access', () => {
      const { renderer } = createRenderer();
      expect(renderer.data).toBe(renderer.data);
    });

    it('preserves values written to data', () => {
      const { renderer } = createRenderer();
      renderer.data['_nghost-abc'] = true;
      expect(renderer.data['_nghost-abc']).toBe(true);
    });
  });

  describe('destroy', () => {
    it('does not throw', () => {
      const { renderer } = createRenderer();
      expect(() => renderer.destroy()).not.toThrow();
    });
  });

  describe('destroyNode', () => {
    it('deregisters the node from the canonical-wrapper registry', () => {
      // Non-null so Angular walks a destroyed view and cleans up each node's
      // native-id → wrapper entry (see LynxElement.#byNativeId). It must be a
      // no-op for nodes without the method (background/SSR elements).
      const { renderer } = createRenderer();
      expect(renderer.destroyNode).toBeTypeOf('function');

      const node = { deregisterNative: vi.fn() };
      renderer.destroyNode!(node);
      expect(node.deregisterNative).toHaveBeenCalledTimes(1);

      const bare = {};
      expect(() => renderer.destroyNode!(bare)).not.toThrow();
    });
  });

  describe('createElement', () => {
    it('delegates to document.createElement', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createElement');
      renderer.createElement('view');
      expect(spy).toHaveBeenCalledWith('view');
    });

    it('returns a BaseLynxElement', () => {
      const { renderer } = createRenderer();
      const el = renderer.createElement('view');
      expect(el).toBeInstanceOf(LynxBackgroundElement);
    });
  });

  describe('createComment', () => {
    it('delegates to document.createComment', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createComment');
      renderer.createComment('placeholder');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('createText', () => {
    it('delegates to document.createText', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createText');
      renderer.createText('hello');
      expect(spy).toHaveBeenCalledWith('hello');
    });

    // The renderer only COLLAPSES whitespace; positional edge-trimming is
    // deferred to the flush-time pass, which needs sibling context (see
    // inline-text.spec.ts). So edge spaces are preserved through this layer.
    it('collapses interior whitespace runs to a single space', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createText');
      renderer.createText('Hello   world');
      expect(spy).toHaveBeenCalledWith('Hello world');
    });

    it('collapses newlines and tabs to a single space, keeping edges', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createText');
      renderer.createText('\n  Hello\t\tthere\n  world  \n');
      expect(spy).toHaveBeenCalledWith(' Hello there world ');
    });

    it('preserves leading/trailing edge spaces (trimming is deferred to flush)', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createText');
      renderer.createText(' Hello world ');
      expect(spy).toHaveBeenCalledWith(' Hello world ');
    });

    it('leaves already-clean text untouched', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createText');
      renderer.createText('Hello world');
      expect(spy).toHaveBeenCalledWith('Hello world');
    });

    it('keeps the empty string empty', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createText');
      renderer.createText('');
      expect(spy).toHaveBeenCalledWith('');
    });

    // Collapse touches ASCII whitespace only, so a non-breaking space is a
    // deliberate escape hatch for a value that needs a literal space.
    it('preserves a non-breaking space', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createText');
      renderer.createText('\u00A0Hello');
      expect(spy).toHaveBeenCalledWith('\u00A0Hello');
    });
  });

  describe('selectRootElement', () => {
    it('delegates to document.createRootElement', () => {
      const { renderer, doc } = createRenderer();
      const spy = vi.spyOn(doc, 'createRootElement');
      renderer.selectRootElement();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('appendChild', () => {
    it('calls appendChild on the parent element', () => {
      const { renderer } = createRenderer();
      const parent = new LynxBackgroundElement();
      const child = new LynxBackgroundElement();
      const spy = vi.spyOn(parent, 'appendChild');

      renderer.appendChild(parent, child);

      expect(spy).toHaveBeenCalledWith(child);
    });
  });

  describe('insertBefore', () => {
    it('calls parent.insertBefore when refChild is provided', () => {
      const { renderer } = createRenderer();
      const parent = new LynxBackgroundElement();
      const newChild = new LynxBackgroundElement();
      const ref = new LynxBackgroundElement();
      parent.appendChild(ref);
      const spy = vi.spyOn(parent, 'insertBefore');

      renderer.insertBefore(parent, newChild, ref);

      expect(spy).toHaveBeenCalledWith(newChild, ref);
    });

    it('calls parent.appendChild when refChild is null', () => {
      const { renderer } = createRenderer();
      const parent = new LynxBackgroundElement();
      const newChild = new LynxBackgroundElement();
      const spy = vi.spyOn(parent, 'appendChild');

      renderer.insertBefore(parent, newChild, null);

      expect(spy).toHaveBeenCalledWith(newChild);
    });
  });

  describe('removeChild', () => {
    it('calls remove() on the old child', () => {
      const { renderer } = createRenderer();
      const parent = new LynxBackgroundElement();
      const child = new LynxBackgroundElement();
      parent.appendChild(child);
      const spy = vi.spyOn(child, 'remove');

      renderer.removeChild(parent, child);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('parentNode', () => {
    it('returns the parent element', () => {
      const { renderer } = createRenderer();
      const parent = new LynxBackgroundElement();
      const child = new LynxBackgroundElement();
      parent.appendChild(child);

      expect(renderer.parentNode(child)).toBe(parent);
    });

    it('returns null for a root element', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      expect(renderer.parentNode(el)).toBeNull();
    });
  });

  describe('nextSibling', () => {
    it('returns the next sibling', () => {
      const { renderer } = createRenderer();
      const parent = new LynxBackgroundElement();
      const first = new LynxBackgroundElement();
      const second = new LynxBackgroundElement();
      parent.appendChild(first);
      parent.appendChild(second);

      expect(renderer.nextSibling(first)).toBe(second);
    });

    it('returns null for the last child', () => {
      const { renderer } = createRenderer();
      const parent = new LynxBackgroundElement();
      const child = new LynxBackgroundElement();
      parent.appendChild(child);

      expect(renderer.nextSibling(child)).toBeNull();
    });
  });

  describe('setAttribute', () => {
    it('delegates to el.setAttribute', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const spy = vi.spyOn(el, 'setAttribute');

      renderer.setAttribute(el, 'id', 'main');

      expect(spy).toHaveBeenCalledWith('id', 'main');
    });
  });

  describe('removeAttribute', () => {
    it('delegates to el.removeAttribute', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const spy = vi.spyOn(el, 'removeAttribute');

      renderer.removeAttribute(el, 'id');

      expect(spy).toHaveBeenCalledWith('id');
    });
  });

  describe('addClass', () => {
    it('delegates to el.addClass', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const spy = vi.spyOn(el, 'addClass');

      renderer.addClass(el, 'active');

      expect(spy).toHaveBeenCalledWith('active');
    });
  });

  describe('removeClass', () => {
    it('delegates to el.removeClass', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const spy = vi.spyOn(el, 'removeClass');

      renderer.removeClass(el, 'active');

      expect(spy).toHaveBeenCalledWith('active');
    });
  });

  describe('setStyle', () => {
    let renderer: LynxRenderer;
    let el: LynxBackgroundElement;

    beforeEach(() => {
      ({ renderer } = createRenderer());
      el = new LynxBackgroundElement();
    });

    it('converts camelCase style name to dash-case', () => {
      const spy = vi.spyOn(el, 'setStyle');
      renderer.setStyle(el, 'backgroundColor', 'red');
      expect(spy).toHaveBeenCalledWith('background-color', 'red');
    });

    it('passes dash-case names through unchanged when DashCase flag is set', () => {
      const spy = vi.spyOn(el, 'setStyle');
      renderer.setStyle(
        el,
        'background-color',
        'red',
        RendererStyleFlags2.DashCase,
      );
      expect(spy).toHaveBeenCalledWith('background-color', 'red');
    });

    it('appends !important when Important flag is set', () => {
      const spy = vi.spyOn(el, 'setStyle');
      renderer.setStyle(el, 'color', 'blue', RendererStyleFlags2.Important);
      expect(spy).toHaveBeenCalledWith('color', 'blue !important');
    });

    it('handles both DashCase and Important flags together', () => {
      const spy = vi.spyOn(el, 'setStyle');
      const flags =
        RendererStyleFlags2.DashCase | RendererStyleFlags2.Important;
      renderer.setStyle(el, 'font-size', '16px', flags);
      expect(spy).toHaveBeenCalledWith('font-size', '16px !important');
    });

    it('handles no flags (undefined)', () => {
      const spy = vi.spyOn(el, 'setStyle');
      renderer.setStyle(el, 'fontSize', '16px');
      expect(spy).toHaveBeenCalledWith('font-size', '16px');
    });
  });

  describe('removeStyle', () => {
    let renderer: LynxRenderer;
    let el: LynxBackgroundElement;

    beforeEach(() => {
      ({ renderer } = createRenderer());
      el = new LynxBackgroundElement();
    });

    it('converts camelCase to dash-case before removing', () => {
      const spy = vi.spyOn(el, 'removeStyle');
      renderer.removeStyle(el, 'backgroundColor');
      expect(spy).toHaveBeenCalledWith('background-color');
    });

    it('passes dash-case through unchanged when DashCase flag is set', () => {
      const spy = vi.spyOn(el, 'removeStyle');
      renderer.removeStyle(
        el,
        'background-color',
        RendererStyleFlags2.DashCase,
      );
      expect(spy).toHaveBeenCalledWith('background-color');
    });
  });

  describe('setProperty', () => {
    it('delegates to el.setProperty', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const spy = vi.spyOn(el, 'setProperty');

      renderer.setProperty(el, 'value', 42);

      expect(spy).toHaveBeenCalledWith('value', 42);
    });
  });

  describe('setValue', () => {
    it('calls setAttribute with "text" key', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const spy = vi.spyOn(el, 'setAttribute');

      renderer.setValue(el, 'hello world');

      expect(spy).toHaveBeenCalledWith('text', 'hello world');
    });

    // setValue only collapses interior runs; edge trimming is positional and
    // happens in the flush-time pass (see inline-text.spec.ts), so edges are
    // preserved through this layer.
    it('collapses interior runs but preserves edges (trim deferred to flush)', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const spy = vi.spyOn(el, 'setAttribute');

      renderer.setValue(el, '  hello   world  ');

      expect(spy).toHaveBeenCalledWith('text', ' hello world ');
    });
  });

  describe('listen', () => {
    it('delegates to target.addEventListener and returns the cleanup function', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const cb = vi.fn();
      const cleanup = vi.fn(() => () => {});
      const spy = vi.spyOn(el, 'addEventListener').mockImplementation(cleanup);

      const unlisten = renderer.listen(el, 'bindtap', cb);

      expect(spy).toHaveBeenCalledWith('bindtap', cb);
      expect(typeof unlisten).toBe('function');
    });

    it('returned function calls the cleanup returned by addEventListener', () => {
      const { renderer } = createRenderer();
      const el = new LynxBackgroundElement();
      const cb = vi.fn();
      const innerCleanup = vi.fn();
      vi.spyOn(el, 'addEventListener').mockReturnValue(innerCleanup);

      const unlisten = renderer.listen(el, 'bindtap', cb);
      unlisten();

      expect(innerCleanup).toHaveBeenCalled();
    });
  });
});
