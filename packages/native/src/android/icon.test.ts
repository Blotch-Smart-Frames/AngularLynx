import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TEMPLATES_DIR } from '../generate.ts';
import { resolveAppOptions } from '../options.ts';
import { decodePng, encodePng, type Image } from '../png.ts';
import {
  adaptiveIconXml,
  backgroundColorResource,
  DENSITIES,
  writeAndroidIcon,
} from './icon.ts';

let dir: string;
const res = (file: string) => path.join(dir, 'app/src/main/res', file);
const readPng = (file: string) => decodePng(readFileSync(res(file)));
/**
 * The pixel at (x, y), rounded down, since some densities scale by 1.5.
 */
const at = (image: Image, x: number, y: number) => {
  const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [...image.data.subarray(offset, offset + 4)];
};

/**
 * A size×size PNG: red in its middle half, blue around it, so the tests can
 * tell how an icon was scaled and placed.
 */
const fixtures = new Map<string, Buffer>();
const writeIcon = (file: string, size = 1024, alpha = 255) => {
  // Encoded once per kind: building a 1024 px image pixel by pixel is slow
  // under coverage, and most tests write the same one.
  const key = `${size}/${alpha}`;
  if (!fixtures.has(key)) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const middle = Math.min(x, y, size - 1 - x, size - 1 - y) >= size / 4;
        data.set(
          middle ? [255, 0, 0, 255] : [0, 0, 255, alpha],
          (y * size + x) * 4,
        );
      }
    }
    fixtures.set(key, encodePng({ width: size, height: size, data }));
  }
  writeFileSync(path.join(dir, file), fixtures.get(key)!);
};

const app = (options = {}) =>
  resolveAppOptions(options, { projectName: 'my-app' });

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'android-icon-'));
  cpSync(path.join(TEMPLATES_DIR, 'android'), dir, { recursive: true });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Each test resizes 1024 px images a dozen times or more, which a CI runner
