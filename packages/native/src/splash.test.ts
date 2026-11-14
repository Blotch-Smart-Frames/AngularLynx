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

import { TEMPLATES_DIR } from './generate.ts';
import { resolveAppOptions, type SplashOptions } from './options.ts';
import { decodePng, encodePng, type Image } from './png.ts';
import {
  ANDROID_CIRCLE_DP,
  androidSplashSize,
  launchBackgroundColorSet,
  launchImageSet,
  splashImageSize,
  splashWarnings,
  writeAndroidSplash,
  writeIosSplash,
} from './splash.ts';

let dir: string;

/**
 * A width×height PNG, opaque red on the left half and transparent on the
 * right, so a test can tell it was scaled and where it went.
 */
const writeImage = (file: string, width: number, height: number) => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width / 2; x++) {
      data.set([255, 0, 0, 255], (y * width + x) * 4);
    }
  }
  writeFileSync(path.join(dir, file), encodePng({ width, height, data }));
};

const readImage = (file: string): Image =>
  decodePng(readFileSync(path.join(dir, file)));

/**
 * The alpha at (x, y).
 */
const alphaAt = (image: Image, x: number, y: number) =>
  image.data[(y * image.width + x) * 4 + 3];

const app = (splash: SplashOptions) =>
  resolveAppOptions({ splash }, { projectName: 'my-app' });

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-splash-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sizes', () => {
  it('draws the image imageWidth across, as tall as its shape makes it', () => {
    expect(splashImageSize({ width: 600, height: 150 }, 200)).toEqual({
      width: 200,
      height: 50,
    });
  });

  it('keeps an image inside the circle Android shows as it is', () => {
    expect(androidSplashSize({ width: 100, height: 100 })).toEqual({
      width: 100,
      height: 100,
    });
  });

  it('scales one whose corners reach past the circle until they touch it', () => {
    const size = androidSplashSize({ width: 200, height: 50 });
    expect(Math.hypot(size.width, size.height)).toBeCloseTo(ANDROID_CIRCLE_DP);
    expect(size.width / size.height).toBeCloseTo(4);
  });
});

describe('splashWarnings', () => {
  it('has nothing to say without an image, or about a missing one', () => {
    expect(
      splashWarnings(app({ backgroundColor: '#000' }), dir, 'ios'),
    ).toEqual([]);
    expect(
      splashWarnings(
        app({ image: 'missing.png', imageWidth: 100 }),
        dir,
        'android',
      ),
    ).toEqual([]);
  });

  it('has nothing to say about a sharp image that fits', () => {
    writeImage('logo.png', 300, 300);
    expect(
      splashWarnings(
        app({ image: 'logo.png', imageWidth: 100 }),
        dir,
        'android',
      ),
    ).toEqual([]);
  });

  it('says when the image has too few pixels for a 3× screen', () => {
    writeImage('logo.png', 200, 200);
    expect(
      splashWarnings(app({ image: 'logo.png', imageWidth: 100 }), dir, 'ios'),
    ).toEqual([
      'splash.image is 200 px wide: at 100 points, a 3× screen needs 300 px for it to be sharp.',
    ]);
  });

  it("says on Android only when the image doesn't fit the circle, and the widest that would", () => {
    writeImage('logo-wide.png', 800, 200);
    writeImage('logo-wide-dark.png', 800, 200);
    const options = app({
      image: 'logo-wide.png',
      imageWidth: 200,
      dark: { image: 'logo-wide-dark.png' },
    });
    expect(splashWarnings(options, dir, 'ios')).toEqual([]);
    expect(splashWarnings(options, dir, 'android')).toEqual([
      "splash.image at 200 dp wide doesn't fit in the circle 192 dp across that Android shows of a splash screen's image, so Android draws it 186 dp wide. With an imageWidth of 186 or less, it's the same size on iOS and Android.",
      "splash.dark.image at 200 dp wide doesn't fit in the circle 192 dp across that Android shows of a splash screen's image, so Android draws it 186 dp wide. With an imageWidth of 186 or less, it's the same size on iOS and Android.",
    ]);
  });
});

