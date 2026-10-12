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

test('the generated app loads lazy routes', async ({ page }) => {
  // Known bug (BUG_LIST.md, "Lazy routes fail in production builds"): the lazy
  // bundle's main-thread code fails to evaluate. test.fail() keeps the suite
  // green while the bug exists and turns it red once the bug is fixed, so
  // remove this line together with the fix.
  test.fail();
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByText(appName, { exact: true })).toBeVisible();

  // A lazy route's chunk loads and renders.
  await page.getByText('Open lazy page', { exact: true }).click();
  await expect(page.getByText('Lazy page loaded')).toBeVisible();

  expect(errors, 'the app logged errors while running').toEqual([]);
});
