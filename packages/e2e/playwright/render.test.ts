// cspell:words filechooser
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * Layer 3: loads the generated app in Lynx for Web and checks it renders,
 * responds to taps, and loads lazy routes, without any runtime errors.
 *
 * Lynx for Web draws elements inside open shadow roots, which Playwright's
 * text and CSS locators pierce, so no special handling is needed.
 */
const appName = process.env['E2E_APP_NAME'] ?? 'my-app';

/**
 * Collects page errors and `console.error` calls from page load to the end of
 * the test. The app runs in web workers, whose console output Playwright also
 * reports on the page.
 */
const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  return errors;
};

test('the generated app renders and handles taps', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  // The root component renders the project name as its title.
  await expect(page.getByText(appName, { exact: true })).toBeVisible();

  // Event → change detection → renderer.
  await expect(page.getByText('Count: 0')).toBeVisible();
  await page.getByText('Increment', { exact: true }).click();
  await expect(page.getByText('Count: 1')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// A tap handler awaits an async background function through runOnBackground().
// The listener used to reply with the Promise itself, which JSON turned into
// {}, and to hand the function a MainThreadRef as a plain { _wvid }
// (issue #54).
test("a tap handler gets an async background function's result", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByText(appName, { exact: true })).toBeVisible();

  await page.getByText('Ask background', { exact: true }).click();
  await expect(page.getByText('Background: 42')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// The counter page loads fixtures/http-data.json through HttpClient and
// httpResource when it starts, and posts JSON that the server echoes the
// Content-Type of. On the web, the main thread runs in a browser frame, which
// has fetch; on Lynx it relays to the background thread's (issues #85 and
// #176, checked by native/http.yaml). The JSON's URL comes from the
// environment file the production build swaps in: without it, the page shows
// a 404 for environment-not-replaced.json (issue #175). The last "pong" is
// read through fetch()'s response.body stream (issue #205).
test('HttpClient and httpResource load JSON, and HttpClient posts it', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByText('HTTP: pong/pong/json/pong')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// Lynx for Web loads a lazy bundle by evaluating its main-thread half, which
// the plugin never emitted, so this used to fail with "SyntaxError: Unexpected
// token '}'". Dynamic imports are now inlined into the main bundle on every
// environment, so a regression here means a lazy bundle is being emitted again.
test('the generated app loads lazy routes', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByText(appName, { exact: true })).toBeVisible();

  // A lazy route's chunk loads and renders.
  await page.getByText('Open lazy page', { exact: true }).click();
  await expect(page.getByText('Lazy page loaded')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// "Open lazy page" and "Open gestures" are Angular's own routerLinks, which
// listen for `click`, while Lynx elements fire `tap` (issue #113). The
// renderer hands them the tap, and routerLinkActive marks the open one, adding
// the `selected` accessibility trait to its own `button`. Lynx for Web keeps
// the trait as an attribute.
test('router links navigate on tap and mark the active link', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const lazyLink = page.locator('[accessibility-label="Open lazy page"]');
  const gesturesLink = page.locator('[accessibility-label="Open gestures"]');

  await page.getByText('Open lazy page', { exact: true }).click();
  await expect(page.getByText('Lazy page loaded')).toBeVisible();
  await expect(lazyLink).toHaveAttribute(
    'accessibility-traits',
    'button,selected',
  );
  await expect(lazyLink).toHaveClass(/(^|\s)active(\s|$)/);
  await expect(gesturesLink).toHaveAttribute('accessibility-traits', 'button');

  await page.getByText('Open gestures', { exact: true }).click();
  await expect(page.getByText('Lazy page loaded')).toBeHidden();
  await expect(gesturesLink).toHaveAttribute(
    'accessibility-traits',
    'button,selected',
  );
  await expect(lazyLink).toHaveAttribute('accessibility-traits', 'button');
  await expect(lazyLink).not.toHaveClass(/(^|\s)active(\s|$)/);

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// Setting a [mainThreadBind*] input to null must remove its handler. The lazy
// page's first tap counts and turns the handler off, so a second tap must leave
// the count at 1 (issue #55). Native Lynx is where removal broke; this checks
// the same fixture on the web.
test('a main-thread handler set to null stops running', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByText('Open lazy page', { exact: true }).click();

  await page.getByText('Main taps: 0').click();
  await expect(page.getByText('Main taps: 1')).toBeVisible();
  await page.getByText('Main taps: 1').click();
  // A second count would render within a frame or two of the tap.
  await page.waitForTimeout(500);
  await expect(page.getByText('Main taps: 1')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// Angular runs on the main thread only. The background thread used to start a
// second copy of the app, so the lazy page's ngOnInit ran twice, and a lazy
// chunk's background function was there only because that copy's router loaded
// the chunk too (issue #81).
test('Angular runs once, and the background thread still answers', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByText('Open lazy page', { exact: true }).click();
  await expect(page.getByText('Lazy page loaded')).toBeVisible();

  // A background function defined in the lazy chunk. It round-trips its
  // answer through btoa and atob, which the runtime installs on Lynx's
  // background thread (issue #206); the web's Web Worker has its own.
  await page.getByText('Echo:').click();
  await expect(page.getByText('Echo: hi back')).toBeVisible();

  // GlobalEventEmitter, a JS module only the background thread has, through
  // LynxNativeModule's relay: the listener and the emit go there, and the
  // event comes back.
  await page.getByText('Emitter:').click();
  await expect(page.getByText('Emitter: pong')).toBeVisible();

  // By now a second copy's ngOnInit would have counted too.
  await expect(page.getByText('Init runs: 1')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// Lynx for Web's web-core recognizes no gestures, so `[lynxGesture]` did
// nothing in the web preview. The runtime now runs its port of Lynx's gesture
// arena there on pointer events. The same swipe as native/gestures.yaml: the
// pan reports the distance moved before it activated, and the fling that
// follows the release runs its onEnd.
test('a swipe runs a pan and the fling after it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByText('Open gestures', { exact: true }).click();
  await expect(page.getByText('Pan from touch: no')).toBeVisible();

  // getByText finds the words' own <raw-text>, which has no box; the <text>
  // around them does.
  const words = page.getByText('Swipe here', { exact: true });
  const box = await page.locator('x-text', { has: words }).boundingBox();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Quick enough to fling: 120px in about 100ms.
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(x + step * 20, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();

  await expect(page.getByText('Pan from touch: yes')).toBeVisible();
  // The fling ends when its momentum runs out, a few seconds after the swipe.
  await expect(page.getByText('Fling ended: yes')).toBeVisible({
    timeout: 15_000,
  });

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// LynxLocalStorage and LynxSecureStorage keep their values in the page's
// localStorage on the web, so a reload finds them (issue #178;
// native/storage.yaml checks the app's own iOS and Android builds). The
// storage page shows what both held when it opened, then stores "kept".
test('local and secure storage keep their values after a reload', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByText('Open storage', { exact: true }).click();
  await expect(page.getByText('Stored: none/none')).toBeVisible();

  await page.reload();
  await page.getByText('Open storage', { exact: true }).click();
  await expect(page.getByText('Stored: kept/kept')).toBeVisible();

  await page.getByText('Clear storage', { exact: true }).click();
  await expect(page.getByText('Stored: none/none')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// LynxClipboard copies with the Clipboard API of the page around web-core's
// main-thread iframe, whose own document never has focus (issue #303;
// native/clipboard.yaml checks the app's own iOS and Android builds). The
// storage page's "Clipboard" line copies a line and shows what it reads
// back, which takes the browser's permission to read.
test('copies text to the clipboard and reads it back', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByText('Open storage', { exact: true }).click();
  await page.getByText('Clipboard: tap', { exact: true }).click();
  await expect(page.getByText('Clipboard: copied by e2e')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'copied by e2e',
  );

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// <canvas> is the browser's in the web preview, with its own WebGL2 (issue
// #211; native/canvas.yaml checks the app's own iOS and Android builds,
// where the runtime's context draws through the shell). The canvas page
// draws a texture createImageBitmap() decoded through a shader, then shows a
// pixel it read back.
test('a canvas draws with WebGL2', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByText('Open storage', { exact: true }).click();
  await page.getByText('Open canvas', { exact: true }).click();
  await expect(page.getByText('WebGL: 0,0,255,255')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// LynxImagePicker (issue #305) opens an <input type="file"> in the web
// preview: in the page's document, since the browser opens a file dialog
// only for the document the tap was in, and web-core runs Angular in a
// hidden iframe. The photo page asks for the photo scaled to 64 pixels, which
// the browser re-encodes as a JPEG, then uploads the Blob with
// XMLHttpRequest to the echo, which answers with its Content-Type and size
// (native/photo.yaml does the same through the shells' pickers).
test('a picked photo comes back as a JPEG Blob that uploads', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByText('Open storage', { exact: true }).click();
  await page.getByText('Open canvas', { exact: true }).click();
  await page.getByText('Open photo', { exact: true }).click();

  const canceled = page.waitForEvent('filechooser');
  await page.getByText('Pick photo', { exact: true }).click();
  await (await canceled).setFiles([]);
  await expect(page.getByText('Photo: canceled')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Pick photo', { exact: true }).click();
  await (
    await chooser
  ).setFiles(path.join(import.meta.dirname, '../native/photo.jpg'));
  await expect(page.getByText('Photo: uploaded as image/jpeg')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// A library's components arrive already compiled, with their styles in their
// definitions, so they used to bypass the build's style extraction: their
// rules stayed strings in the JavaScript and never reached Lynx's CSS (issue
// #240). The fixture library, compiled as ng-packagr compiles one, styles a
// class, its `:host` and a type selector.
test("a prebuilt library's component styles apply", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByText('Open storage', { exact: true }).click();
  await page.getByText('Open canvas', { exact: true }).click();

  const words = page.getByText('Styled by a prebuilt library', {
    exact: true,
  });
  await expect(words).toHaveCSS('color', 'rgb(200, 30, 90)');
  // Component hosts carry the class of their tag, which type selectors
  // become.
  await expect(page.locator('._ngtag-e2e-library-frame')).toHaveCSS(
    'background-color',
    'rgb(30, 60, 90)',
  );
  await expect(page.locator('._ngtag-e2e-library-label')).toHaveCSS(
    'background-color',
    'rgb(240, 200, 40)',
  );

  expect(errors, 'the app logged errors while running').toEqual([]);
});

// The build handed Tailwind the modules it bundled in place of `content`, and
// Angular's compiler reads an `.html` template without importing it, so classes
// used only in one got no CSS (issue #52).
test('Tailwind styles classes in .html templates', async ({ page }) => {
  test.skip(!process.env['E2E_APP_TAILWIND'], 'the app has no Tailwind');
  const errors = collectErrors(page);
  await page.goto('/');

  // tailwind-card.html's `text-[#0a7b5c]`.
  const words = page.getByText('Styled from an .html template', {
    exact: true,
  });
  await expect(words).toHaveCSS('color', 'rgb(10, 123, 92)');
  // Its `bg-primary/10`: the UI theme's --primary, rgba(24, 24, 27, 1), at
  // 10%. A modifier reads the color's channels from --primary-rgb: through
  // the theme's plugin on Tailwind 3, and on Tailwind 4 through the build's
  // rewrite of Tailwind's color-mix(). So this checks the theme files with
  // either in an app's own build (issues #115 and #116). getByText finds the words' own
  // <raw-text>, which inherits the color but not the background, so this
  // reads the <text> element itself.
  await expect(page.locator('x-text', { has: words })).toHaveCSS(
    'background-color',
    'rgba(24, 24, 27, 0.1)',
  );

  expect(errors, 'the app logged errors while running').toEqual([]);
});