describe('launchBackgroundColorSet', () => {
  const colors = (splash: SplashOptions) =>
    JSON.parse(launchBackgroundColorSet(app(splash).splash)).colors;

  it('gives one color for both modes when dark mode has the same', () => {
    expect(colors({ backgroundColor: '#FF8000' })).toEqual([
      {
        color: {
          'color-space': 'srgb',
          components: {
            alpha: '1.000',
            blue: '0.000',
            green: '0.502',
            red: '1.000',
          },
        },
        idiom: 'universal',
      },
    ]);
  });

  it('adds a dark appearance, and keeps white for light mode when only dark mode has a color', () => {
    const [light, dark] = colors({ dark: { backgroundColor: '#09090B' } });
    expect(light.color.components).toEqual({
      alpha: '1.000',
      blue: '1.000',
      green: '1.000',
      red: '1.000',
    });
    expect(dark).toEqual({
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      color: {
        'color-space': 'srgb',
        components: {
          alpha: '1.000',
          blue: '0.043',
          green: '0.035',
          red: '0.035',
        },
      },
      idiom: 'universal',
    });
  });

  it('reads #RGB as #RRGGBB', () => {
    expect(colors({ backgroundColor: '#f80' })).toEqual(
      colors({ backgroundColor: '#ff8800' }),
    );
  });
});

describe('writeIosSplash', () => {
  const assets = (file: string) => path.join('App/Assets.xcassets', file);
  const set = (file: string) => assets(`LaunchImage.imageset/${file}`);

  beforeEach(() => {
    cpSync(path.join(TEMPLATES_DIR, 'ios'), dir, { recursive: true });
  });

  it("keeps the template's white and writes no image without a splash", () => {
    const template = readFileSync(
      path.join(dir, assets('LaunchBackground.colorset/Contents.json')),
      'utf8',
    );
    writeIosSplash(dir, app({}), dir);
    expect(
      readFileSync(
        path.join(dir, assets('LaunchBackground.colorset/Contents.json')),
        'utf8',
      ),
    ).toBe(template);
    expect(existsSync(path.join(dir, set('Contents.json')))).toBe(false);
  });

  it('writes the color and each scale of the image, imageWidth points across', () => {
    writeImage('logo.png', 600, 300);
    writeIosSplash(
      dir,
      app({ image: 'logo.png', imageWidth: 100, backgroundColor: '#000000' }),
      dir,
    );
    expect(
      readFileSync(
        path.join(dir, assets('LaunchBackground.colorset/Contents.json')),
        'utf8',
      ),
    ).toBe(
      launchBackgroundColorSet(app({ backgroundColor: '#000000' }).splash),
    );
    expect(readFileSync(path.join(dir, set('Contents.json')), 'utf8')).toBe(
      launchImageSet(false),
    );
    for (const [file, width] of [
      ['LaunchImage.png', 100],
      ['LaunchImage@2x.png', 200],
      ['LaunchImage@3x.png', 300],
    ] as const) {
      const image = readImage(set(file));
      expect([image.width, image.height]).toEqual([width, width / 2]);
      // Still opaque on the left, clear on the right.
      expect(alphaAt(image, 0, 0)).toBe(255);
      expect(alphaAt(image, width - 1, 0)).toBe(0);
    }
    expect(existsSync(path.join(dir, set('LaunchImage-dark.png')))).toBe(false);
  });

  it('gives dark mode its own image', () => {
    writeImage('logo.png', 300, 300);
    writeImage('logo-dark.png', 300, 150);
    writeIosSplash(
      dir,
      app({
        image: 'logo.png',
        imageWidth: 100,
        dark: { image: 'logo-dark.png' },
      }),
      dir,
    );
    const contents = JSON.parse(
      readFileSync(path.join(dir, set('Contents.json')), 'utf8'),
    );
    expect(contents.images).toHaveLength(6);
    expect(contents.images[3]).toEqual({
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      filename: 'LaunchImage-dark.png',
      idiom: 'universal',
      scale: '1x',
    });
    expect(readImage(set('LaunchImage-dark@3x.png')).height).toBe(150);
  });

  it('says which image is missing, or not a PNG', () => {
    expect(() =>
      writeIosSplash(dir, app({ image: 'gone.png', imageWidth: 100 }), dir),
    ).toThrow("splash.image: gone.png doesn't exist.");
    writeFileSync(path.join(dir, 'fake.png'), 'a JPEG, really');
    expect(() =>
      writeIosSplash(dir, app({ image: 'fake.png', imageWidth: 100 }), dir),
    ).toThrow('is not a PNG file');
  });
});

