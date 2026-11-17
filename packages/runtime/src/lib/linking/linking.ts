import {
  DestroyRef,
  ErrorHandler,
  inject,
  Injectable,
  Injector,
} from '@angular/core';
import { callOnBackground } from '../background-call';
import { LynxNativeModule } from '../native-module/native-module';
import type { PlatformType } from '../system-info/system-info';

/**
 * The native module of the apps `ng build --platform` makes
 * (`LinkingModule.swift` and `LinkingModule.kt` in `packages/native/templates`).
 */
const LINKING_MODULE = 'AngularLynxLinking';

/**
 * The global event those apps send when a link to the app arrives while it's
 * open. It carries nothing: the listener answers by taking the links waiting
 * (`takeURLs`).
 */
const LINK_EVENT = 'angularLynxURL';

/**
 * The global prop holding the link that started the app. The shells send it
 * with the others before the bundle runs, so it's there on the main thread
 * when the router picks its first route.
 */
const INITIAL_URL_PROP = 'initialURL';

/** What a handler registered with {@link LynxLinking.onURL} is called with. */
export type LynxLinkHandler = (url: string) => void;

/** What the shell's `takeURLs` calls back with. */
type TakeURLsResult = { readonly urls?: readonly string[] };

type GlobalEventEmitter = {
  addListener(name: string, listener: () => void): unknown;
};

/**
 * What the shell's module calls back with: `{}` once it's done, `{ value }`
 * for `canOpenURL`, or `{ error: 'failed', message }`.
 */
type NativeResult = {
  readonly value?: boolean;
  readonly error?: string;
  readonly message?: string;
};

/**
 * The part of the browser's `window` this uses. The runtime builds without
 * the DOM's types, since Lynx has no DOM.
 */
type BrowserWindow = {
  open(url: string, target: string): BrowserTab | null;
  readonly document?: { readonly visibilityState?: string };
};

type BrowserTab = { opener: unknown; readonly closed: boolean };

/**
 * Why a link didn't open:
 * - `unavailable`: the host can't open links. Only the apps
 *   `ng build --platform` makes can; Lynx Explorer can't.
 * - `failed`: nothing on the device could open the URL, or the platform
 *   wouldn't: a browser sheet was already open, or the browser blocked the
 *   new tab.
 */
export type LinkingErrorCode = 'unavailable' | 'failed';

/** The error a {@link LynxLinking} method rejects with. */
export class LinkingError extends Error {
  constructor(
    readonly code: LinkingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LinkingError';
  }
}

/** How {@link LynxLinking.openInApp} draws its browser sheet. */
export type OpenInAppOptions = {
  /**
   * The color of the sheet's toolbar, such as `#1e3a8a` or
   * `rgba(30, 58, 138, 1)`. Android picks the icons' color to contrast with
   * it.
   */
  readonly toolbarColor?: string;
  /**
   * The color of the sheet's buttons. iOS only: a Custom Tab picks its
   * icons' color from the toolbar's.
   */
  readonly controlsColor?: string;
};

/** `https:`, `mailto:`, `myapp:`: a URL starts with its scheme. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The route a link to the app leads to: its path, with the query and the
 * fragment. For the app's own scheme, everything after the `//` is the route,
 * the host too, as Expo Router reads a link: `myapp://orders/42?tab=items`
 * and `myapp:///orders/42?tab=items` both lead to `/orders/42?tab=items`, and
 * `myapp://` to `/`. For an http(s) link, the host is the website's, so the
 * route starts after it. Read by hand rather than with `URL`, which puts a
 * custom scheme's first part in `host`, where the route wants it.
 */
