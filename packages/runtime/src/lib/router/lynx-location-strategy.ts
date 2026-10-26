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
  }

  /**
   * Whether there's an entry before the current one, so `back()` goes
   * somewhere. The Android back button follows it (see lynx-back-button.ts):
   * while it's false, back leaves the app, as on any root screen.
   */
  readonly canGoBack = this.#canGoBack.asReadonly();

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
