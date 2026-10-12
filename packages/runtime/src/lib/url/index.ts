import { LynxURL } from './url';
import { LynxURLSearchParams } from './url-search-params';

export { LynxURL, LynxURLSearchParams };

/**
 * Installs `URL` and `URLSearchParams` on `target` where it lacks them (Lynx's
 * main thread), keeping the platform's own implementations everywhere else.
 * Takes the global as a parameter so tests can pass a stand-in: replacing the
 * real `URL` would break the test runner's own module loading.
 */
export const installUrl = (target: {
  URL?: unknown;
  URLSearchParams?: unknown;
}): void => {
  if (typeof target.URL === 'undefined') target.URL = LynxURL;
  if (typeof target.URLSearchParams === 'undefined') {
    target.URLSearchParams = LynxURLSearchParams;
  }
};
