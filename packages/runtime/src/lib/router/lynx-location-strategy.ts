import { type LocationChangeListener, LocationStrategy } from '@angular/common';
import { Injectable } from '@angular/core';

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
  #history: { state: unknown; url: string }[] = [{ state: null, url: '/' }];
  #historyIndex = 0;
  #listeners: LocationChangeListener[] = [];

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
