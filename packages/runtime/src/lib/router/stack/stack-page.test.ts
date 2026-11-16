import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import {
  LynxStackPage,
  linksOf,
  setActive,
  setBottomBarHidden,
} from './stack-page';

describe('LynxStackPage', () => {
  it("sets each page's own state, whichever was made first", () => {
    // The first page's constructor assigns the accessors; the pages after
    // it use the same.
    const first = new LynxStackPage();
    const second = new LynxStackPage();

    setActive(second, true);
    setBottomBarHidden(second, signal(true));
    expect(first.active()).toBe(false);
    expect(first.bottomBarHidden()).toBe(false);
    expect(second.active()).toBe(true);
    expect(second.bottomBarHidden()).toBe(true);

    expect(linksOf(first)).not.toBe(linksOf(second));
    expect(linksOf(second)).toEqual({ owner: null, chrome: null });
  });
});
