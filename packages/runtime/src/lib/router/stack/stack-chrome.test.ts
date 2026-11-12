import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import {
  type BarState,
  type ChromeClaim,
  type PageBar,
  type StackBarMotion,
  LynxStackChrome,
  STILL,
  awayOf,
  chromeOn,
  follow,
  own,
} from './stack-chrome';
import { LynxStackPage, setActive } from './stack-page';

const IOS: StackBarMotion = {
  animation: 'ios',
  duration: 350,
  easing: 'ease',
  coveredX: -0.3,
};

/**
 * An outlet, as the chrome sees it: on `page` (or at the top level), at
 * rest on a page that says `bar`, unless told otherwise.
 */
const outlet = (
  page: LynxStackPage | null = null,
  bar: PageBar | null = 'root',
  hidesPushed = true,
) => {
  const state = signal<BarState>({
    from: bar ?? 'root',
    to: bar ?? 'root',
    at: 1,
    active: bar,
    motion: { ...STILL, animation: 'ios' },
  });
  const claim: ChromeClaim = {
    page,
    state,
    hidesPushed: signal(hidesPushed),
  };
  return { claim, state };
};

/**
 * A page on top of its stack, in `claim`'s outlet.
 */
const pageIn = (claim: ChromeClaim, active = true): LynxStackPage => {
  const page = new LynxStackPage();
  setActive(page, active);
  own(page, claim);
  return page;
};

describe('LynxStackChrome', () => {
  it('shows the bar while no outlet says otherwise', () => {
    const chrome = new LynxStackChrome();
    expect(chrome.bottomBarHidden()).toBe(false);
    expect(chrome.bottomBarProgress()).toBe(0);
    expect(chrome.bottomBarMotion()).toBe(STILL);
  });

  it('follows an outlet, until it stops', () => {
    const chrome = new LynxStackChrome();
    const { claim, state } = outlet(null, 'pushed');
    const stop = follow(chrome, claim);
    expect(chrome.bottomBarHidden()).toBe(true);
    expect(chrome.bottomBarProgress()).toBe(1);
    // Mid-way back to a page that shows it.
    state.set({
      from: 'pushed',
      to: 'root',
      at: 0.25,
      active: 'pushed',
      motion: IOS,
    });
    expect(chrome.bottomBarProgress()).toBe(0.75);
    expect(chrome.bottomBarMotion()).toEqual(IOS);
    stop();
    expect(chrome.bottomBarHidden()).toBe(false);
  });

  it('leaves out an outlet without a page, or on a covered page', () => {
    const chrome = new LynxStackChrome();
    const outer = outlet(null, 'root');
    follow(chrome, outer.claim);
    follow(chrome, outlet(null, null).claim);
    const covered = pageIn(outer.claim, false);
    follow(chrome, outlet(covered, 'pushed').claim);
    expect(chrome.bottomBarHidden()).toBe(false);
  });

  it('lets the innermost outlet decide, on what the outer ones say', () => {
    const chrome = new LynxStackChrome();
    const outer = outlet(null, 'pushed');
    const inner = outlet(pageIn(outer.claim), 'root');
    // Followed inside out: the depth orders them, not the order they came.
    follow(chrome, inner.claim);
    follow(chrome, outer.claim);
    // The inner stack's first page says nothing: the outer page hides it.
    expect(chrome.bottomBarHidden()).toBe(true);
    inner.state.update((s) => ({ ...s, to: 'visible', active: 'visible' }));
    expect(chrome.bottomBarHidden()).toBe(false);
    expect(chrome.bottomBarProgress()).toBe(0);
  });

  it('takes the motion of the innermost outlet whose pages move', () => {
    const chrome = new LynxStackChrome();
    const outer = outlet(null, 'root');
    const inner = outlet(pageIn(outer.claim), 'root');
    follow(chrome, outer.claim);
    follow(chrome, inner.claim);
    outer.state.update((s) => ({ ...s, motion: IOS }));
    expect(chrome.bottomBarMotion()).toBe(outer.state().motion);
    const material = { ...IOS, animation: 'material' as const };
    inner.state.update((s) => ({ ...s, motion: material }));
    expect(chrome.bottomBarMotion()).toBe(material);
  });

  it("keeps a pushed page's bar when its outlet doesn't hide it", () => {
    const chrome = new LynxStackChrome();
    follow(chrome, outlet(null, 'pushed', false).claim);
    expect(chrome.bottomBarHidden()).toBe(false);
  });

  it('follows only the outlets on its page, on a page', () => {
    const chrome = new LynxStackChrome();
    const outer = outlet(null, 'pushed');
    follow(chrome, outer.claim);
    const page = pageIn(outer.claim);
    const inner = outlet(page, 'root');
    follow(chrome, inner.claim);
    const onPage = chromeOn(chrome, page);
    expect(chromeOn(chrome, page)).toBe(onPage);
    // The outer outlet moves the page, and a bar on it with it.
    expect(onPage.bottomBarHidden()).toBe(false);
    inner.state.update((s) => ({ ...s, to: 'pushed', active: 'pushed' }));
    expect(onPage.bottomBarHidden()).toBe(true);
    // Not an outlet on another page.
    expect(chromeOn(chrome, new LynxStackPage()).bottomBarHidden()).toBe(false);
  });

  it("counts an outlet on a page no outlet owns as the app's own", () => {
    const chrome = new LynxStackChrome();
    const page = new LynxStackPage();
    setActive(page, true);
    follow(chrome, outlet(page, 'hidden').claim);
    expect(chrome.bottomBarHidden()).toBe(true);
  });
});

describe('awayOf', () => {
  it('reads what a page says, or falls back', () => {
    expect(awayOf('hidden', false, 0)).toBe(1);
    expect(awayOf('visible', true, 1)).toBe(0);
    expect(awayOf('pushed', true, 0)).toBe(1);
    expect(awayOf('pushed', false, 0.5)).toBe(0.5);
    expect(awayOf('root', true, 0.5)).toBe(0.5);
  });
});
