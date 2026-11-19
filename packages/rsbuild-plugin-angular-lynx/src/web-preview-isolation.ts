import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';

/**
 * Where rspeedy's dev plugin serves the web preview: the page and web-core's
 * scripts, from `@lynx-js/web-rsbuild-server-middleware`. The path is fixed
 * there, so it's matched here the way that middleware matches it.
 */
const WEB_PREVIEW_URL = /^\/{1,2}__web_preview(?:[/?#]|$)/;

const EMBEDDER_POLICY_HEADER = 'cross-origin-embedder-policy';

/** The first Chromium and Firefox releases that know `credentialless`. */
const CHROMIUM_WITH_CREDENTIALLESS = 96;
const FIREFOX_WITH_CREDENTIALLESS = 119;

/**
 * Whether the browser that sent `userAgent` supports
 * `Cross-Origin-Embedder-Policy: credentialless`: Chromium 96 and Firefox 119
 * on a computer. Safari doesn't, and neither do Firefox and Opera on Android,
 * though their versions say otherwise (MDN's compatibility data).
 *
 * A browser that doesn't know the value reads the header as if it weren't
 * there, and the page loses `SharedArrayBuffer`. So anything not recognized
 * here counts as not supporting it.
 */
export const supportsCredentialless = (
  userAgent: string | undefined,
): boolean => {
  if (!userAgent) {
    return false;
  }
  const version = (pattern: RegExp): number =>
    Number(pattern.exec(userAgent)?.[1] ?? 0);
  if (/Android/.test(userAgent) && /(?:Firefox|OPR)\//.test(userAgent)) {
    return false;
  }
  // Not anchored to a word: headless Chrome calls itself "HeadlessChrome/".
  // Chrome and Firefox on iOS are WebKit, and name themselves CriOS and
  // FxiOS, which neither pattern matches.
  return (
    version(/(?:Chrome|Chromium)\/(\d+)/) >= CHROMIUM_WITH_CREDENTIALLESS ||
    version(/Firefox\/(\d+)/) >= FIREFOX_WITH_CREDENTIALLESS
  );
};

/**
 * Makes the web preview load images, video and audio from other servers.
 *
 * The preview page is cross-origin isolated, which web-core needs for
 * `SharedArrayBuffer`: rspeedy's middleware sends it with
 * `Cross-Origin-Embedder-Policy: require-corp`. Under that policy the browser
 * refuses every resource of another origin whose server doesn't send
 * `Cross-Origin-Resource-Policy`, and most don't (a museum's image server, a
 * CMS, MDN's sample videos). An `<image>` stayed empty with no error in the
 * app, only in this preview: the phone and a page that isn't isolated show it.
 *
 * `credentialless` keeps the page isolated and lets those resources load,
 * asked for without cookies. So the preview's responses carry that value
 * instead for a browser that supports it, and `require-corp` as before for
 * one that doesn't (Safari), where the page would otherwise lose its
 * isolation.
 *
 * The header is rewritten as rspeedy's middleware sets it, rather than set
 * here: that middleware ends the response itself, and this one stays out of
 * the way of whatever else it sends. If rspeedy stops isolating the page,
 * nothing here adds the header back.
 */
export const createWebPreviewIsolationMiddleware =
  () =>
  (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (
      WEB_PREVIEW_URL.test(req.url ?? '') &&
      supportsCredentialless(req.headers['user-agent'])
    ) {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) =>
        setHeader(
          name,
          name.toLowerCase() === EMBEDDER_POLICY_HEADER &&
            value === 'require-corp'
            ? 'credentialless'
            : value,
        );
    }
    next();
  };

/**
 * Adds {@link createWebPreviewIsolationMiddleware} to the dev server when it
 * serves the web preview, which rspeedy does for a `web` environment.
 */
export const applyWebPreviewIsolation = (api: RsbuildPluginAPI): void => {
  api.onBeforeStartDevServer({
    // Ahead of rspeedy's own hook, whatever order the plugins are listed in:
    // middlewares run in the order they're added, and rspeedy's answers the
    // preview's requests without calling the next one.
    order: 'pre',
    handler: ({ environments, server }) => {
      if (environments['web']) {
        server.middlewares.use(createWebPreviewIsolationMiddleware());
      }
    },
  });
};
