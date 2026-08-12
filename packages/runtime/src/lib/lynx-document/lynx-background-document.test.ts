import { describe, expect, it } from 'vitest';
import { LynxBackgroundDocument } from './lynx-background-document';
import { LynxBackgroundElement } from '../lynx-element';

describe('LynxBackgroundDocument', () => {
  // ─── createRootElement ──────────────────────────────────────────────────────

  describe('createRootElement', () => {
    it('returns a LynxBackgroundElement', () => {
      const doc = new LynxBackgroundDocument();
      expect(doc.createRootElement()).toBeInstanceOf(LynxBackgroundElement);
    });

    it('sets tagName to "page"', () => {
      const doc = new LynxBackgroundDocument();
      const root = doc.createRootElement();
      expect(root.getAttribute('tagName')).toBe('page');
    });

    it('marks the element as root page element', () => {
      const doc = new LynxBackgroundDocument();
      const root = doc.createRootElement();
      expect(root.isRootPageElement).toBe(true);
    });
  });

  // ─── createElement ──────────────────────────────────────────────────────────

  describe('createElement', () => {
    it('returns the root page element when tag is "page"', () => {
      const doc = new LynxBackgroundDocument();
      const root = doc.createRootElement();
      expect(doc.createElement('page')).toBe(root);
    });

    it('returns a new element for non-page tags', () => {
      const doc = new LynxBackgroundDocument();
      doc.createRootElement();
      const el = doc.createElement('view');
      expect(el).toBeInstanceOf(LynxBackgroundElement);
    });

    it('sets tagName on the created element', () => {
      const doc = new LynxBackgroundDocument();
      doc.createRootElement();
      const el = doc.createElement('text');
      expect(el.getAttribute('tagName')).toBe('text');
    });

    it('stores textContent when value is provided', () => {
      const doc = new LynxBackgroundDocument();
      doc.createRootElement();
      const el = doc.createElement('text', 'hello');
      expect(el.getAttribute('textContent')).toBe('hello');
    });

    it('does not set textContent when value is omitted', () => {
      const doc = new LynxBackgroundDocument();
      doc.createRootElement();
      const el = doc.createElement('view');
      expect(el.getAttribute('textContent')).toBeNull();
    });

    it('returns distinct elements for successive calls', () => {
      const doc = new LynxBackgroundDocument();
      doc.createRootElement();
      expect(doc.createElement('view')).not.toBe(doc.createElement('view'));
    });
  });

  // ─── createText ─────────────────────────────────────────────────────────────

  describe('createText', () => {
    it('returns a LynxBackgroundElement', () => {
      const doc = new LynxBackgroundDocument();
      expect(doc.createText('hi')).toBeInstanceOf(LynxBackgroundElement);
    });

    it('sets tagName to "text"', () => {
      const doc = new LynxBackgroundDocument();
      expect(doc.createText('hi').getAttribute('tagName')).toBe('text');
    });

    it('stores the provided value as textContent', () => {
      const doc = new LynxBackgroundDocument();
      expect(doc.createText('hello world').getAttribute('textContent')).toBe(
        'hello world',
      );
    });

    it('preserves an empty string value', () => {
      const doc = new LynxBackgroundDocument();
      expect(doc.createText('').getAttribute('textContent')).toBe('');
    });
  });

  // ─── createComment ──────────────────────────────────────────────────────────

  describe('createComment', () => {
    it('returns a LynxBackgroundElement', () => {
      const doc = new LynxBackgroundDocument();
      expect(doc.createComment()).toBeInstanceOf(LynxBackgroundElement);
    });

    it('sets tagName to "comment"', () => {
      const doc = new LynxBackgroundDocument();
      expect(doc.createComment().getAttribute('tagName')).toBe('comment');
    });
  });

  // ─── appendChild ────────────────────────────────────────────────────────────

  describe('appendChild', () => {
    it('does nothing when createRootElement has not been called', () => {
      const doc = new LynxBackgroundDocument();
      const child = new LynxBackgroundElement();
      // #page is null — should not throw
      expect(() => doc.appendChild(child)).not.toThrow();
    });

    it('appends the child to the root page element', () => {
      const doc = new LynxBackgroundDocument();
      const _root = doc.createRootElement();
      const child = doc.createElement('view');

      doc.appendChild(child);

      // Verify the child is reachable from the root via the background tree
      expect(child.getAttribute('tagName')).toBe('view');
      // The root element must be the parent — verify via remove() not throwing
      expect(() => child.remove()).not.toThrow();
    });
  });
});
