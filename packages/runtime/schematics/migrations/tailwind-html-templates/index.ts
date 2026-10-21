import type { Rule, Tree } from '@angular-devkit/schematics';
import { getWorkspace } from '@schematics/angular/utility/workspace';

/** The Tailwind config files the build looks for. */
const CONFIG_FILES = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
];

/**
 * The `content` glob that `ng add` and `add-tailwind` wrote, in either quote.
 */
const TS_ONLY_GLOB = /(['"])\.\/src\/\*\*\/\*\.ts\1/g;

/**
 * Adds `.html` templates to the Tailwind `content` glob the schematics wrote.
 *
 * The build used to scan the modules it bundled instead of `content`, so the
 * glob didn't matter, and classes used only in `.html` templates got no CSS.
 * Now the build runs Tailwind with `content`, as Angular's own Tailwind setup
 * does, and the schematics write `./src/**\/*.{html,ts}`. This brings the
 * glob of an app made before up to date. A glob the app changed is left
 * alone.
 */
export default (): Rule => async (tree: Tree) => {
  const workspace = await getWorkspace(tree);
  // The schematics write the config at the project root, which is the
  // workspace root for an app made by `ng new`.
  const roots = new Set([
    '',
    ...[...workspace.projects.values()].map((project) => project.root),
  ]);
  for (const root of roots) {
    for (const name of CONFIG_FILES) {
      const file = root ? `${root}/${name}` : name;
      if (!tree.exists(file)) continue;
      const text = tree.readText(file);
      const updated = text.replace(
        TS_ONLY_GLOB,
        (_glob, quote: string) => `${quote}./src/**/*.{html,ts}${quote}`,
      );
      if (updated !== text) tree.overwrite(file, updated);
    }
  }
};
