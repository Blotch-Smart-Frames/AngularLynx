import { type LocationChangeListener, LocationStrategy } from '@angular/common';
import { Injectable, type Injector, signal } from '@angular/core';

type HistoryEntry = { state: unknown; url: string };

/**
 * The history a hot update's re-bootstrap hands from the old app's strategy to
 * the new one's (see {@link carryOverLocation}). It lives at module level
 * because the runtime's module isn't re-run by a hot update, while the app's
 * injectors, and the strategy in them, are.
 */
let carriedOver: HistorySnapshot | undefined;

type HistorySnapshot = { history: HistoryEntry[]; index: number };

/**
 * Reads a strategy's history. Assigned in the class's static block, the only
 * place outside its methods that can reach its private fields, which keeps the
 * snapshot out of the class's public API.
 */
let snapshotOf: (strategy: LynxLocationStrategy) => HistorySnapshot;

/**
 * Moves a strategy's current entry back to `index` (see {@link rewindHistory}).
 * Assigned in the class's static block, as {@link snapshotOf} is.
 */
let rewind: (strategy: LynxLocationStrategy, index: number) => void;

/**
 * Takes the history back to `index` without a navigation: the current entry
 * moves there, and the entries between go, as if the app had gone back to
 * `index` and then replaced its entry with the current one.
 *
 * `<lynx-stack-outlet>` calls it when a link pops its stack back to a page.
 * The router has pushed an entry for the page by then, over the entries of
 * the pages the link popped, so Back, Android's back button and the swipe
 * would go back to the last of those pages rather than to the page under
 * the one now on top. A navigation controller's stack is its history; this
 * keeps the two the same.
 *
 * Does nothing unless `index` is before the current entry.
 */
export const rewindHistory = (
  strategy: LynxLocationStrategy,
  index: number,
): void => rewind(strategy, index);

/**
 * Keeps the app on the screen it was showing when a hot update re-bootstraps
 * it. Called with the old app's injector before it's destroyed, it saves the
 * old strategy's history, and the next strategy created starts from it. The
 * router's initial navigation then goes to the current URL instead of `/`,
 * and Back still has the screens before it.
 *
 * Does nothing for an app without the router, or with another strategy.
 *
 * @param injector - The injector of the app that's about to be destroyed.
 */
export const carryOverLocation = (injector: Injector | undefined): void => {
  const strategy = injector?.get(LocationStrategy, null);
  if (strategy instanceof LynxLocationStrategy) {
    carriedOver = snapshotOf(strategy);
  }
};

/**
 * In-memory LocationStrategy for Lynx — equivalent to React Router's MemoryRouter.
 *
 * Lynx is a native mobile runtime with no browser URL or History API.
 * Angular's default PathLocationStrategy chains through PlatformLocation →
 * window.history/window.location, which breaks Lynx's background thread
 * even with mocked globals.
 *
 * This strategy keeps all routing state in memory: a history stack,
 * current index, and popstate listeners — no browser APIs touched.
 *
 * Registered via `provideRouter()` in `lynx-router.ts`.
 */
@Injectable()
export class LynxLocationStrategy extends LocationStrategy {
  #path = '/';
  #baseHref = '/';
  #history: HistoryEntry[] = [{ state: null, url: '/' }];
  #historyIndex = 0;
  #listeners: LocationChangeListener[] = [];
  readonly #canGoBack = signal(false);

  constructor() {
    super();
    if (carriedOver) {
      this.#history = carriedOver.history;
      this.#historyIndex = carriedOver.index;
      this.#path = this.#history[this.#historyIndex].url;
      this.#canGoBack.set(this.#historyIndex > 0);
      carriedOver = undefined;
    }
  }

  static {
    snapshotOf = (strategy) => ({
      history: strategy.#history.map((entry) => ({ ...entry })),
      index: strategy.#historyIndex,
    });
    rewind = (strategy, index) => strategy.#rewind(index);
  }

  #rewind(index: number): void {
    if (index < 0 || index >= this.#historyIndex) return;
    const { state, url } = this.#history[this.#historyIndex];
    this.#history.length = index;
    this.#history.push({ state: atPosition(state, index), url });
    this.#historyIndex = index;
    this.#canGoBack.set(index > 0);
  }

  /**
   * Whether there's an entry before the current one, so `back()` goes
   * somewhere. The Android back button follows it (see lynx-back-button.ts):
   * while it's false, back leaves the app, as on any root screen.
   */
  readonly canGoBack = this.#canGoBack.asReadonly();

  /**
   * Where the current entry is in the history, counting from 0 for the
   * first. `<lynx-stack-outlet>` keeps each page's, so its swipe back goes
   * back through the history to the entry before the page's, however many
   * entries the page added since.
   */
  get historyIndex(): number {
    return this.#historyIndex;
  }

  override path(): string {
    return this.#path;
  }

  override prepareExternalUrl(internal: string): string {
    return internal;
  }

  override getBaseHref(): string {
    return this.#baseHref;
  }

  override getState(): unknown {
    return this.#history[this.#historyIndex]?.state ?? null;
  }

  override pushState(
    state: unknown,
    _title: string,
    url: string,
    queryParams: string,
  ): void {
    const fullUrl = url + (queryParams ? `?${queryParams}` : '');
    // Discard forward history when pushing a new entry
    this.#history.length = this.#historyIndex + 1;
    this.#history.push({ state, url: fullUrl });
    this.#historyIndex++;
    this.#canGoBack.set(true);
    this.#path = fullUrl;
  }

  override replaceState(
    state: unknown,
    _title: string,
    url: string,
    queryParams: string,
  ): void {
    const fullUrl = url + (queryParams ? `?${queryParams}` : '');
    this.#history[this.#historyIndex] = { state, url: fullUrl };
    this.#path = fullUrl;
  }

  override back(): void {
    this.historyGo(-1);
  }

  override forward(): void {
    this.historyGo(1);
  }

  override historyGo(relativePosition: number = 0): void {
    const target = this.#historyIndex + relativePosition;
    if (target < 0 || target >= this.#history.length) return;
    this.#historyIndex = target;
    this.#canGoBack.set(target > 0);
    this.#path = this.#history[target].url;
    for (const fn of this.#listeners) {
      fn({ type: 'popstate', state: this.#history[target].state });
    }
  }

  override onPopState(fn: LocationChangeListener): VoidFunction {
    this.#listeners.push(fn);
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== fn);
    };
  }
}

/**
 * The router's state for an entry that has moved to `index` in the history.
 * With `canceledNavigationResolution: 'computed'`, the router numbers each
 * entry it adds by its place in the history (`ɵrouterPageId`, 0 for the
 * first and one more for each push), and goes back to an entry when a
 * navigation fails by how far apart those numbers are: a moved entry's
 * number has to move with it. Any other state is the app's, and stays as is.
 */
const atPosition = (state: unknown, index: number): unknown =>
  state !== null &&
  typeof state === 'object' &&
  typeof (state as { ɵrouterPageId?: unknown }).ɵrouterPageId === 'number'
    ? { ...state, ɵrouterPageId: index }
    : state;
