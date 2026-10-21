import { createHash } from 'node:crypto';

/**
 * Generates a deterministic CSS scope ID for ViewEncapsulation.Emulated.
 * Uses className + file path to ensure uniqueness — two components with the
 * same class name in different files get different IDs. The 'l' prefix
 * (for "Lynx") differentiates these from Angular's default 'ng' prefix IDs,
 * preventing collisions if browser-Angular scope IDs leak into shared code.
 * This ID appears in:
 *   - the component's compiled CSS: `.title._ngcontent-l<hash>`,
 *     `._nghost-l<hash>` (see component-styles.ts)
 *   - ɵcmp.id: set by the loader (see transform-module.ts)
 *   - the `_ngcontent-l<hash>` and `_nghost-l<hash>` classes that
 *     EmulatedLynxRenderer adds to the component's elements
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
