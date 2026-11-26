import type { Rule, Tree } from '@angular-devkit/schematics';
import { getWorkspace } from '@schematics/angular/utility/workspace';

import { LYNX_TAILWIND_IMPORT } from '../../utility/tailwind';

/**
 * An `@import` of Tailwind 4: the one `ng add` writes
 * (`tailwindcss/utilities.css`) or Angular CLI's (`tailwindcss`), through the
 * `;` that ends it, which can be on a later line than the URL.
 */
const TAILWIND_IMPORT =
  /^\s*@import\s+(['"])tailwindcss(?:\/utilities\.css)?\1[^;]*;/gm;

/**
 * Imports @blotch/angular-lynx/tailwind.css, Lynx's own utilities and
 * variants (`linear`, `ui-open:`), after Tailwind in a Tailwind 4 app's
 * stylesheets. `ng add` and `add-tailwind` now write it; apps made before had
 * none of what @lynx-js/tailwind-preset adds on Tailwind 3, so those classes
 * matched nothing. A Tailwind 3 app (`@tailwind utilities;`) is left alone:
 * it has the preset.
 */
export default (): Rule => async (tree: Tree) => {
  const workspace = await getWorkspace(tree);
  const stylesheets = new Set<string>();
  for (const project of workspace.projects.values()) {
    const sourceRoot = project.sourceRoot ?? `${project.root || '.'}/src`;
    // Where `ng add` writes the import: styles.css, or tailwind.css beside a
    // styles.scss. Then whatever else the build lists.
    stylesheets.add(`${sourceRoot}/styles.css`);
    stylesheets.add(`${sourceRoot}/tailwind.css`);
    // A configuration's `styles` replaces the options' (production may list
    // a stylesheet of its own), so read them all.
    const build = project.targets.get('build');
    const styles = [
      build?.options,
      ...Object.values(build?.configurations ?? {}),
    ]
      .map((options) => options?.['styles'])
      .flatMap((list) => (Array.isArray(list) ? list : []));
    for (const entry of styles) {
      const input =
        typeof entry === 'string'
          ? entry
          : (entry as { input?: unknown } | null)?.input;
      if (typeof input === 'string' && input.endsWith('.css')) {
        stylesheets.add(input);
      }
    }
  }
  for (const file of stylesheets) {
    const path = file.replace(/^\.\//, '');
    if (!tree.exists(path)) continue;
    const text = tree.readText(path);
    if (text.includes('@blotch/angular-lynx/tailwind.css')) continue;
    const imports = [...text.matchAll(TAILWIND_IMPORT)];
    const last = imports[imports.length - 1];
    if (!last) continue;
    // After Tailwind's last import, so its rules come before the variants
    // that compound with them, and before any other rule, after which CSS
    // ignores an @import.
    const end = last.index + last[0].length;
    tree.overwrite(
      path,
      `${text.slice(0, end)}\n${LYNX_TAILWIND_IMPORT}${text.slice(end)}`,
    );
  }
};
