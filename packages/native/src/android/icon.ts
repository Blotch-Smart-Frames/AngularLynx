import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { ICON_BACKGROUND_COLOR, type ResolvedApp } from '../options.ts';
import {
  decodePng,
  encodePng,
  extendEdges,
  type Image,
  maskCircle,
  readPngSize,
  resize,
} from '../png.ts';

const RES = 'app/src/main/res';

/** Each density's scale from dp to px, as Android names its folders. */
export const DENSITIES: Readonly<Record<string, number>> = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

/** A flat launcher icon is 48 dp square. */
const LEGACY_DP = 48;
/** An adaptive icon layer is 108 dp square... */
const LAYER_DP = 108;
/**
 * ...of which the launcher shows the middle 72 dp at most, masked to its
 * shape, and moves the layer by up to 18 dp around it.
 */
const VISIBLE_DP = 72;

/**
 * The template's vector placeholder (Angular's red shield), which an app with
 * an icon replaces.
 */
const PLACEHOLDERS = [
  'mipmap/ic_launcher.xml',
  'mipmap/ic_launcher_round.xml',
  'drawable/ic_launcher_background.xml',
  'drawable/ic_launcher_foreground.xml',
];

/**
 * Writes the app's launcher icon into the project's resources, from the
 * `icon` option (and `android.adaptiveIcon`'s layers):
 *
 * - `mipmap-<density>/ic_launcher.png` and `ic_launcher_round.png`, the flat
 *   icons Android 7 shows, square and round;
 * - `mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`, the
 *   adaptive icon Android 8 and later show, with its layers as
 *   `mipmap-<density>/ic_launcher_foreground.png` and
 *   `ic_launcher_background.png`, or a color in `values/`.
 *
 * Every size is made here rather than left to Android to scale one big PNG:
 * launchers scale bitmaps with a cheap filter, and a 1024 px image shrunk to
 * 48 px that way comes out jagged.
 */
export const writeAndroidIcon = (
  dir: string,
  app: ResolvedApp,
  projectRoot: string,
): void => {
  if (!app.icon) {
    return;
  }
  const res = path.join(dir, RES);
  for (const placeholder of PLACEHOLDERS) {
    rmSync(path.join(res, placeholder), { force: true });
  }

  const icon = loadIcon(projectRoot, app.icon, 'icon');
  // resolveAppOptions has checked an adaptiveIcon has both layers.
  const adaptive = app.android.adaptiveIcon;
  const foreground = adaptive?.foreground
    ? loadIcon(
        projectRoot,
        adaptive.foreground,
        'android.adaptiveIcon.foreground',
      )
    : undefined;
  const backgroundColor =
    adaptive?.background && ICON_BACKGROUND_COLOR.test(adaptive.background)
      ? adaptive.background
      : undefined;
  const backgroundImage =
    adaptive?.background && !backgroundColor
      ? loadIcon(
          projectRoot,
          adaptive.background,
          'android.adaptiveIcon.background',
        )
      : undefined;

  for (const [density, scale] of Object.entries(DENSITIES)) {
    const folder = path.join(res, `mipmap-${density}`);
    mkdirSync(folder, { recursive: true });
    const legacy = resize(icon, LEGACY_DP * scale, LEGACY_DP * scale);
    writeFileSync(path.join(folder, 'ic_launcher.png'), encodePng(legacy));
    writeFileSync(
      path.join(folder, 'ic_launcher_round.png'),
      encodePng(maskCircle(legacy)),
    );

    const layer = LAYER_DP * scale;
    if (foreground) {
      writeFileSync(
        path.join(folder, 'ic_launcher_foreground.png'),
        encodePng(resize(foreground, layer, layer)),
      );
    }
    if (!adaptive) {
      // The default adaptive icon: the whole icon fills the 72 dp the mask
      // shows, so a square icon designed for iOS loses only its corners (as
      // it does there), and its edges continue into the margin the layer
      // moves in. Scaling it to the full 108 dp would crop a third of it.
      const visible = VISIBLE_DP * scale;
      writeFileSync(
        path.join(folder, 'ic_launcher_background.png'),
        encodePng(
          extendEdges(resize(icon, visible, visible), (layer - visible) / 2),
        ),
      );
    } else if (backgroundImage) {
      writeFileSync(
        path.join(folder, 'ic_launcher_background.png'),
        encodePng(resize(backgroundImage, layer, layer)),
      );
    }
  }

  if (backgroundColor) {
    writeFileSync(
      path.join(res, 'values/ic_launcher_background.xml'),
      backgroundColorResource(backgroundColor),
    );
  }
  const xml = adaptiveIconXml({
    foreground: !!foreground,
    background: backgroundColor ? 'color' : 'image',
  });
  mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
  writeFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), xml);
  writeFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher_round.xml'), xml);
};

/**
 * The adaptive icon both `android:icon` and `android:roundIcon` point at:
 * the launcher masks it to whatever shape it uses, round included.
 */
export const adaptiveIconXml = ({
  foreground,
  background,
}: {
  readonly foreground: boolean;
  readonly background: 'color' | 'image';
}): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Written by @blotch/angular-lynx-native from angular.json's icon options. -->",
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    background === 'color'
      ? '    <background android:drawable="@color/ic_launcher_background" />'
      : '    <background android:drawable="@mipmap/ic_launcher_background" />',
    // A layer can't be left out, so the default icon, all background, has
    // a transparent foreground.
    foreground
      ? '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />'
      : '    <foreground android:drawable="@android:color/transparent" />',
    '</adaptive-icon>',
    '',
  ].join('\n');

export const backgroundColorResource = (color: string): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    `    <color name="ic_launcher_background">${color}</color>`,
    '</resources>',
    '',
  ].join('\n');

/**
 * Reads one of the icon options' PNGs, checking it's the 1024×1024 the
 * docs ask for, so a wrong file fails here with the option's name rather
 * than as a blurry or misplaced icon.
 */
const loadIcon = (projectRoot: string, file: string, option: string): Image => {
  const absolute = path.resolve(projectRoot, file);
  if (!existsSync(absolute)) {
    throw new Error(`${option}: ${file} doesn't exist.`);
  }
  const size = readPngSize(absolute);
  if (size.width !== 1024 || size.height !== 1024) {
    throw new Error(
      `${file} is ${size.width}×${size.height}. ${option} must be a 1024×1024 PNG.`,
    );
  }
  return decodePng(readFileSync(absolute));
};
