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

  it('exports screen, with the Lynx queries', () => {
    expect(lib.screen).toBeDefined();
    expect(typeof lib.screen.getByText).toBe('function');
    expect(typeof lib.screen.getByAccessibilityLabel).toBe('function');
  });

  it('exports within', () => {
    expect(typeof lib.within).toBe('function');
  });

  it('exports getQueriesForElement', () => {
    expect(typeof lib.getQueriesForElement).toBe('function');
  });

  it('exports the queries object', () => {
    expect(typeof lib.queries.getByAccessibilityLabel).toBe('function');
  });

  it.each([
    'queryAllByAccessibilityLabel',
    'queryByAccessibilityLabel',
    'getAllByAccessibilityLabel',
    'getByAccessibilityLabel',
    'findAllByAccessibilityLabel',
    'findByAccessibilityLabel',
    'queryAllByRole',
    'queryByRole',
    'getAllByRole',
    'getByRole',
    'findAllByRole',
    'findByRole',
  ] as const)('exports %s', (name) => {
    expect(lib[name]).toBe(lib.queries[name]);
  });
});
