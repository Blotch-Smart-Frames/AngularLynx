/**
 * The E2E app's environment. Its production configuration, which every layer
 * that renders the app builds, replaces this file with environment.e2e.ts
 * through angular.json's `fileReplacements` (issue #175).
 *
 * The URL is one the static server doesn't serve, so an app built without the
 * replacement shows a 404 for it where the counter page expects
 * "HTTP: pong/pong".
 */
export const environment = {
  httpDataUrl: 'http://127.0.0.1:3210/environment-not-replaced.json',
};
