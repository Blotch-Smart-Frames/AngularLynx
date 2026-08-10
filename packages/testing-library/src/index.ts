export { render, cleanup, waitForUpdate } from './render.js';
export type { RenderOptions, RenderResult } from './render.js';
export type { ComponentRef } from '@angular/core';
export { fireEvent, eventMap } from './fire-event.js';
export { screen, within, getQueriesForElement } from '@testing-library/dom';

import { cleanup } from './render.js';

// Auto-cleanup after each test (matches @testing-library/react convention).
// Set ATL_SKIP_AUTO_CLEANUP=true to opt out.
// Uses the global afterEach so this works with vitest, jest, and jasmine.
if (
  typeof process === 'undefined' ||
  process.env['ATL_SKIP_AUTO_CLEANUP'] !== 'true'
) {
  const _afterEach = (globalThis as any).afterEach;
  if (typeof _afterEach === 'function') {
    _afterEach(() => {
      cleanup();
      (globalThis as any).lynxTestingEnv?.reset();
    });
  }
}
