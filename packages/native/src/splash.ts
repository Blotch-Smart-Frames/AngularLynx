import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { DENSITIES } from './android/icon.ts';
import type { Platform } from './generate.ts';
import type { ResolvedApp, ResolvedSplash } from './options.ts';
import {
  centerOnCanvas,
  decodePng,
  encodePng,
  type Image,
  readPngSize,
  resize,
} from './png.ts';

/**
 * Android's splash icon, without an icon background, is a 288 dp square...
 */
export const ANDROID_SLOT_DP = 288;
/**
 * ...of which it shows the middle: a circle 192 dp across, two thirds of it.
 * Anything outside the circle is cut off.
 */
export const ANDROID_CIRCLE_DP = 192;
/** The scales iPhones draw at: 1× is no longer made, but the simulator has it. */
const IOS_SCALES = [1, 2, 3] as const;

/** Where the shells find the launch image, by name. */
export const IOS_IMAGE_SET = 'LaunchImage';
const ANDROID_ICON = 'splash_icon';
/**
 * The template's alias of the splash icon to the launcher icon, which an app
 * with a splash image replaces with its own drawable of the same name.
 */
const ANDROID_ICON_ALIAS = 'app/src/main/res/values/splash.xml';

type Size = { readonly width: number; readonly height: number };

/**
 * The image's size on screen in points (dp on Android): `imageWidth` across,
 * and as tall as its shape makes that.
 */
export const splashImageSize = (pixels: Size, imageWidth: number): Size => ({
  width: imageWidth,
  height: (imageWidth * pixels.height) / pixels.width,
});

/**
 * The size Android draws the image at: as on iOS, unless its corners reach
 * past the circle Android shows, when it's scaled down until they touch it.
 * A wide logo is then smaller than on iOS, but whole.
 */
export const androidSplashSize = (size: Size): Size => {
  const scale = Math.min(
    1,
    ANDROID_CIRCLE_DP / Math.hypot(size.width, size.height),
  );
  return { width: size.width * scale, height: size.height * scale };
};

/**
 * The splash images, each once: light, then dark if it's another file.
 */
const splashImages = (
  splash: ResolvedSplash,
): readonly { readonly option: string; readonly file: string }[] => [
  ...(splash.light.image
    ? [{ option: 'splash.image', file: splash.light.image }]
    : []),
  ...(splash.dark.image && splash.dark.image !== splash.light.image
    ? [{ option: 'splash.dark.image', file: splash.dark.image }]
    : []),
];

/**
 * What's worth knowing about how the splash images will look, checked on
 * every build (unlike the project, which is generated only when its inputs
 * change): an image too wide for Android's circle, or with too few pixels to
 * be sharp. A missing image is left to generation, which fails on it.
 */
export const splashWarnings = (
  app: ResolvedApp,
  projectRoot: string,
  platform: Platform,
): readonly string[] => {
  const { imageWidth } = app.splash;
  if (imageWidth === undefined) return [];
  const warnings: string[] = [];
  for (const { option, file } of splashImages(app.splash)) {
    const absolute = path.resolve(projectRoot, file);
    if (!existsSync(absolute)) continue;
    const pixels = readPngSize(absolute);
    const size = splashImageSize(pixels, imageWidth);
    const needed = Math.ceil(imageWidth * 3);
    if (pixels.width < needed) {
      warnings.push(
        `${option} is ${pixels.width} px wide: at ${imageWidth} points, a 3× screen needs ${needed} px for it to be sharp.`,
      );
    }
    const drawn = androidSplashSize(size);
    if (platform === 'android' && drawn.width < size.width) {
      // The widest image of this shape that fits the circle whole.
      const widest = Math.floor(
        (ANDROID_CIRCLE_DP * pixels.width) /
          Math.hypot(pixels.width, pixels.height),
      );
      warnings.push(
        `${option} at ${imageWidth} dp wide doesn't fit in the circle ${ANDROID_CIRCLE_DP} dp across that Android shows of a splash screen's image, so Android draws it ${Math.floor(drawn.width)} dp wide. With an imageWidth of ${widest} or less, it's the same size on iOS and Android.`,
      );
    }
  }
  return warnings;
};

