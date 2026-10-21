import type { DirEntry, Rule, Tree } from '@angular-devkit/schematics';
import { getWorkspace } from '@schematics/angular/utility/workspace';

/**
 * The singular name, as an attribute, a binding (`[accessibility-trait]`,
 * `[attr.accessibility-trait]`) or a string, but not part of a longer name
 * such as `accessibility-traits`.
 */
const SINGULAR = /(?<![\w-])accessibility-trait(?![\w-])/g;

/** Folders that hold no source of the app's own. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);

/**
 * Calls `visit` with the path of every template and TypeScript file under
 * `dir`, skipping dependencies, build output and dot folders.
 */
const visitSources = (dir: DirEntry, visit: (path: string) => void): void => {
  for (const file of dir.subfiles) {
    if (/\.(html|ts)$/.test(file) && !file.endsWith('.d.ts')) {
      visit(dir.file(file)!.path);
    }
  }
  for (const sub of dir.subdirs) {
    if (!SKIPPED_DIRS.has(sub) && !sub.startsWith('.')) {
      visitSources(dir.dir(sub), visit);
    }
  }
};

/**
 * Renames `accessibility-trait` to `accessibility-traits` in the app's
 * templates.
 *
 * `LYNX_ELEMENTS` declared the input in the singular, but iOS, Android and
 * Harmony read only the plural, so the attribute did nothing. Now the input
 * is `accessibility-traits`, and a `[accessibility-trait]` binding no longer
 * compiles. This renames both the bindings and the static attributes, in
 * `.html` templates and in the `.ts` files that hold inline ones.
 */
export default (): Rule => async (tree: Tree) => {
  const workspace = await getWorkspace(tree);
  const roots = new Set([
    '',
    ...[...workspace.projects.values()].map((project) => project.root),
  ]);
  // The workspace root takes in the projects under it, so a file can come up
  // from more than one root.
  const files = new Set<string>();
  for (const root of roots) {
    visitSources(tree.getDir(root), (path) => files.add(path));
  }
  for (const file of files) {
    const text = tree.readText(file);
    const updated = text.replace(SINGULAR, 'accessibility-traits');
    if (updated !== text) tree.overwrite(file, updated);
  }
};
