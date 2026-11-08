import { describe, expect, it } from 'vitest';
import { type StackNavigation, changeFor } from './stack-change';

/**
 * A navigation from the top of `stack` to `url`, imperative by default.
 */
const navigation = (
  stack: string[],
  url: string,
  extra: Partial<StackNavigation> = {},
): StackNavigation => ({
  stack,
  url,
  popstate: false,
  forward: false,
  replaceUrl: false,
  hint: undefined,
  ...extra,
});

describe('changeFor', () => {
  it('puts the first page on the stack without a transition', () => {
    expect(changeFor(navigation([], '/notes'))).toEqual({
      kind: 'push',
      animated: false,
    });
  });

  it('pushes a page deeper than the top one', () => {
    expect(changeFor(navigation(['/notes'], '/notes/3'))).toEqual({
      kind: 'push',
      animated: true,
    });
  });

  it("pushes a deeper page that isn't under the top one, as /item/3 from /items", () => {
    expect(changeFor(navigation(['/items'], '/item/3'))).toEqual({
      kind: 'push',
      animated: true,
    });
  });

  it('pushes anything from the root', () => {
    expect(changeFor(navigation(['/'], '/settings'))).toEqual({
      kind: 'push',
      animated: true,
    });
  });

  it('pops back to a page in the stack, by a link as by the history', () => {
    const stack = ['/notes', '/notes/3', '/notes/3/edit'];
    expect(changeFor(navigation(stack, '/notes'))).toEqual({
      kind: 'pop',
      index: 0,
    });
    expect(
      changeFor(navigation(stack, '/notes/3', { popstate: true })),
    ).toEqual({ kind: 'pop', index: 1 });
  });

  it('pops to the nearest page with the URL when it is in the stack twice', () => {
    const stack = ['/a', '/a/b', '/a', '/a/b'];
    expect(changeFor(navigation(stack, '/a'))).toEqual({
      kind: 'pop',
      index: 2,
    });
  });

  it('starts a new stack at once for a page at the same depth, as a tab bar does', () => {
    expect(changeFor(navigation(['/dashboard'], '/my-account'))).toEqual({
      kind: 'reset',
      animated: false,
    });
    expect(
      changeFor(
        navigation(
          ['/my-account', '/my-account/personal-information'],
          '/dashboard',
        ),
      ),
    ).toEqual({ kind: 'reset', animated: false });
  });

  it('slides in a page the top one is under, as a back button with a routerLink to its parent does', () => {
    expect(changeFor(navigation(['/notes/3'], '/notes'))).toEqual({
      kind: 'reset',
      animated: true,
    });
  });

  it('slides in the root from behind a page that is under it', () => {
    expect(changeFor(navigation(['/settings'], '/'))).toEqual({
      kind: 'reset',
      animated: true,
    });
  });

  it('slides in from behind a page the history goes back to that the stack lost', () => {
    expect(
      changeFor(navigation(['/settings'], '/home', { popstate: true })),
    ).toEqual({ kind: 'reset', animated: true });
  });

  it('pushes a page the history goes forward to', () => {
    expect(
      changeFor(
        navigation(['/notes'], '/notes/3', { popstate: true, forward: true }),
      ),
    ).toEqual({ kind: 'push', animated: true });
  });

  it('swaps the top page at once when the URL is replaced', () => {
    expect(
      changeFor(
        navigation(['/login'], '/dashboard/home', { replaceUrl: true }),
      ),
    ).toEqual({ kind: 'replace' });
  });

  it('swaps the top page at once for its own URL', () => {
    expect(changeFor(navigation(['/notes', '/notes/3'], '/notes/3'))).toEqual({
      kind: 'replace',
    });
  });

  describe('the navigation info', () => {
    it("'push' pushes a page at the same depth", () => {
      expect(
        changeFor(navigation(['/user/1'], '/post/5', { hint: 'push' })),
      ).toEqual({ kind: 'push', animated: true });
    });

    it("'push' pushes a page already in the stack again", () => {
      expect(
        changeFor(navigation(['/a', '/a/b'], '/a', { hint: 'push' })),
      ).toEqual({ kind: 'push', animated: true });
    });

    it("'pop' pops to a page in the stack", () => {
      expect(
        changeFor(navigation(['/a', '/a/b'], '/a', { hint: 'pop' })),
      ).toEqual({ kind: 'pop', index: 0 });
    });

    it("'pop' slides in a page that isn't in the stack", () => {
      expect(
        changeFor(navigation(['/a/b/c'], '/x/y/z/w', { hint: 'pop' })),
      ).toEqual({ kind: 'reset', animated: true });
    });

    it("'root' starts a new stack at once, even for a page in it", () => {
      expect(
        changeFor(navigation(['/a', '/a/b'], '/a', { hint: 'root' })),
      ).toEqual({ kind: 'reset', animated: false });
    });
  });
});
