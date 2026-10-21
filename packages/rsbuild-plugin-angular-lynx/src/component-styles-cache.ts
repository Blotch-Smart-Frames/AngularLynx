import path from 'node:path';
import type { ComponentStyleSize } from './utils/angular/budgets.js';

/**
 * The key a stylesheet's size is recorded under in `componentStyleSizes`:
 * per component, since two components sharing a stylesheet each ship it.
 */
const componentStyleSizeKey = (
  containingFile: string,
  stylesheetKey: string,
): string => `${containingFile}#${stylesheetKey}`;

/**
 * Drops the recorded stylesheet sizes of a component whose file was deleted,
 * so `anyComponentStyle` budgets stop reporting styles that no longer ship.
 */
export const forgetComponentStyleSizes = (
  componentStyleSizes: Map<string, ComponentStyleSize>,
  containingFile: string,
): void => {
  const prefix = componentStyleSizeKey(containingFile, '');
  for (const key of componentStyleSizes.keys()) {
    if (key.startsWith(prefix)) {
      componentStyleSizes.delete(key);
    }
  }
};

/**
 * Builds the `transformStylesheet` callback that Angular's AOT compiler invokes
 * for every component stylesheet (inline `styles: []` and external `styleUrls`).
 *
 * It returns the CSS unchanged, so the compiler embeds it in the component's
 * definition and scopes it for the component's `encapsulation`, as on the web.
 * extractComponentStyles() (component-styles.ts) then lifts it back out of the
 * compiled code as Lynx CSS. The callback only records each stylesheet's size,
 * for `anyComponentStyle` budgets.
 */
export const createTransformStylesheet = (params: {
  basePath: string;
  /**
   * The compiled size of every component stylesheet, for `anyComponentStyle`
   * budgets. Overwritten each time Angular compiles a stylesheet, so watch
   * rebuilds check the current sizes.
   */
  componentStyleSizes?: Map<string, ComponentStyleSize>;
}): ((
  data: string,
  containingFile: string,
  stylesheetFile: string | undefined,
  order: number,
  className: string | undefined,
) => Promise<string>) => {
  const { basePath, componentStyleSizes } = params;

  return async (data, containingFile, stylesheetFile, order, className) => {
    const key = componentStyleSizeKey(
      containingFile,
      stylesheetFile ?? `__inline_${order}`,
    );
    // Angular's AOT compiler may invoke this callback more than once for the
    // same stylesheet: once without a class name, and once with it. The first
    // size recorded with the class name wins over a later call without one.
    if (componentStyleSizes && (className || !componentStyleSizes.has(key))) {
      componentStyleSizes.set(key, {
        // Angular labels a component style budget failure with the stylesheet;
        // inline styles have none, so they're labeled with their component.
        label: path
          .relative(basePath, stylesheetFile ?? containingFile)
          .replace(/\\/g, '/'),
        size: Buffer.byteLength(data),
      });
    }
    return data;
  };
};
