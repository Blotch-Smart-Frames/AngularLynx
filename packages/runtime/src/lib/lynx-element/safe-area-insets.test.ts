import { afterEach, describe, expect, it } from 'vitest';
import {
  readsSafeAreaInsets,
  safeAreaInsetsStyle,
  setSafeAreaInsets,
  withSafeAreaInsets,
} from './safe-area-insets';

/** What a generated app's shell sends on an iPhone with a Dynamic Island. */
const PHONE = {
  edgeToEdge: true,
  safeAreaTop: 62,
  safeAreaRight: 0,
  safeAreaBottom: 34,
  safeAreaLeft: 0,
};

describe('safe-area insets', () => {
  // The insets are the app's, kept between calls; start each test without.
  afterEach(() => setSafeAreaInsets(undefined));

  describe('setSafeAreaInsets', () => {
    it('says whether the insets changed', () => {
      expect(setSafeAreaInsets(PHONE)).toBe(true);
      expect(setSafeAreaInsets({ ...PHONE, theme: 'Dark' })).toBe(false);
      // Rotated.
      expect(
        setSafeAreaInsets({ ...PHONE, safeAreaTop: 0, safeAreaBottom: 21 }),
      ).toBe(true);
      expect(setSafeAreaInsets(undefined)).toBe(true);
      expect(setSafeAreaInsets({})).toBe(false);
    });
  });

  describe('safeAreaInsetsStyle', () => {
    it("gives an edge-to-edge page the shell's insets", () => {
      setSafeAreaInsets(PHONE);
      expect(safeAreaInsetsStyle()).toBe(
        [
          '--angular-lynx-safe-area-inset-top: 62px',
          '--angular-lynx-safe-area-inset-right: 0px',
          '--angular-lynx-safe-area-inset-bottom: 34px',
          '--angular-lynx-safe-area-inset-left: 0px',
        ].join('; '),
      );
    });

    // Android sends dp, which can have a fraction.
    it('keeps fractions, and makes a missing or bad inset 0', () => {
      setSafeAreaInsets({
        edgeToEdge: true,
        safeAreaTop: 24.380953,
        safeAreaBottom: Number.NaN,
        safeAreaLeft: -3,
        safeAreaRight: '8',
      });
      expect(safeAreaInsetsStyle()).toBe(
        [
          '--angular-lynx-safe-area-inset-top: 24.380953px',
          '--angular-lynx-safe-area-inset-right: 0px',
          '--angular-lynx-safe-area-inset-bottom: 0px',
          '--angular-lynx-safe-area-inset-left: 0px',
        ].join('; '),
      );
    });

    // `"edgeToEdge": false`: the shell lays the page out inside the safe
    // area, though it still sends the window's insets.
    it('gives a page inside the safe area 0 on every side', () => {
      setSafeAreaInsets({ ...PHONE, edgeToEdge: false });
      expect(safeAreaInsetsStyle()).toBe(
        [
          '--angular-lynx-safe-area-inset-top: 0px',
          '--angular-lynx-safe-area-inset-right: 0px',
          '--angular-lynx-safe-area-inset-bottom: 0px',
          '--angular-lynx-safe-area-inset-left: 0px',
        ].join('; '),
      );
    });

    // Lynx Explorer sends insets but no edgeToEdge, and env() already
    // carries its insets there; the web preview sends neither.
    it('sets nothing for a host that sends no edgeToEdge', () => {
      for (const props of [
        { safeAreaTop: 62, safeAreaBottom: 34 },
        { edgeToEdge: 1 },
        {},
        undefined,
      ]) {
        setSafeAreaInsets(props);
        expect(safeAreaInsetsStyle()).toBe('');
      }
    });
  });

  describe('withSafeAreaInsets', () => {
    it.each([
      ['env(safe-area-inset-top)', '62px'],
      // The dock's lift above the home indicator.
      ['calc(49px + env(safe-area-inset-bottom))', 'calc(49px + 34px)'],
      ['env(safe-area-inset-left) env(safe-area-inset-right)', '0px 0px'],
      // Lynx reads no env() fallback, so dropping it loses nothing.
      ['env(safe-area-inset-bottom, 0px)', '34px'],
      ['env(safe-area-inset-bottom, calc(1px + 2px))', '34px'],
      ['ENV( Safe-Area-Inset-Top )', '62px'],
      ['env(safe-area-inset-top) !important', '62px !important'],
      // A whole style="...", custom properties and data URLs included.
      [
        'position: absolute; top: env(safe-area-inset-top); --gap: calc(env(safe-area-inset-top) + 8px)',
        'position: absolute; top: 62px; --gap: calc(62px + 8px)',
      ],
      [
        'background-image: url(data:image/png;base64,AAAA); bottom: env(safe-area-inset-bottom)',
        'background-image: url(data:image/png;base64,AAAA); bottom: 34px',
      ],
    ])('gives %j the insets', (value, expected) => {
      setSafeAreaInsets(PHONE);
      expect(withSafeAreaInsets(value)).toBe(expected);
    });

    it.each([
      '1rem',
      'env(keyboard-inset-height)',
      'var(--pad)',
      'environment(safe-area-inset-top)',
      '',
    ])('leaves %j alone', (value) => {
      setSafeAreaInsets(PHONE);
      expect(withSafeAreaInsets(value)).toBe(value);
    });

    it('leaves a value that is not a string alone', () => {
      setSafeAreaInsets(PHONE);
      expect(withSafeAreaInsets(null)).toBeNull();
      expect(withSafeAreaInsets(undefined)).toBeUndefined();
      expect(withSafeAreaInsets(12)).toBe(12);
    });

    // Lynx Explorer's env() carries the window's insets; the web preview's
    // is the browser's.
    it('leaves env() to Lynx where the host sends no insets', () => {
      const value = 'calc(49px + env(safe-area-inset-bottom))';
      expect(withSafeAreaInsets(value)).toBe(value);
    });
  });

  describe('readsSafeAreaInsets', () => {
    it('finds an inset in a value or a style', () => {
      // Twice, as a global regex's lastIndex would get the second one wrong.
      for (let i = 0; i < 2; i++) {
        expect(readsSafeAreaInsets('top: env(safe-area-inset-top)')).toBe(true);
      }
      expect(readsSafeAreaInsets('calc(1px + ENV(safe-area-inset-left))')).toBe(
        true,
      );
      expect(readsSafeAreaInsets('env(keyboard-inset-height)')).toBe(false);
      expect(readsSafeAreaInsets('1px')).toBe(false);
      expect(readsSafeAreaInsets(1)).toBe(false);
    });
  });
});