export const routeOfLink = (url: string): string => {
  const scheme = SCHEME.exec(url);
  let rest = scheme ? url.slice(scheme[0].length) : url;
  if (rest.startsWith('//')) {
    rest = rest.slice(2);
    if (scheme && /^https?$/i.test(scheme[1])) {
      const end = rest.search(/[/?#]/);
      rest = end < 0 ? '' : rest.slice(end);
    }
  }
  return rest.startsWith('/') ? rest : `/${rest}`;
};

/**
 * The DestroyRef of whatever is being constructed, or null outside an
 * injection context. Angular has no public check for one, and `inject()`
 * throws outside it.
 */
const currentDestroyRef = (): DestroyRef | null => {
  try {
    return inject(DestroyRef);
  } catch {
    return null;
  }
};

/**
 * Checks that `url` has a scheme, as `window.open` and the platforms need:
 * a relative URL has no page to be relative to on Lynx.
 */
const schemeOf = (url: string): string => {
  const scheme = SCHEME.exec(url)?.[1];
  if (scheme === undefined) {
    throw new TypeError(
      `"${url}" is not an absolute URL. Give one with its scheme, such as https://example.com.`,
    );
  }
  return scheme.toLowerCase();
};

const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;

/**
 * A CSS color as a `#` and eight hex digits (red, green, blue, alpha), the
 * one form both shells' modules read. It takes a hex color, or `rgb()` and
 * `rgba()` with commas, which is how Lynx itself writes them.
 */
const toHexColor = (color: string, option: string): string => {
  const hex = HEX_COLOR.exec(color.trim())?.[1];
  if (hex !== undefined) {
    const full =
      hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    return `#${full.padEnd(8, 'f').toUpperCase()}`;
  }
  const rgb = RGB_COLOR.exec(color.trim());
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number);
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if (channels.every((channel) => channel <= 255) && alpha <= 1) {
      return `#${[...channels, Math.round(alpha * 255)]
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
    }
  }
  throw new TypeError(
    `${option} "${color}" is not a color LynxLinking reads. Give a hex color, such as #1e3a8a, or rgb()/rgba() with commas.`,
  );
};

/**
 * The page's `window` in Lynx for Web, or undefined elsewhere.
 *
 * Web-core runs the main thread, where Angular runs, in an iframe of the
 * page. Elsewhere it's left alone even where it exists, such as in unit tests
 * under jsdom, which stand in for a native host.
 */
const browserWindow = (): BrowserWindow | undefined => {
  if (
    typeof SystemInfo === 'undefined' ||
    // The global is typed by `@lynx-js/types`, whose PlatformType leaves out
    // the 'web' web-core reports; AngularLynx's own PlatformType has it.
    (SystemInfo.platform as PlatformType) !== 'web'
  ) {
    return undefined;
  }
  // The iframe is sandboxed without `allow-popups`, so its own window.open()
  // opens nothing. The page around it, the same origin, opens the tab.
  const own = globalThis as Partial<BrowserWindow> & { parent?: unknown };
  for (const window of [own.parent, own] as Partial<BrowserWindow>[]) {
    try {
      if (typeof window?.open === 'function') return window as BrowserWindow;
    } catch {
      // A parent of another origin, which can't be read.
    }
  }
  return undefined;
};

/**
 * Opens `url` in a new tab. It runs before anything is awaited, so the open
 * still counts as part of the tap that asked for it: browsers block a new
 * tab that isn't.
 */
const openTab = (window: BrowserWindow, url: string): BrowserTab => {
  const tab = window.open(url, '_blank');
  if (!tab) {
    throw new LinkingError(
      'failed',
      'The browser blocked the new tab. Open links from a tap.',
    );
  }
  // Keeps the page from reaching back into the app. Asking window.open() for
  // that instead makes it return null, and then closing the tab can't be
  // seen.
  try {
    tab.opener = null;
  } catch {
    // Some browsers don't let the opener be cleared. The page still opens.
  }
  return tab;
};

/**
 * Resolves once the person is back on the app's page: when they close the
 * tab, or come back to the app's tab, as the sheet resolves on Android when
 * the app comes back. Browsers tell a page nothing about another tab it
 * opened, so this looks every quarter second.
 */
const untilBack = (window: BrowserWindow, tab: BrowserTab): Promise<void> =>
  new Promise((resolve) => {
    let left = false;
    const timer = setInterval(() => {
      const hidden = window.document?.visibilityState === 'hidden';
      left ||= hidden;
      if (tab.closed || (left && !hidden)) {
        clearInterval(timer);
        resolve();
      }
    }, 250);
  });

/**
 * Opens links outside the app, in the browser, in another app, or in a
 * browser sheet over the app, and hears the links that open this one.
 *
 * Lynx has no `window.open`, `location` or `<a href>`, so a link can't leave
 * the app on its own. This hands it to the platform:
 *
 * - **iOS:** `UIApplication.open` for {@link openURL}, and
 *   `SFSafariViewController` for {@link openInApp}.
 * - **Android:** an `ACTION_VIEW` intent for {@link openURL}, and a Custom
 *   Tab for {@link openInApp}.
 * - **Web:** a new tab for both.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it, `AngularLynxLinking`. In Lynx Explorer, {@link openURL} and
 * {@link openInApp} reject with `unavailable` and {@link canOpenURL}
 * resolves `false`. Under the testing library, they record the URLs, so a
 * spec can check where a tap leads.
 *
 * A link with one of angular.json's `deepLinkSchemes`, such as
 * `myapp://orders/42`, opens the app. With `provideRouter()`, the router goes
 * to the link's route (`/orders/42`) by itself, at launch and while the app
 * is open; `provideDeepLinkRoute()` changes where a link leads. For the URL
 * itself, {@link getInitialURL} returns the link that started the app, and
 * {@link onURL} hears the links that arrive while it's open.
 *
 * @usageNotes
 * ```typescript
 * const linking = inject(LynxLinking);
 *
 * await linking.openInApp('https://example.com/help');
 * await linking.openURL('mailto:support@example.com');
 *
 * linking.onURL((url) => console.log('Opened with', url));
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxLinking {
  readonly #injector = inject(Injector);
  readonly #handlers = new Set<LynxLinkHandler>();
  #listening = false;

  /**
   * The link that started the app, such as `myapp://orders/42`, or `null`
   * when the person started it some other way, from its icon for instance.
   * It stays the same for as long as the app runs, as React Native's
   * `Linking.getInitialURL()` does, though it doesn't need to wait for it:
   * the shell hands it over before the app starts.
   *
   * Only the apps `ng build --platform` makes are started by links. In Lynx
   * Explorer and on the web, it's always `null`.
   */
  getInitialURL(): string | null {
    const props =
      typeof lynx !== 'undefined'
        ? (lynx.__globalProps as Record<string, unknown> | undefined)
        : undefined;
    const url = props?.[INITIAL_URL_PROP];
    return typeof url === 'string' && url !== '' ? url : null;
  }

  /**
   * Calls `handler` with each link that opens the app while it's running,
   * whether it's on screen or in the background, as React Native's `url`
   * event does. The link that started the app isn't one of them: read it
   * with {@link getInitialURL}.
   *
   * Links that arrived before anything listened, while the app was still
   * starting, wait for the first handler.
   *
   * Called from an injection context, such as a constructor, the handler is
   * removed when the component or service is destroyed; pass an `injector`
   * to tie it to another one. The function it returns removes it sooner.
   *
   * @param handler - Called with the whole URL, such as
   *   `myapp://orders/42?tab=items`.
   * @returns A function that removes the handler.
   */
  onURL(
    handler: LynxLinkHandler,
    options?: { readonly injector?: Injector },
  ): () => void {
    this.#handlers.add(handler);
    const remove = () => {
      this.#handlers.delete(handler);
    };
    (options?.injector?.get(DestroyRef) ?? currentDestroyRef())?.onDestroy(
      remove,
    );
    this.#listen();
    return remove;
  }

  /**
   * Starts hearing links, once. The shell keeps each link until it's taken,
   * and sends the event when one arrives. Listening before the first take
   * means none is missed: one that arrives in between is taken by whichever
   * call comes next, and one from before, by the first.
   *
   * On the main thread, where Angular runs, the emitter is a proxy whose
   * calls go through the background thread and return promises.
   */
  #listen(): void {
    if (this.#listening) return;
    this.#listening = true;
    const emitter = this.#injector
      .get(LynxNativeModule)
      .getJSModule<GlobalEventEmitter>('GlobalEventEmitter');
    void Promise.resolve()
      .then(() => emitter?.addListener(LINK_EVENT, () => void this.#take()))
      .catch(() => {
        // Without a background thread there are no global events to hear.
      })
      .then(() => this.#take());
  }

  /**
   * Asks the shell for the links that arrived since the last time. 
   */
  async #take(): Promise<void> {
    let result: TakeURLsResult | undefined;
    try {
      result = (await callOnBackground(
        'callNativeModuleAsync',
        LINKING_MODULE,
        'takeURLs',
        [],
      )) as TakeURLsResult | undefined;
    } catch {
      // A host without the module, such as Lynx Explorer or the web, has no
      // links to the app.
      return;
    }
    for (const url of result?.urls ?? []) {
      // A handler may remove itself as it's called: a Set skips what was
      // removed and carries on.
      for (const handler of this.#handlers) {
        // One handler's error mustn't keep the link from the others.
        try {
          handler(url);
        } catch (error) {
          this.#injector.get(ErrorHandler).handleError(error);
        }
      }
    }
  }

  /**
   * Opens `url` where the system opens it: the default browser for http(s),
   * Mail for `mailto:`, the phone for `tel:`, and another app for its own
   * scheme. An http(s) link to an app that claims it, through a universal
   * link or an Android App Link, opens that app. Resolves once the URL is
   * handed over, and rejects with a {@link LinkingError} when nothing can
   * open it, or with a `TypeError` when it isn't an absolute URL.
   */
  openURL(url: string): Promise<void> {
    try {
      schemeOf(url);
      const web = browserWindow();
      if (web) {
        openTab(web, url);
        return Promise.resolve();
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#call('openURL', [url]).then(() => undefined);
  }

  /**
   * Opens an http(s) `url` in a browser sheet over the app, so the person
   * comes straight back to where they were: `SFSafariViewController` on iOS,
   * a Custom Tab on Android, and a new tab on the web. It shares the
   * browser's cookies on Android, and on iOS keeps its own.
   *
   * Resolves once the person is back in the app: when they close the sheet
   * on iOS, and when the app comes back to the front on Android, which says
   * nothing else when a Custom Tab closes. On the web, it resolves when they
   * close the tab or come back to the app's tab. Rejects with a `TypeError`
   * for a URL that isn't http(s), which the sheets can't show, and with a
   * {@link LinkingError} when the sheet can't open.
   */
  openInApp(url: string, options: OpenInAppOptions = {}): Promise<void> {
    let request: Record<string, string>;
    try {
      const scheme = schemeOf(url);
      if (scheme !== 'http' && scheme !== 'https') {
        throw new TypeError(
          `openInApp() opens http and https URLs only, not "${url}". Use openURL() for other schemes.`,
        );
      }
      request = {};
      if (options.toolbarColor !== undefined) {
        request['toolbarColor'] = toHexColor(
          options.toolbarColor,
          'toolbarColor',
        );
      }
      if (options.controlsColor !== undefined) {
        request['controlsColor'] = toHexColor(
          options.controlsColor,
          'controlsColor',
        );
      }
      const web = browserWindow();
      if (web) {
        return untilBack(web, openTab(web, url));
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#call('openInApp', [url, request]).then(() => undefined);
  }

  /**
   * Resolves whether something on the device can open `url`: an app for its
   * scheme, or a browser for http(s). Ask before showing a link to an app
   * that may not be installed.
   *
   * iOS answers only for the schemes the app declares, and Android 11 and
   * later only for the apps it declares it looks for: list the schemes in
   * angular.json's `canOpenURLSchemes`. Both always have `http`, `https`,
   * `mailto`, `tel` and `sms`. Without the native module, as in Lynx
   * Explorer, it resolves `false`, since {@link openURL} can't open anything
   * there. On the web, it resolves `true`: a browser can't tell, and hands
   * any scheme on to the system.
   */
  async canOpenURL(url: string): Promise<boolean> {
    schemeOf(url);
    if (browserWindow()) return true;
    try {
      return (await this.#call('canOpenURL', [url])).value === true;
    } catch (error) {
      if ((error as LinkingError).code === 'unavailable') return false;
      throw error;
    }
  }

  /**
   * Calls the shell's module, which answers through a callback on the
   * background thread, where `NativeModules` lives (see
   * callNativeModuleAsync in background-call.ts).
   */
  async #call(method: string, args: unknown[]): Promise<NativeResult> {
    let result: NativeResult | undefined;
    try {
      result = (await callOnBackground(
        'callNativeModuleAsync',
        LINKING_MODULE,
        method,
        args,
      )) as NativeResult | undefined;
    } catch {
      throw new LinkingError(
        'unavailable',
        "This host can't open links. Only the apps `ng build --platform` makes can.",
      );
    }
    if (result?.error !== undefined) {
      throw new LinkingError(
        'failed',
        result.message ?? "The link didn't open.",
      );
    }
    return result ?? {};
  }
}