// measuring coverage can take several seconds over.
describe('writeAndroidIcon', { timeout: 30_000 }, () => {
  it('keeps the placeholder without an icon', () => {
    writeAndroidIcon(dir, app(), dir);
    expect(existsSync(res('mipmap/ic_launcher.xml'))).toBe(true);
    expect(existsSync(res('mipmap/ic_launcher_round.xml'))).toBe(true);
    expect(existsSync(res('mipmap-mdpi'))).toBe(false);
  });

  it('makes the flat icons at every density, square and round', () => {
    writeIcon('icon.png');
    writeAndroidIcon(dir, app({ icon: 'icon.png' }), dir);

    for (const [density, scale] of Object.entries(DENSITIES)) {
      const square = readPng(`mipmap-${density}/ic_launcher.png`);
      const round = readPng(`mipmap-${density}/ic_launcher_round.png`);
      expect([square.width, square.height]).toEqual([48 * scale, 48 * scale]);
      expect([round.width, round.height]).toEqual([48 * scale, 48 * scale]);
      expect(at(square, 0, 0)).toEqual([0, 0, 255, 255]);
      expect(at(square, 24 * scale, 24 * scale)).toEqual([255, 0, 0, 255]);
      // The round icon is clear outside its circle.
      expect(at(round, 0, 0)[3]).toBe(0);
      expect(at(round, 24 * scale, 24 * scale)).toEqual([255, 0, 0, 255]);
    }
    // The vector placeholder is gone, so it can't win over the PNGs.
    for (const placeholder of [
      'mipmap/ic_launcher.xml',
      'mipmap/ic_launcher_round.xml',
      'drawable/ic_launcher_background.xml',
      'drawable/ic_launcher_foreground.xml',
    ]) {
      expect(existsSync(res(placeholder))).toBe(false);
    }
  });

  it('makes the default adaptive icon from the icon, whole inside the mask', () => {
    writeIcon('icon.png');
    writeAndroidIcon(dir, app({ icon: 'icon.png' }), dir);

    const xml = adaptiveIconXml({ foreground: false, background: 'image' });
    expect(readFileSync(res('mipmap-anydpi-v26/ic_launcher.xml'), 'utf8')).toBe(
      xml,
    );
    expect(
      readFileSync(res('mipmap-anydpi-v26/ic_launcher_round.xml'), 'utf8'),
    ).toBe(xml);
    expect(xml).toContain('@mipmap/ic_launcher_background');
    expect(xml).toContain('@android:color/transparent');

    for (const [density, scale] of Object.entries(DENSITIES)) {
      const layer = readPng(`mipmap-${density}/ic_launcher_background.png`);
      expect([layer.width, layer.height]).toEqual([108 * scale, 108 * scale]);
      // The icon's 1024 px fill the middle 72 dp: its red middle half spans
      // 36 dp, from 36 to 72 dp across the layer.
      expect(at(layer, 37 * scale, 54 * scale)).toEqual([255, 0, 0, 255]);
      expect(at(layer, 35 * scale, 54 * scale)).toEqual([0, 0, 255, 255]);
      // The margin continues the blue edge.
      expect(at(layer, 0, 0)).toEqual([0, 0, 255, 255]);
      expect(
        existsSync(res(`mipmap-${density}/ic_launcher_foreground.png`)),
      ).toBe(false);
    }
    expect(existsSync(res('values/ic_launcher_background.xml'))).toBe(false);
  });

  it('uses the adaptive icon layers, with a color background', () => {
    writeIcon('icon.png');
    writeIcon('fg.png', 1024, 0);
    writeAndroidIcon(
      dir,
      app({
        icon: 'icon.png',
        android: {
          adaptiveIcon: { foreground: 'fg.png', background: '#111111' },
        },
      }),
      dir,
    );

    expect(readFileSync(res('mipmap-anydpi-v26/ic_launcher.xml'), 'utf8')).toBe(
      adaptiveIconXml({ foreground: true, background: 'color' }),
    );
    expect(readFileSync(res('values/ic_launcher_background.xml'), 'utf8')).toBe(
      backgroundColorResource('#111111'),
    );
    for (const [density, scale] of Object.entries(DENSITIES)) {
      const foreground = readPng(
        `mipmap-${density}/ic_launcher_foreground.png`,
      );
      // The foreground fills the whole 108 dp layer, transparency kept.
      expect([foreground.width, foreground.height]).toEqual([
        108 * scale,
        108 * scale,
      ]);
      expect(at(foreground, 0, 0)[3]).toBe(0);
      expect(at(foreground, 54 * scale, 54 * scale)).toEqual([255, 0, 0, 255]);
      expect(
        existsSync(res(`mipmap-${density}/ic_launcher_background.png`)),
      ).toBe(false);
    }
  });

  it('uses a PNG background scaled to the whole layer', () => {
    writeIcon('icon.png');
    writeIcon('fg.png', 1024, 0);
    writeIcon('bg.png');
    writeAndroidIcon(
      dir,
      app({
        icon: 'icon.png',
        android: {
          adaptiveIcon: { foreground: 'fg.png', background: 'bg.png' },
        },
      }),
      dir,
    );

    const xml = readFileSync(res('mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
    expect(xml).toContain(
      '<background android:drawable="@mipmap/ic_launcher_background" />',
    );
    expect(xml).toContain(
      '<foreground android:drawable="@mipmap/ic_launcher_foreground" />',
    );
    const layer = readPng('mipmap-xxxhdpi/ic_launcher_background.png');
    expect(layer.width).toBe(432);
    // Red from a quarter of the way in: scaled to all 108 dp, not 72.
    expect(at(layer, 109, 216)).toEqual([255, 0, 0, 255]);
    expect(at(layer, 107, 216)).toEqual([0, 0, 255, 255]);
    expect(existsSync(res('values/ic_launcher_background.xml'))).toBe(false);
  });

  it('rejects a missing or wrongly sized image, naming the option', () => {
    writeIcon('icon.png');
    writeIcon('small.png', 512);
    expect(() =>
      writeAndroidIcon(dir, app({ icon: 'small.png' }), dir),
    ).toThrow('small.png is 512×512. icon must be a 1024×1024 PNG.');
    expect(() =>
      writeAndroidIcon(
        dir,
        app({
          icon: 'icon.png',
          android: {
            adaptiveIcon: { foreground: 'none.png', background: '#000' },
          },
        }),
        dir,
      ),
    ).toThrow("android.adaptiveIcon.foreground: none.png doesn't exist.");
  });
});
