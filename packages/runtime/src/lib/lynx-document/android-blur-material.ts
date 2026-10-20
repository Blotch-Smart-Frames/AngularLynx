import { isAndroid } from './android-blur-capture';

/**
 * The CSS variables that the build plugin's `blur-view` rule reads (its
 * `blur-view.css`, which only the native bundle gets):
 *
 *     blur-view {
 *       background-color: var(--angular-lynx-blur-background, transparent);
 *       background-image: var(--angular-lynx-blur-background-image, none);
 *       box-shadow: var(--angular-lynx-blur-box-shadow, none);
 *     }
 *
 * Lynx implements `blur-effect` and the `glass-*` attributes on iOS only, so
 * on Android every blur-view is a plain Gaussian blur. Android's BlurView draws
 * the blurred backdrop first and then the view's own background and children,
 * so a translucent background on top approximates iOS's materials, as the web
 * build does in glass-host-style.ts.
 *
 * The runtime can't set that background inline: an inline style beats the
 * app's classes (`bg-white/30`), and the runtime can't tell which classes set
 * one. So it sets only these variables inline, and the rule above uses them.
 * A type selector loses to any class, id or inline style the app sets, so the
 * app's own background or shadow still wins.
 *
 * Every Android blur-view sets all three variables, `transparent` and `none`
 * when it has no material. CSS variables inherit, so a blur-view inside a `dark`
 * panel would otherwise take the panel's tint.
 */
export const BLUR_BACKGROUND_VARIABLE = '--angular-lynx-blur-background';
export const BLUR_BACKGROUND_IMAGE_VARIABLE =
  '--angular-lynx-blur-background-image';
export const BLUR_BOX_SHADOW_VARIABLE = '--angular-lynx-blur-box-shadow';

/** The attributes the approximation depends on. */
export const BLUR_MATERIAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'blur-effect',
  'blur-radius',
  'glass-style',
  'glass-tint-color',
]);

/**
 * The tint each material puts over the blur. Fitted to the iOS Simulator's
 * pixels in the element-blur-view example: `extra-light` washes the backdrop
 * with white and `dark` with black, the same values as on web. iOS's `light`
 * brightens and saturates the backdrop. Web does that with `brightness()`,
 * which Android's blur-view can't apply to the backdrop, so here a white
 * gives it the same lightness, though paler.
 */
const MATERIAL_BACKGROUNDS: Readonly<Record<string, string>> = {
  light: 'rgba(255, 255, 255, 0.3)',
  'extra-light': 'rgba(255, 255, 255, 0.75)',
  dark: 'rgba(0, 0, 0, 0.6)',
};

/**
 * A glass shape's frosted look: a white sheen with `glass-tint-color` over
 * it, and a rim, like iOS's glass without the refraction. iOS lightens what's
 * behind the glass before it tints it, so the tint goes on the sheen, as a
 * background image, rather than replacing it. `clear` glass is barely
 * lightened. Fitted to the same example as the materials.
 *
 * The rim is a bright top edge and a faint dark outline, which is what keeps
 * iOS's glass visible over white. Inset shadows draw it without changing the
 * layout, as a border would.
 */
const GLASS_SHEEN = 'rgba(255, 255, 255, 0.3)';
const CLEAR_GLASS_SHEEN = 'rgba(255, 255, 255, 0.1)';
const GLASS_RIM =
  'inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(0, 0, 0, 0.12)';

/**
 * Whether blur-views get the approximation: only on Android's native
 * renderer. iOS draws the real materials, and web has its own (see web-glass).
 */
export const usesAndroidBlurMaterials = (): boolean => !__WEB__ && isAndroid();

const declarations = (
  background: string,
  { image = 'none', boxShadow = 'none' } = {},
): string =>
  `${BLUR_BACKGROUND_VARIABLE}: ${background}; ` +
  `${BLUR_BACKGROUND_IMAGE_VARIABLE}: ${image}; ` +
  `${BLUR_BOX_SHADOW_VARIABLE}: ${boxShadow}`;

/**
 * The inline declarations that give a blur-view with `attrs` its material on
 * Android. Like on iOS, a material needs a blur radius, while glass doesn't,
 * and a `glass-container` draws nothing of its own.
 */
export const androidBlurMaterialStyle = (
  attrs: ReadonlyMap<string, unknown>,
): string => {
  const effect = attrs.get('blur-effect') ?? 'light';
  if (effect === 'glass') {
    const tint = attrs.get('glass-tint-color');
    return declarations(
      attrs.get('glass-style') === 'clear' ? CLEAR_GLASS_SHEEN : GLASS_SHEEN,
      {
        // A one-color gradient is how CSS layers a color over a background
        // color.
        image:
          typeof tint === 'string' && tint !== '' && tint !== 'transparent'
            ? `linear-gradient(${tint}, ${tint})`
            : 'none',
        boxShadow: GLASS_RIM,
      },
    );
  }
  if (
    effect === 'glass-container' ||
    !parseFloat(String(attrs.get('blur-radius') ?? ''))
  ) {
    return declarations('transparent');
  }
  // iOS falls back to `light` for an effect it doesn't know.
  return declarations(
    MATERIAL_BACKGROUNDS[String(effect)] ?? MATERIAL_BACKGROUNDS['light'],
  );
};
