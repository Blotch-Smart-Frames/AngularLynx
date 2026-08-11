import { createHash } from 'node:crypto';

/**
 * Generates a deterministic CSS scope ID for ViewEncapsulation.Emulated.
 * Uses className + file path to ensure uniqueness — two components with the
 * same class name in different files get different IDs. The 'l' prefix
 * (for "Lynx") differentiates these from Angular's default 'ng' prefix IDs,
 * preventing collisions if browser-Angular scope IDs leak into shared code.
 * This ID appears in:
 *   - CSS filenames: `...__scoped_l<hash>.css`
 *   - ɵcmp.id: patched at the end of angular.ts transform
 *   - _nghost-l<hash> class: added by EmulatedLynxRenderer.selectRootElement()
 */
export const generateComponentScopeId = (
  className: string,
  containingFile: string,
): string => {
  const hash = createHash('sha256')
    .update(`${className}|${containingFile}`)
    .digest('hex')
    .slice(0, 10);
  return `l${hash}`;
};
