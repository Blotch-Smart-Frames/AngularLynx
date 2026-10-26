import '@angular/compiler';
import { Component, type Type } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type HotModule, ɵhmrAccept } from './hmr-accept';

/**
 * A stand-in for one module's `import.meta.webpackHot`, which carries what
 * the previous version handed over in its dispose handlers.
 */
const createHot = (data?: Record<string, unknown>) => {
  const disposeHandlers: Array<(data: Record<string, unknown>) => void> = [];
  const hot = {
    accept: vi.fn(),
    invalidate: vi.fn(),
    dispose: vi.fn((handler) => disposeHandlers.push(handler)),
    data,
  } satisfies HotModule;
  return {
    hot,
    /** Runs the dispose handlers, as webpack does when it replaces the module. */
    dispose: () => {
      const next: Record<string, unknown> = {};
      for (const handler of disposeHandlers) handler(next);
      return next;
    },
  };
};

/**
 * A component as one version of a module defines it.
 */
const defineHome = (template: string): Type<unknown> => {
  @Component({ selector: 'app-home', template })
  class Home {}
  return Home;
};

/**
 * Runs `versions` as successive versions of one module, each with its
 * component, signature and compiled-code hash, the way webpack runs a module
 * again for each hot update.
 */
const runVersions = (
  versions: Array<{ type: Type<unknown>; signature: string; code: string }>,
) => {
  let data: Record<string, unknown> | undefined;
  return versions.map(({ type, signature, code }) => {
    const { hot, dispose } = createHot(data);
    const [live] = ɵhmrAccept(hot, [type], signature, code);
    data = dispose();
    return { hot, live };
  });
};

describe('ɵhmrAccept', () => {
  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts the module's first version as it is", () => {
    const Home = defineHome('<text>a</text>');
    const { hot } = createHot();

    expect(ɵhmrAccept(hot, [Home], 'sig', 'code-1')).toEqual([Home]);
    expect(hot.accept).toHaveBeenCalled();
    expect(hot.invalidate).not.toHaveBeenCalled();
  });

  describe('a version that only changed templates or styles', () => {
    it('swaps the new template into the running class, which it keeps using', () => {
      const First = defineHome('<text>a</text>');
      const Second = defineHome('<text>b</text>');

      const [, second] = runVersions([
        { type: First, signature: 'sig', code: 'code-1' },
        { type: Second, signature: 'sig', code: 'code-2' },
      ]);

      expect(second.hot.invalidate).not.toHaveBeenCalled();
      expect(second.live).toBe(First);
      expect((First as any).ɵcmp.template).toBe((Second as any).ɵcmp.template);
      // The definition stays the one Angular holds for the running class.
      expect((First as any).ɵcmp.type).toBe(First);
    });

    it("takes the new version's dependencies, which may be new classes", () => {
      const First = defineHome('<text>a</text>');
      const Second = defineHome('<text>b</text>');
      const dependencies = () => [];
      (Second as any).ɵcmp.directiveDefs = dependencies;
      (Second as any).ɵcmp.pipeDefs = dependencies;

      runVersions([
        { type: First, signature: 'sig', code: 'code-1' },
        { type: Second, signature: 'sig', code: 'code-2' },
      ]);

      expect((First as any).ɵcmp.directiveDefs).toBe(dependencies);
      expect((First as any).ɵcmp.pipeDefs).toBe(dependencies);
    });

    it('keeps swapping into the first class on later updates', () => {
      const First = defineHome('<text>a</text>');
      const Third = defineHome('<text>c</text>');

      const [, , third] = runVersions([
        { type: First, signature: 'sig', code: 'code-1' },
        {
          type: defineHome('<text>b</text>'),
          signature: 'sig',
          code: 'code-2',
        },
        { type: Third, signature: 'sig', code: 'code-3' },
      ]);

      expect(third.live).toBe(First);
      expect((First as any).ɵcmp.template).toBe((Third as any).ɵcmp.template);
    });

    it('passes the update on when the new template fails to apply', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const Second = defineHome('<text>b</text>');
      /**
       * Not a component at all, so Angular can't merge a definition into it.
       */
      class Broken {}

      const [, second] = runVersions([
        { type: Broken as Type<unknown>, signature: 'sig', code: 'code-1' },
        { type: Second, signature: 'sig', code: 'code-2' },
      ]);

      expect(second.hot.invalidate).toHaveBeenCalled();
      expect(second.live).toBe(Second);
      expect(error).toHaveBeenCalled();
    });
  });

  describe('a version that changed anything else', () => {
    it('passes the update on when the source changed outside templates and styles', () => {
      const Second = defineHome('<text>b</text>');

      const [, second] = runVersions([
        { type: defineHome('<text>a</text>'), signature: 'sig-1', code: 'c1' },
        { type: Second, signature: 'sig-2', code: 'c2' },
      ]);

      expect(second.hot.invalidate).toHaveBeenCalled();
      expect(second.live).toBe(Second);
    });

    it('passes the update on when it runs again only because an import changed', () => {
      const [, second] = runVersions([
        { type: defineHome('<text>a</text>'), signature: 'sig', code: 'same' },
        { type: defineHome('<text>a</text>'), signature: 'sig', code: 'same' },
      ]);

      expect(second.hot.invalidate).toHaveBeenCalled();
    });

    it('passes the update on when the module defines different components', () => {
      let data: Record<string, unknown> | undefined;
      const first = createHot();
      ɵhmrAccept(first.hot, [defineHome('a')], 'sig', 'c1');
      data = first.dispose();
      const second = createHot(data);

      ɵhmrAccept(second.hot, [defineHome('b'), defineHome('c')], 'sig', 'c2');

      expect(second.hot.invalidate).toHaveBeenCalled();
    });

    // Passing it on re-runs the importing modules, which run this one once
    // more: that run must not pass it on again.
    it('takes the run that follows passing it on as it is', () => {
      const Third = defineHome('<text>b</text>');

      const [, , third] = runVersions([
        { type: defineHome('<text>a</text>'), signature: 'sig-1', code: 'c1' },
        { type: defineHome('<text>b</text>'), signature: 'sig-2', code: 'c2' },
        { type: Third, signature: 'sig-2', code: 'c2' },
      ]);

      expect(third.hot.invalidate).not.toHaveBeenCalled();
      expect(third.live).toBe(Third);
    });
  });

  // The background thread runs no app: running the module again registers
  // its background functions again, which is all it needs.
  it('accepts every version on the background thread', () => {
    vi.stubGlobal('__MAIN_THREAD__', false);
    const Second = defineHome('<text>b</text>');

    const [, second] = runVersions([
      { type: defineHome('<text>a</text>'), signature: 'sig-1', code: 'c1' },
      { type: Second, signature: 'sig-2', code: 'c2' },
    ]);

    expect(second.hot.accept).toHaveBeenCalled();
    expect(second.hot.invalidate).not.toHaveBeenCalled();
    expect(second.hot.dispose).not.toHaveBeenCalled();
    expect(second.live).toBe(Second);
  });
});
