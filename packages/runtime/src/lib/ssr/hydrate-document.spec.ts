import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxHydrateDocument } from './hydrate-document';

vi.mock('../lynx-document', () => {
  class MockLynxDocument {
    page: any = null;
    createElement = vi.fn(() => ({ element: {}, _mock: 'fallback-element' }));
    createText = vi.fn(() => ({ element: {}, _mock: 'fallback-text' }));
    createComment = vi.fn(() => ({ element: {}, _mock: 'fallback-comment' }));
  }
  return { LynxDocument: MockLynxDocument };
});

vi.mock('../lynx-element', () => {
  class MockLynxElement {
    element: ElementRef;
    isRootPageElement = false;
    appendChild = vi.fn();
    setInitialText = vi.fn();
    constructor(ref: ElementRef) {
      this.element = ref;
    }
  }
  return { LynxElement: MockLynxElement };
});

describe('LynxHydrateDocument', () => {
  let pageRef: ElementRef;

  beforeEach(() => {
    pageRef = { _page: true } as any;
    vi.clearAllMocks();
  });

  describe('createRootElement', () => {
    it('returns a LynxElement wrapping the page ref', () => {
      const doc = new LynxHydrateDocument(pageRef, []);

      const root = doc.createRootElement();

      expect(root.element).toBe(pageRef);
    });

    it('marks the page element as root', () => {
      const doc = new LynxHydrateDocument(pageRef, []);

      const root = doc.createRootElement();

      expect(root.isRootPageElement).toBe(true);
    });
  });

  describe('createElement — during hydration', () => {
    it('returns elements from the queue in order', () => {
      const ref0 = { _id: 0 } as any as ElementRef;
      const ref1 = { _id: 1 } as any as ElementRef;
      const doc = new LynxHydrateDocument(pageRef, [ref0, ref1]);
      doc.createRootElement();

      const el0 = doc.createElement('view');
      const el1 = doc.createElement('text');

      expect(el0.element).toBe(ref0);
      expect(el1.element).toBe(ref1);
    });

    it('returns the page element when tag is "page"', () => {
      const ref0 = { _id: 0 } as any as ElementRef;
      const doc = new LynxHydrateDocument(pageRef, [ref0]);
      const root = doc.createRootElement();

      const page = doc.createElement('page');

      expect(page).toBe(root);
    });
  });

  describe('createText — during hydration', () => {
    it('returns elements from the queue', () => {
      const textRef = { _text: true } as any as ElementRef;
      const doc = new LynxHydrateDocument(pageRef, [textRef]);
      doc.createRootElement();

      const text = doc.createText('hello');

      expect(text.element).toBe(textRef);
    });

    // Without this, a hydrated raw-text's #rawText/#text stay undefined (see
    // LynxDocument.createText for the non-hydrating equivalent). If this
    // element is later touched by the flush-time whitespace pass — e.g. a
    // sibling run inside the same <text> changes — it would read back '' and
    // blank this correctly-hydrated text.
    it('seeds the recreation/normalization cache with the given value', () => {
      const textRef = { _text: true } as any as ElementRef;
      const doc = new LynxHydrateDocument(pageRef, [textRef]);
      doc.createRootElement();

      const text = doc.createText('hello') as any;

      expect(text.setInitialText).toHaveBeenCalledWith('hello');
    });
  });

  describe('createComment — during hydration', () => {
    it('returns elements from the queue', () => {
      const commentRef = { _comment: true } as any as ElementRef;
      const doc = new LynxHydrateDocument(pageRef, [commentRef]);
      doc.createRootElement();

      const comment = doc.createComment();

      expect(comment.element).toBe(commentRef);
    });
  });

  describe('appendChild — during hydration', () => {
    it('is a no-op (tree already correct from snapshot)', () => {
      const ref0 = { _id: 0 } as any as ElementRef;
      const doc = new LynxHydrateDocument(pageRef, [ref0]);
      const _root = doc.createRootElement();
      const child = doc.createElement('view');

      // Should not throw or modify anything
      doc.appendChild(child as any);
    });
  });

  describe('post-hydration fallback', () => {
    it('createElement delegates to LynxDocument after queue is exhausted', () => {
      const doc = new LynxHydrateDocument(pageRef, []);
      doc.createRootElement();

      const el = doc.createElement('view');

      expect((el as any)._mock).toBe('fallback-element');
    });

    it('createText delegates to LynxDocument after queue is exhausted', () => {
      const doc = new LynxHydrateDocument(pageRef, []);
      doc.createRootElement();

      const text = doc.createText('dynamic');

      expect((text as any)._mock).toBe('fallback-text');
    });

    it('createComment delegates to LynxDocument after queue is exhausted', () => {
      const doc = new LynxHydrateDocument(pageRef, []);
      doc.createRootElement();

      const comment = doc.createComment();

      expect((comment as any)._mock).toBe('fallback-comment');
    });

    it('appendChild delegates to page after queue is exhausted', () => {
      const doc = new LynxHydrateDocument(pageRef, []);
      const root = doc.createRootElement();

      const el = doc.createElement('view');
      doc.appendChild(el as any);

      expect(root.appendChild).toHaveBeenCalledWith(el);
    });
  });

  describe('queue exhaustion boundary', () => {
    it('transitions from hydration to fallback seamlessly', () => {
      const ref0 = { _id: 0 } as any as ElementRef;
      const doc = new LynxHydrateDocument(pageRef, [ref0]);
      doc.createRootElement();

      // First call consumes the queue
      const hydrated = doc.createElement('view');
      expect(hydrated.element).toBe(ref0);

      // Next call falls through to LynxDocument
      const dynamic = doc.createElement('text');
      expect((dynamic as any)._mock).toBe('fallback-element');
    });
  });
});
