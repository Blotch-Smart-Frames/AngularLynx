/**
 * Returns true for Angular template diagnostic messages that are expected noise
 * for Lynx native elements and should not be shown to the user:
 *
 * - "is not a known element" — suppressed by sourceFileCache schema injection but may
 *   still appear for files not in the tsconfig file list
 * - "isn't a known property of" — Lynx element stubs don't declare @Input() for every
 *   platform-specific attribute (src, item-key, scroll-orientation, etc.) so Angular
 *   reports these as unknown property bindings on the stub components; the renderer
 *   handles them at runtime via setAttribute
 */
export const isLynxUnknownElementMessage = (
  text: string | undefined,
): boolean =>
  (text?.includes('is not a known element') ||
    text?.includes("isn't a known property of")) ??
  false;
