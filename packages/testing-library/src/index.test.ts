/**
 * index.ts re-export tests — verify every public symbol is present and typed correctly.
 */

import { describe, it, expect } from 'vitest';
import * as lib from './index.js';

describe('index exports', () => {
  it('exports render as a function', () => {
    expect(typeof lib.render).toBe('function');
  });

  it('exports cleanup as a function', () => {
    expect(typeof lib.cleanup).toBe('function');
  });

  it('exports waitForUpdate as a function', () => {
    expect(typeof lib.waitForUpdate).toBe('function');
  });

  it('exports fireEvent as a function', () => {
    expect(typeof lib.fireEvent).toBe('function');
  });

  it('exports eventMap as an object', () => {
    expect(lib.eventMap).toBeDefined();
    expect(typeof lib.eventMap).toBe('object');
  });

  it('exports screen from @testing-library/dom', () => {
    expect(lib.screen).toBeDefined();
    expect(typeof lib.screen.getByText).toBe('function');
  });

  it('exports within from @testing-library/dom', () => {
    expect(typeof lib.within).toBe('function');
  });

  it('exports getQueriesForElement from @testing-library/dom', () => {
    expect(typeof lib.getQueriesForElement).toBe('function');
  });
});
