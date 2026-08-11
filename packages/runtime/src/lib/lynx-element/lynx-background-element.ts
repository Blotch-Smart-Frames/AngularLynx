import type { LynxAnimationOptions } from '../animation/animation';
import { NoopLynxAnimation } from '../animation/noop-animation';
import type { BaseLynxElement } from './types';

/**
 * Virtual element for the background thread where no native PAPI functions exist.
 * Maintains an in-memory linked-list tree (parent/child/sibling pointers) that
 * mirrors what LynxDocument builds on the main thread. Used by:
 * - Angular's change detection (reads parentNode/nextSibling for view insertion)
 * - querySelector/querySelectorAll (for testing and background-thread lookups)
 * - LynxBackgroundDocument (creates these instead of native elements)
 *
 * Props, styles, classes, and events are stored in Maps/Sets but never sent to
 * native — they exist so component code can read back what it set without
 * crashing, and so the testing library can inspect element state.
 */
export class LynxBackgroundElement implements BaseLynxElement {
  isRootPageElement = false;
  tagName = '';

  #props = new Map<string, any>();
  #styles = new Map<string, any>();
  #classes = new Set<string>();
  #events = new Map<string, (event: any) => any>();
  #parent: LynxBackgroundElement | null = null;
  #firstChild: LynxBackgroundElement | null = null;
  #lastChild: LynxBackgroundElement | null = null;
  #previousSibling: LynxBackgroundElement | null = null;
  #nextSibling: LynxBackgroundElement | null = null;

