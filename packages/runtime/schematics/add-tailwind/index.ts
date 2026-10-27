import {
  type Rule,
  type Tree,
  SchematicsException,
} from '@angular-devkit/schematics';
import { getWorkspace } from '@schematics/angular/utility/workspace';

import { setUpTailwind, tailwindVersionFor } from '../utility/tailwind';
import type { Schema } from './schema';

/**
 * Adds Tailwind CSS to an existing AngularLynx project. This is split out
 * from `ng-add` because users may opt out of Tailwind at scaffold time
 * (`ng add @blotch/angular-lynx --tailwind=false`) but later change their
 * minds — running this schematic later is the supported recovery path.
 *
 * It sets up the Tailwind version the project already depends on, else
 * Tailwind 4, or the one `--tailwind-version` asks for:
 *
 * - **Tailwind 4**, as Angular CLI's own Tailwind schematic does: the
 *   stylesheet imports Tailwind (without its Preflight reset), and
 *   `.postcssrc.json` runs `@tailwindcss/postcss`. The build plugin rewrites
 *   the CSS it writes into CSS Lynx reads.
 * - **Tailwind 3**, with `@lynx-js/tailwind-preset`, which narrows Tailwind's
 *   output to the CSS Lynx reads: `tailwind.config.ts` and the `@tailwind`
 *   directives.
 *
 * Each step is idempotent.
 */
export default (options: Schema): Rule =>
  async (tree: Tree) => {
    const workspace = await getWorkspace(tree);
    const projectName =
      options.project ??
      (workspace.extensions['defaultProject'] as string | undefined) ??
      [...workspace.projects.keys()][0];

    if (!projectName) {
      throw new SchematicsException(
        'No project found. Run this schematic inside an Angular workspace.',
      );
    }

    const project = workspace.projects.get(projectName);
    if (!project) {
      throw new SchematicsException(
        `Project "${projectName}" not found in angular.json.`,
      );
    }

    const sourceRoot = (project.sourceRoot ?? `${project.root}/src`) as string;
    const projectRoot = project.root as string;

    return setUpTailwind(
      { projectName, projectRoot, sourceRoot },
      tailwindVersionFor(tree, options.tailwindVersion),
    );
  };
