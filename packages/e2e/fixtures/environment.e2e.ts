/**
 * Replaces environment.ts in the E2E app's production build (see there). It
 * sits outside the app, next to its folder, as environments that a
 * monorepo's apps share do: angular.json names it `../environments/...`.
 *
 * The URL is where every layer that renders the app serves
 * fixtures/http-data.json (src/static-server.ts). It's absolute because Lynx
 * has no page URL to resolve a relative one against, and the app's own build
 * loads its bundle from inside the app.
 */
export const environment = {
  httpDataUrl: 'http://127.0.0.1:3210/e2e-http.json',
};
