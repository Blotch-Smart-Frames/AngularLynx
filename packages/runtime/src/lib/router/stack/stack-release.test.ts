// @vitest-environment jsdom
//
// Issue #390: on Lynx, every tab the router left that held a
// <lynx-stack-outlet> stayed in memory, with its screens and their native UI.
// The stack kept what it knew about each page in WeakMaps keyed by the page
// that outlive it (the outlet each page is in, on the app's LynxStackChrome,
// and each page's own chrome), and each value led back to its key: an outlet
// holds its pages, and a page's chrome holds the page. A browser's engine
// collects such an entry once nothing else holds the key. PrimJS, the engine
// that runs Lynx's main thread, never does when a native element is on the
// way back, as a page's elements always are. So these tests run under a
// WeakMap that keeps each value for as long as the map lives, as PrimJS does
// there: an entry whose value leads back to its key never goes, and keeps
// both.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const NativeWeakMap = WeakMap;

  /**
   * A WeakMap that holds its values strongly while it lives: a key goes once
   * nothing holds it, and then its entry, but the map itself holds what its
   * values lead to.
   */
  class ValueHoldingWeakMap<K extends WeakKey, V> {
    /** Each key's token, which holds nothing. */
    readonly #tokens = new NativeWeakMap<K, object>();
    /** Each token's value, held strongly. */
    readonly #values = new Map<object, V>();
    readonly #collected = new FinalizationRegistry<object>((token) => {
      this.#values.delete(token);
    });

    constructor(entries?: Iterable<readonly [K, V]> | null) {
      // Only the runtime's own maps hold their values. Third-party ones
      // (Angular's dev-mode injector profiler, jsdom's selector cache) keep
      // what they meet in ways a release build on Lynx doesn't, and aren't
      // what these tests check.
      const caller = new Error().stack?.split('\n')[2] ?? '';
      if (!caller.includes('/packages/runtime/src/')) {
        return new NativeWeakMap(entries) as unknown as this;
      }
      for (const [key, value] of entries ?? []) this.set(key, value);
    }

    get(key: K): V | undefined {
      const token = this.#tokens.get(key);
      return token ? this.#values.get(token) : undefined;
    }

    has(key: K): boolean {
      return this.#tokens.has(key);
    }

    set(key: K, value: V): this {
      let token = this.#tokens.get(key);
      if (!token) {
        token = {};
        this.#tokens.set(key, token);
        this.#collected.register(key, token, token);
      }
      this.#values.set(token, value);
      return this;
    }

    delete(key: K): boolean {
      const token = this.#tokens.get(key);
      if (!token) return false;
      this.#tokens.delete(key);
      this.#values.delete(token);
      this.#collected.unregister(token);
      return true;
    }

    get [Symbol.toStringTag](): string {
      return 'WeakMap';
    }
  }

  globalThis.WeakMap = ValueHoldingWeakMap as unknown as WeakMapConstructor;
});

import '@angular/compiler';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
  Component,
  inject,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { Router, RouterOutlet } from '@angular/router';
import { provideRouter } from '../lynx-router';
import { LynxStackOutlet } from './lynx-stack-outlet';
import { LynxStackChrome } from './stack-chrome';
import { LynxStackPage } from './stack-page';

/** Every stack and page made, held weakly. */
const made: WeakRef<object>[] = [];

/**
 * A page that asks for the chrome a bar on it follows, as a bottom bar on a
 * page does: the page's own, which the page's injector makes for it.
 */
@Component({ selector: 'test-page', template: 'page' })
class Page {
  readonly page = inject(LynxStackPage);
  readonly chrome = inject(LynxStackChrome);

  constructor() {
    made.push(new WeakRef(this));
  }
}

/**
 * A tab with a stack of its own.
 */
@Component({
  selector: 'test-stack-tab',
  template: '<lynx-stack-outlet />',
  imports: [LynxStackOutlet],
})
class StackTab {
  constructor() {
    made.push(new WeakRef(this));
  }
}

@Component({ selector: 'test-plain-tab', template: 'plain' })
class PlainTab {}

/**
 * The tabs, switched by a plain <router-outlet>, as a dock switches them.
 */
@Component({
  selector: 'test-tabs',
  template: '<router-outlet />',
  imports: [RouterOutlet],
})
class Tabs {}

/**
 * Collects garbage, as the engine would. A WeakRef's target stays alive
 * until the task that made or read it ends, so it waits a task first, and
 * collects twice: the first lets go of the keys, and the second of what the
 * entries they leave held.
 */
const collectGarbage = async (): Promise<void> => {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  for (let i = 0; i < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    gc();
  }
};

describe('a <lynx-stack-outlet> the router leaves (#390)', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  it('lets its pages go, and the tab it is in', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          {
            path: 'stack',
            component: StackTab,
            children: [
              { path: '', component: Page },
              { path: ':id', component: Page },
            ],
          },
          { path: 'plain', component: PlainTab },
        ]),
      ],
    });
    const fixture = TestBed.createComponent(Tabs);
    const router = TestBed.inject(Router);
    const go = async (url: string): Promise<void> => {
      await router.navigateByUrl(url);
      fixture.detectChanges();
      await fixture.whenStable();
    };
    for (let round = 0; round < 3; round++) {
      await go('/stack');
      // A page pushed over the first, so the stack holds two.
      await go('/stack/1');
      await go('/plain');
    }
    // Three tabs and six pages made.
    expect(made).toHaveLength(9);

    await collectGarbage();

    expect(made.filter((ref) => ref.deref())).toHaveLength(0);
    TestBed.resetTestingModule();
  });
});