/**
 * Reads a splash image, whose shape and size are free (unlike the icon's),
 * so only its being there is checked.
 */
const loadImage = (
  projectRoot: string,
  option: string,
  file: string,
): Image => {
  const absolute = path.resolve(projectRoot, file);
  if (!existsSync(absolute)) {
    throw new Error(`${option}: ${file} doesn't exist.`);
  }
  // Fails with "is not a PNG file" before pngjs gets a JPEG renamed .png.
  readPngSize(absolute);
  return decodePng(readFileSync(absolute));
};

/**
 * `#RGB` or `#RRGGBB` as its three channels, 0 to 255.
 */
const channels = (color: string): readonly [number, number, number] => {
  const hex =
    color.length === 4 ? color.slice(1).replace(/./g, '$&$&') : color.slice(1);
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
};

const DARK_APPEARANCE = [{ appearance: 'luminosity', value: 'dark' }];
const ASSET_INFO = { author: 'xcode', version: 1 };

/**
 * The `LaunchBackground` color set: the launch screen's color, which the
 * shell also paints behind the LynxView. Only its dark entry varies with dark
 * mode: an entry without an appearance is the color for any.
 */
export const launchBackgroundColorSet = (splash: ResolvedSplash): string => {
  const color = (value: string) => {
    const [red, green, blue] = channels(value);
    return {
      'color-space': 'srgb',
      components: {
        alpha: '1.000',
        blue: (blue / 255).toFixed(3),
        green: (green / 255).toFixed(3),
        red: (red / 255).toFixed(3),
      },
    };
  };
  // The template's white, when only dark mode has a color.
  const light = splash.light.backgroundColor ?? '#FFFFFF';
  const dark = splash.dark.backgroundColor;
  return `${JSON.stringify(
    {
      colors: [
        { color: color(light), idiom: 'universal' },
        ...(dark && dark !== light
          ? [
              {
                appearances: DARK_APPEARANCE,
                color: color(dark),
                idiom: 'universal',
              },
            ]
          : []),
      ],
      info: ASSET_INFO,
    },
    null,
    2,
  )}\n`;
};

/** The image set's Contents.json, for the files {@link writeIosSplash} writes. */
export const launchImageSet = (hasDark: boolean): string =>
  `${JSON.stringify(
    {
      images: [
        ...IOS_SCALES.map((scale) => ({
          filename: `${IOS_IMAGE_SET}${scale === 1 ? '' : `@${scale}x`}.png`,
          idiom: 'universal',
          scale: `${scale}x`,
        })),
        ...(hasDark
          ? IOS_SCALES.map((scale) => ({
              appearances: DARK_APPEARANCE,
              filename: `${IOS_IMAGE_SET}-dark${scale === 1 ? '' : `@${scale}x`}.png`,
              idiom: 'universal',
              scale: `${scale}x`,
            }))
          : []),
      ],
      info: ASSET_INFO,
    },
    null,
    2,
  )}\n`;

/**
 * Writes the splash into the iOS project's asset catalog: the
 * `LaunchBackground` color set, and the `LaunchImage` image set at 1×, 2× and
 * 3× (and again for dark mode). Info.plist's UILaunchScreen names them (see
 * `infoPlistEntries`), and the shell's SplashScreen.swift draws the same two
 * over the app until the app hides it.
 *
 * Each scale is made here: a launch screen draws its image at its natural
 * size, which is its pixels over its scale, so each copy is `imageWidth`
 * points across.
 */
