/**
 * Default gesture config values, mirrored from Lynx's own gesture-runtime
 * (references/lynx-stack-main/packages/lynx/gesture-runtime/src/utils/const.ts).
 *
 * Why these defaults live in the JS gesture classes instead of relying on the
 * native handlers' own defaults: the iOS handlers read each config key with
 * `[[config objectForKey:@"maxDuration"] floatValue]`, and `[nil floatValue]`
 * is `0`. Those built-in defaults (`maxDistance = 10`, etc.) are only applied
 * when the WHOLE config is absent (`handleConfigMap` early-returns on a nil
 * map). The moment ANY config key is present, every *missing* key reads back as
 * `0` — so sending a partial config like `{ numberOfTaps: 2 }` silently zeroes
 * `maxDuration`/`maxDistance` and the tap fails on a 0ms timer the instant a
 * finger touches down. Initializing the full default set on every gesture
 * guarantees a complete config is always sent. See LynxTapGestureHandler.m /
 * LynxLongPressGestureHandler.m `handleConfigMap`.
 */

/** Max finger travel (px) before a tap/long-press is rejected as a drag. */
export const DEFAULT_GESTURE_MAX_DISTANCE = 10;

/** Max time (ms) between finger-down and finger-up for a tap to register. */
export const DEFAULT_TAP_MAX_DURATION = 500;

/** Min hold time (ms) before a long-press is recognized. */
export const DEFAULT_LONG_PRESS_DURATION = 500;

/** Min finger travel (px) before a pan activates (0 = activates immediately). */
export const DEFAULT_PAN_MIN_DISTANCE = 0;
