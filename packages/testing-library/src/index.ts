export { render, cleanup, waitForUpdate } from './render.js';
export type { RenderOptions, RenderResult } from './render.js';
export type { ComponentRef } from '@angular/core';
export { fireEvent, eventMap } from './fire-event.js';
export { screen, within, getQueriesForElement } from '@testing-library/dom';

import { cleanup } from './render.js';

/**
 * Auto-cleanup after each test (matches @testing-library/react convention).
 * Set ATL_SKIP_AUTO_CLEANUP=true to opt out. Uses the global afterEach so this
 * works with vitest, jest, and jasmine.
 */
const registerAutoCleanup = (): void => {
  const _afterEach = (globalThis as any).afterEach;
  if (typeof _afterEach === 'function') {
    _afterEach(() => {
      cleanup();
      (globalThis as any).lynxTestingEnv?.reset();
    });
  }
};

// `process` is absent in non-Node runners (e.g. a browser). That guard cannot
// execute under Node/Vitest — and faking a process-less global crashes Angular's
// import (it reads process.platform) — so it is excluded from coverage. The
// Node path (the opt-out env check) is fully tested.
/* v8 ignore next 2 -- @preserve non-Node guard: unreachable + untestable under Vitest */
if (typeof process === 'undefined') {
  registerAutoCleanup();
} else if (process.env['ATL_SKIP_AUTO_CLEANUP'] !== 'true') {
  registerAutoCleanup();
}
