import { inject, Injectable } from '@angular/core';
import { LynxNativeModule } from '../native-module/native-module';

/**
 * The native module of the apps `ng build --platform` makes
 * (`WebAuthModule.swift` and `WebAuthModule.kt` in `packages/native/templates`).
 */
const WEB_AUTH_MODULE = 'AngularLynxWebAuth';

/** What the page is opened with, as the native module reads it. */
type WebAuthRequest = {
  readonly url: string;
  readonly callbackScheme: string;
  readonly ephemeral: boolean;
};

/**
 * How a session ended, as the native module reports it: the URL the page
 * returned to, or why it didn't.
 */
type WebAuthResult = {
  readonly url?: string;
  readonly error?: 'canceled' | 'failed';
  readonly message?: string;
};

type WebAuthModule = {
  start(
    request: WebAuthRequest,
    done: (result: WebAuthResult) => void,
  ): unknown;
};

/**
 * Why a web authentication session gave no callback URL:
 * - `canceled`: the person closed the sheet, or declined to open it.
 * - `unavailable`: the host can't open one. Only the apps that
 *   `ng build --platform` makes can; Lynx Explorer, the web preview and
 *   tests can't.
 * - `failed`: the platform couldn't open the page, or a session was already
 *   open.
 */
export type WebAuthSessionErrorCode = 'canceled' | 'unavailable' | 'failed';

/** The error a {@link LynxWebAuthSession} rejects with. */
export class WebAuthSessionError extends Error {
  constructor(
    readonly code: WebAuthSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WebAuthSessionError';
  }
}

/** What {@link LynxWebAuthSession.start} opens, and where it returns. */
export type WebAuthSessionOptions = {
  /** The page that starts the sign-in, such as a provider's authorize URL. */
  readonly url: string;
  /**
   * The URL scheme the page returns to, such as `myapp` for
   * `myapp://auth?code=…`. On Android it must also be one of the app's
   * `deepLinkSchemes`, so the redirect opens the app.
   */
  readonly callbackScheme: string;
  /**
   * Opens the page without the browser's cookies and keeps none it sets, so
   * the person signs in afresh and nothing stays signed in afterwards. iOS
   * only: Android's Custom Tabs share the browser's cookies.
   */
  readonly ephemeral?: boolean;
};

/**
 * Signs in through a web page, as OAuth and OpenID Connect providers need: it
 * opens the page in the platform's sign-in browser sheet, over the app, and
 * resolves with the URL the page redirects to on the app's own scheme. Read
 * the code or token from that URL.
 *
 * Lynx has no popups or redirects, so a web sign-in flow can't run inside
 * the app. The sheet is the platform's own: ASWebAuthenticationSession on
 * iOS, which asks before opening a site and shares Safari's sign-ins, and a
 * Custom Tab on Android, from which the redirect opens the app again.
 *
 * Only the apps `ng build --platform` makes have the native module behind
 * it. Elsewhere, such as Lynx Explorer, the web preview and tests, `start()`
 * rejects with `unavailable`.
 *
 * @usageNotes
 * ```typescript
 * const webAuth = inject(LynxWebAuthSession);
 *
 * const callback = await webAuth.start({
 *   url: 'https://example.com/oauth/authorize?client_id=…&redirect_uri=myapp://auth',
 *   callbackScheme: 'myapp',
 * });
 * const code = new URL(callback).searchParams.get('code');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxWebAuthSession {
  readonly #modules = inject(LynxNativeModule);

  /**
   * Opens `url` in the sign-in sheet and resolves with the whole URL the page
   * redirects to on `callbackScheme`, query and fragment included. Rejects
   * with a {@link WebAuthSessionError}.
   */
  start({
    url,
    callbackScheme,
    ephemeral = false,
  }: WebAuthSessionOptions): Promise<string> {
    // On the main thread, where Angular runs, the module is a proxy whose
    // calls go through the background thread: a host without it rejects the
    // call rather than returning no module.
    const module = this.#modules.getNativeModule(WEB_AUTH_MODULE) as
      | WebAuthModule
      | undefined;
    return new Promise((resolve, reject) => {
      const unavailable = (): void =>
        reject(
          new WebAuthSessionError(
            'unavailable',
            'This host has no web authentication session. Only the apps `ng build --platform` makes have one.',
          ),
        );
      if (!module) {
        unavailable();
        return;
      }
      Promise.resolve()
        .then(() =>
          module.start({ url, callbackScheme, ephemeral }, (result) => {
            if (result.url !== undefined) {
              resolve(result.url);
              return;
            }
            const code = result.error === 'canceled' ? 'canceled' : 'failed';
            reject(
              new WebAuthSessionError(
                code,
                result.message ??
                  (code === 'canceled'
                    ? 'The sign-in was canceled.'
                    : 'The sign-in page could not be opened.'),
              ),
            );
          }),
        )
        .catch(unavailable);
    });
  }
}
