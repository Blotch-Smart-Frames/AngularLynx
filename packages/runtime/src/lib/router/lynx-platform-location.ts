// cspell:ignore ɵfac
import {
  type LocationChangeEvent,
  type LocationChangeListener,
  PlatformLocation,
} from '@angular/common';
import { Injectable } from '@angular/core';

/**
 * PlatformLocation implementation for Lynx.
 *
 * Angular's default BrowserPlatformLocation uses `new URL()`, which doesn't
 * exist in the Lynx JS runtime. This class avoids `URL` entirely by manually
 * parsing pathname, search, and hash from the URL string.
 *
 * Registered via `provideRouter()` in `lynx-router.ts`.
 *
 * The `@Injectable()` decorator is required so Angular generates a `ɵfac`
 * factory for this class. Without it, `getUndecoratedInjectableFactory()`
 * walks the prototype chain, finds PlatformLocation's factory
 * (`() => inject(BrowserPlatformLocation)`), and silently creates the wrong
 * class — which crashes in Lynx because `window.location` doesn't exist.
 */
@Injectable()
export class LynxPlatformLocation extends PlatformLocation {
  #history: { state: unknown; title: string; url: string }[] = [
    { state: null, title: '', url: '/' },
  ];
  #index = 0;
  #popStateListeners: LocationChangeListener[] = [];

  get #current() {
    return this.#history[this.#index];
  }

  /**
   * Manual URL parsing — avoids `new URL()` which is unavailable in Lynx runtime.
   */
  #parseUrl(): { pathname: string; search: string; hash: string } {
    const url = this.#current.url;
    const hashIndex = url.indexOf('#');
    const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const searchIndex = withoutHash.indexOf('?');
    const pathname =
      searchIndex >= 0 ? withoutHash.slice(0, searchIndex) : withoutHash;
    const search = searchIndex >= 0 ? withoutHash.slice(searchIndex) : '';
    return { pathname: pathname || '/', search, hash };
  }

  override getBaseHrefFromDOM(): string {
    return '/';
  }

  override get href(): string {
    const { pathname, search, hash } = this.#parseUrl();
    return `lynx://app${pathname}${search}${hash}`;
  }

  override get protocol(): string {
    return 'lynx:';
  }

  override get hostname(): string {
    return 'app';
  }

  override get port(): string {
    return '';
  }

  override get pathname(): string {
    return this.#parseUrl().pathname;
  }

  override get search(): string {
    return this.#parseUrl().search;
  }

  override get hash(): string {
    return this.#parseUrl().hash;
  }

  override onPopState(fn: LocationChangeListener): VoidFunction {
    this.#popStateListeners.push(fn);
    return () => {
      this.#popStateListeners = this.#popStateListeners.filter((l) => l !== fn);
    };
  }

  override onHashChange(_fn: LocationChangeListener): VoidFunction {
    // Hash changes are handled via popState in this implementation
    return () => {};
  }

  override replaceState(state: unknown, title: string, url: string): void {
    this.#history[this.#index] = { state, title, url };
  }

  override pushState(state: unknown, title: string, url: string): void {
    // Discard forward history when pushing
    this.#history.length = this.#index + 1;
    this.#history.push({ state, title, url });
    this.#index++;
  }

  override forward(): void {
    this.historyGo(1);
  }

  override back(): void {
    this.historyGo(-1);
  }

  override historyGo(relativePosition: number = 0): void {
    const targetIndex = this.#index + relativePosition;
    if (targetIndex < 0 || targetIndex >= this.#history.length) {
      return;
    }
    this.#index = targetIndex;
    const event: LocationChangeEvent = {
      type: 'popstate',
      state: this.#current.state,
    };
    for (const listener of this.#popStateListeners) {
      listener(event);
    }
  }

  override getState(): unknown {
    return this.#current.state;
  }
}