export const writeIosSplash = (
  dir: string,
  app: ResolvedApp,
  projectRoot: string,
): void => {
  const { splash } = app;
  const assets = path.join(dir, 'App/Assets.xcassets');
  if (splash.light.backgroundColor || splash.dark.backgroundColor) {
    writeFileSync(
      path.join(assets, 'LaunchBackground.colorset/Contents.json'),
      launchBackgroundColorSet(splash),
    );
  }
  if (!splash.light.image || splash.imageWidth === undefined) return;

  const set = path.join(assets, `${IOS_IMAGE_SET}.imageset`);
  mkdirSync(set, { recursive: true });
  const images = splashImages(splash);
  for (const [index, { option, file }] of images.entries()) {
    const image = loadImage(projectRoot, option, file);
    const size = splashImageSize(image, splash.imageWidth);
    for (const scale of IOS_SCALES) {
      const name = `${IOS_IMAGE_SET}${index === 0 ? '' : '-dark'}${scale === 1 ? '' : `@${scale}x`}.png`;
      writeFileSync(
        path.join(set, name),
        encodePng(
          resize(
            image,
            Math.max(1, Math.round(size.width * scale)),
            Math.max(1, Math.round(size.height * scale)),
          ),
        ),
      );
    }
  }
  writeFileSync(
    path.join(set, 'Contents.json'),
    launchImageSet(images.length > 1),
  );
};

/**
 * Sets the template's `window_background` color, the splash screen's color
 * and the window's behind the LynxView, in one of its colors.xml files.
 */
const setWindowBackground = (file: string, color: string): void => {
  const source = readFileSync(file, 'utf8');
  const updated = source.replace(
    /(<color name="window_background">)[^<]*(<\/color>)/,
    `$1${color}$2`,
  );
  if (updated === source && !source.includes(`>${color}<`)) {
    throw new Error(`${file} has no window_background color.`);
  }
  writeFileSync(file, updated);
};

/**
 * Writes the splash into the Android project's resources: its colors as
 * `window_background` (light in `values/`, dark in `values-night/`), which
 * the splash theme and the window behind the LynxView both use, and its
 * image as the `splash_icon` drawable the theme shows.
 *
 * Android shows a splash image in a 288 dp square, cut to the circle 192 dp
 * across in its middle, and scales whatever drawable it's given to the
 * square. So the image is drawn on a transparent 288 dp canvas, at
 * `imageWidth` dp, or smaller if its corners would be cut off, and the canvas
 * made at each density, as the icons are.
 */
export const writeAndroidSplash = (
  dir: string,
  app: ResolvedApp,
  projectRoot: string,
): void => {
  const { splash } = app;
  const res = path.join(dir, 'app/src/main/res');
  if (splash.light.backgroundColor) {
    setWindowBackground(
      path.join(res, 'values/colors.xml'),
      splash.light.backgroundColor,
    );
  }
  if (splash.dark.backgroundColor) {
    setWindowBackground(
      path.join(res, 'values-night/colors.xml'),
      splash.dark.backgroundColor,
    );
  }
  if (!splash.light.image || splash.imageWidth === undefined) return;

  rmSync(path.join(dir, ANDROID_ICON_ALIAS), { force: true });
  for (const [index, { option, file }] of splashImages(splash).entries()) {
    const image = loadImage(projectRoot, option, file);
    const drawn = androidSplashSize(splashImageSize(image, splash.imageWidth));
    for (const [density, scale] of Object.entries(DENSITIES)) {
      const folder = path.join(
        res,
        `drawable-${index === 0 ? '' : 'night-'}${density}`,
      );
      mkdirSync(folder, { recursive: true });
      const canvas = Math.round(ANDROID_SLOT_DP * scale);
      writeFileSync(
        path.join(folder, `${ANDROID_ICON}.png`),
        encodePng(
          centerOnCanvas(
            resize(
              image,
              Math.min(canvas, Math.max(1, Math.round(drawn.width * scale))),
              Math.min(canvas, Math.max(1, Math.round(drawn.height * scale))),
            ),
            canvas,
            canvas,
          ),
        ),
      );
    }
  }
};