  setProperty(name: string, value: any): void {
    this.#props.set(name, value);
  }
  setAttribute(name: string, value: any): void {
    this.#props.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.#props.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.#props.delete(name);
  }
  setStyle(key: string, value: unknown): void {
    this.#styles.set(key, value);
  }
  removeStyle(key: string): void {
    this.#styles.delete(key);
  }
  setInlineStyles(inlineStyle: string): void {
    const styles = inlineStyle
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const s of styles) {
      const [key, value] = s.split(':').map((s) => s.trim());
      this.setStyle(key, value);
    }
  }

  insertBefore(
    newChild: LynxBackgroundElement,
    refChild: LynxBackgroundElement | null,
  ): void {
    if (newChild.isRootPageElement) return;
    if (refChild == null) {
      this.appendChild(newChild);
      return;
    }
    if (!refChild.#previousSibling) {
      this.#firstChild = newChild;
    } else {
      refChild.#previousSibling.#nextSibling = newChild;
    }
    newChild.#previousSibling = refChild.#previousSibling;
    refChild.#previousSibling = newChild;
    newChild.#nextSibling = refChild;
    newChild.#parent = this;
  }

  appendChild(newChild: LynxBackgroundElement): void {
    if (newChild.isRootPageElement) return;
    if (!this.#firstChild) {
      this.#firstChild = newChild;
      this.#lastChild = newChild;
    } else {
      if (!this.#lastChild) {
        throw new Error(
          'Invariant violation: lastChild is null while firstChild is not null.',
        );
      }
      this.#lastChild.#nextSibling = newChild;
      newChild.#previousSibling = this.#lastChild;
      this.#lastChild = newChild;
    }
    newChild.#parent = this;
  }

  addClass(name: string): void {
    this.#classes.add(name);
  }
  removeClass(name: string): void {
    this.#classes.delete(name);
  }
  remove(): void {
    if (this.isRootPageElement) return;
    if (!this.#parent) {
      return;
    }
    if (this.#previousSibling) {
      this.#previousSibling.#nextSibling = this.#nextSibling;
    } else {
      this.#parent.#firstChild = this.#nextSibling;
    }
    if (this.#nextSibling) {
      this.#nextSibling.#previousSibling = this.#previousSibling;
    } else {
      this.#parent.#lastChild = this.#previousSibling;
    }
    this.#nextSibling = null;
    this.#previousSibling = null;
    this.#parent = null;
  }

  parentNode(): BaseLynxElement | null {
    return this.#parent;
  }
  nextSibling(): BaseLynxElement | null {
    return this.#nextSibling;
  }
  querySelector(selector: string): BaseLynxElement | null {
    // Depth-first search: check each child, then recurse into its subtree.
    // This matches browser semantics — the first pre-order match wins.
    let child = this.#firstChild;
    while (child) {
      if (child.#matchesSelector(selector)) {
        return child;
      }
      const found = child.querySelector(selector);
      if (found) return found;
      child = child.#nextSibling;
    }
    return null;
  }

  querySelectorAll(selector: string): BaseLynxElement[] {
    const results: LynxBackgroundElement[] = [];
    this.#collectMatches(selector, results);
    return results;
  }

  /**
   * Collects all descendants (pre-order DFS) that match the selector.
   */
  #collectMatches(selector: string, results: LynxBackgroundElement[]): void {
    let child = this.#firstChild;
    while (child) {
      if (child.#matchesSelector(selector)) {
        results.push(child);
      }
      child.#collectMatches(selector, results);
      child = child.#nextSibling;
    }
  }

  /**
   * Supports the CSS selector subset Angular actually needs: tag names, class
   * selectors, ID selectors, and simple attribute selectors — all combinable
   * as a compound selector (e.g. "view.active[id=foo]").
   * Combinators (space, >, ~, +) are not supported on the background thread
   * because Angular's renderer doesn't use them at this layer.
   */
  #matchesSelector(selector: string): boolean {
    let remaining = selector.trim();

    // Reject any selector that contains a combinator we cannot handle.
    if (/[\s>~+]/.test(remaining)) return false;

    let tagName: string | null = null;
    const classes: string[] = [];
    const attrs: [string, string | null][] = [];

    // Optional leading tag name (e.g. "view", "scroll-view").
    const tagMatch = remaining.match(/^([a-zA-Z][a-zA-Z0-9_-]*)/);
    if (tagMatch) {
      tagName = tagMatch[1];
      remaining = remaining.slice(tagMatch[0].length);
    }

    // Parse the rest as class / id / attribute tokens.
    while (remaining.length > 0) {
      const classMatch = remaining.match(/^\.([a-zA-Z0-9_-]+)/);
      if (classMatch) {
        classes.push(classMatch[1]);
        remaining = remaining.slice(classMatch[0].length);
        continue;
      }

      const idMatch = remaining.match(/^#([a-zA-Z0-9_-]+)/);
      if (idMatch) {
        // #id is sugar for [id="…"]
        attrs.push(['id', idMatch[1]]);
        remaining = remaining.slice(idMatch[0].length);
        continue;
      }

      // [attr] or [attr=value] or [attr="value"]
      const attrMatch = remaining.match(
        /^\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]*)["']?)?\]/,
      );
      if (attrMatch) {
        attrs.push([attrMatch[1], attrMatch[2] ?? null]);
        remaining = remaining.slice(attrMatch[0].length);
        continue;
      }

      // Unrecognized token — no match.
      return false;
    }

    // Empty selector matches nothing.
    if (!tagName && classes.length === 0 && attrs.length === 0) return false;

    if (tagName && this.#props.get('tagName') !== tagName) return false;

    for (const cls of classes) {
      if (!this.#classes.has(cls)) return false;
    }

    for (const [attr, value] of attrs) {
      const stored = this.#props.get(attr);
      if (value === null) {
        // [attr] presence check — element must have the attribute set.
        if (stored === undefined || stored === null) return false;
      } else {
        if (String(stored) !== value) return false;
      }
    }

    return true;
  }
  /**
   * Previously threw: `throw new Error('animate() is only available on the
   * main thread')`. This crashed the Go web preview on the docs site because
   * the animations example's (bindtap) handler calls el.nativeElement.animate()
   * which lands here on the background thread. Returning a no-op is safe —
   * the animation won't visually play, but the caller's code (including
   * .cancel() / .pause() / .play() chains) continues without error.
   */
  animate(
    _keyframes: Record<string, string | number>[],
    _options?: number | LynxAnimationOptions,
  ): NoopLynxAnimation {
    // __ElementAnimate is a main-thread PAPI function — it does not exist
    // on the background thread. Return a no-op animation so callers don't
    // crash; the animation simply won't play. This matches web-core's
    // behavior where __ElementAnimate is a no-op in preview environments.
    if (__DEV__) {
      console.warn(
        '[angular-lynx] animate() called on background thread — animation will not play. ' +
          'Use a main-thread script for imperative animations.',
      );
    }
    return new NoopLynxAnimation();
  }

  addEventListener(name: string, cb: (event: any) => any): () => void {
    this.#events.set(name, cb);
    return () => {
      this.#events.delete(name);
    };
  }
}
