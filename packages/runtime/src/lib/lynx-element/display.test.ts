import { describe, expect, it } from 'vitest';
import { toLynxDisplay, withLynxDisplay } from './display';

describe('toLynxDisplay', () => {
  it.each([
    ['block', 'linear'],
    ['flow-root', 'linear'],
    ['inline', 'linear'],
    ['inline-block', 'linear'],
    ['inline-flex', 'flex'],
    ['inline-grid', 'grid'],
    ['BLOCK', 'linear'],
    [' block ', 'linear'],
    // A `[style.display.important]` binding.
    ['block !important', 'linear !important'],
    ['inline-flex!important', 'flex !important'],
  ])('maps %j to %j', (value, expected) => {
    expect(toLynxDisplay(value)).toBe(expected);
  });

  it.each(['flex', 'grid', 'linear', 'none', 'relative', 'var(--d)', ''])(
    'leaves %j alone',
    (value) => {
      expect(toLynxDisplay(value)).toBe(value);
    },
  );

  it('leaves a value that is not a string alone', () => {
    expect(toLynxDisplay(null)).toBeNull();
    expect(toLynxDisplay(undefined)).toBeUndefined();
    expect(toLynxDisplay(0)).toBe(0);
  });
});

describe('withLynxDisplay', () => {
  it.each([
    ['display: block', 'display: linear'],
    ['display:block;', 'display:linear;'],
    [
      'width: 100%; display: block; height: 10px',
      'width: 100%; display: linear; height: 10px',
    ],
    ['display: inline-flex !important', 'display: flex !important'],
    ['DISPLAY: Block', 'DISPLAY: linear'],
    ['display: block; display: inline-grid', 'display: linear; display: grid'],
  ])('rewrites %j', (style, expected) => {
    expect(withLynxDisplay(style)).toBe(expected);
  });

  it.each([
    'display: flex',
    'display: none; color: red',
    // A custom property, which the app may read as anything.
    '--display: block',
    'color: red',
    '',
  ])('leaves %j alone', (style) => {
    expect(withLynxDisplay(style)).toBe(style);
  });
});
