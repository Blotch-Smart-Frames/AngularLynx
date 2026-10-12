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