describe('writeAndroidSplash', () => {
  const res = (file: string) => path.join(dir, 'app/src/main/res', file);
  const windowBackground = (folder: string) =>
    /<color name="window_background">([^<]*)</.exec(
      readFileSync(res(`${folder}/colors.xml`), 'utf8'),
    )![1];

  beforeEach(() => {
    cpSync(path.join(TEMPLATES_DIR, 'android'), dir, { recursive: true });
  });

  it('keeps the launcher icon and the default colors without a splash', () => {
    writeAndroidSplash(dir, app({}), dir);
    expect(readFileSync(res('values/splash.xml'), 'utf8')).toContain(
      '<drawable name="splash_icon">@mipmap/ic_launcher</drawable>',
    );
    expect(windowBackground('values')).toBe('#FFFFFFFF');
    expect(windowBackground('values-night')).toBe('#FF000000');
  });

  it('sets the window color, dark mode taking the light one it leaves out', () => {
    writeAndroidSplash(dir, app({ backgroundColor: '#FAFAFA' }), dir);
    expect(windowBackground('values')).toBe('#FAFAFA');
    expect(windowBackground('values-night')).toBe('#FAFAFA');

    writeAndroidSplash(
      dir,
      app({ backgroundColor: '#fff', dark: { backgroundColor: '#09090B' } }),
      dir,
    );
    expect(windowBackground('values')).toBe('#fff');
    expect(windowBackground('values-night')).toBe('#09090B');
  });

  it('fails on a colors.xml without the window color', () => {
    writeFileSync(res('values/colors.xml'), '<resources />');
    expect(() =>
      writeAndroidSplash(dir, app({ backgroundColor: '#000' }), dir),
    ).toThrow('has no window_background color');
  });

  it('draws the image on a 288 dp canvas at each density, in place of the launcher icon', () => {
    writeImage('logo.png', 300, 300);
    writeAndroidSplash(dir, app({ image: 'logo.png', imageWidth: 100 }), dir);
    expect(existsSync(res('values/splash.xml'))).toBe(false);

    for (const [density, scale] of [
      ['mdpi', 1],
      ['xxhdpi', 3],
    ] as const) {
      const canvas = readImage(
        path.join('app/src/main/res', `drawable-${density}/splash_icon.png`),
      );
      expect([canvas.width, canvas.height]).toEqual([288 * scale, 288 * scale]);
      // The image is 100 dp square in the middle: (144 - 50) dp to (144 + 50).
      const left = 94 * scale;
      const middle = 144 * scale;
      expect(alphaAt(canvas, left - 1, middle)).toBe(0);
      expect(alphaAt(canvas, left, middle)).toBe(255);
      expect(alphaAt(canvas, middle + 10 * scale, middle)).toBe(0);
    }
    expect(existsSync(res('drawable-night-mdpi'))).toBe(false);
  });

  it('shrinks a wide image to the circle Android shows, and gives dark mode its own', () => {
    writeImage('logo-wide.png', 800, 200);
    writeImage('logo-wide-dark.png', 800, 200);
    writeAndroidSplash(
      dir,
      app({
        image: 'logo-wide.png',
        imageWidth: 400,
        dark: { image: 'logo-wide-dark.png' },
      }),
      dir,
    );
    const canvas = readImage(
      path.join('app/src/main/res', 'drawable-mdpi/splash_icon.png'),
    );
    const drawn = androidSplashSize({ width: 400, height: 100 });
    const left = Math.floor((288 - Math.round(drawn.width)) / 2);
    expect(alphaAt(canvas, left - 1, 144)).toBe(0);
    expect(alphaAt(canvas, left, 144)).toBe(255);
    expect(
      readImage(
        path.join('app/src/main/res', 'drawable-night-xxxhdpi/splash_icon.png'),
      ).width,
    ).toBe(288 * 4);
  });
});
