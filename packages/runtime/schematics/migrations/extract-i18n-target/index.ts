import type { Rule } from '@angular-devkit/schematics';
import { updateWorkspace } from '@schematics/angular/utility/workspace';

import {
  jsonMessagesOptions,
  useLynxExtractI18n,
} from '../../utility/extract-i18n-target';

/**
 * Gives every AngularLynx app in the workspace an `extract-i18n` target.
 *
 * Angular CLI can't pick an extractor for the Lynx build builder by itself,
 * and neither `ng add` nor `add-i18n` wrote a target, so `ng extract-i18n`
 * failed with "Cannot determine project or target for command." Now both
 * write one with the AngularLynx extract-i18n builder. This gives an app made
 * before the target those schematics would write today: `add-i18n`'s (JSON
 * in `src/locale`) when the app has an `i18n` block in angular.json, and
 * `ng add`'s (Angular's defaults) otherwise. A target the app added by hand
 * with Angular's builder, as the i18n guide showed, switches to the Lynx one,
 * which also handles imported images, and its options stay as they are: the
 * app already extracts the format it chose.
 */
export default (): Rule =>
  updateWorkspace((workspace) => {
    for (const project of workspace.projects.values()) {
      if (
        project.targets.get('build')?.builder !==
        '@blotch/angular-lynx-build:application'
      ) {
        continue;
      }
      const sourceRoot =
        project.sourceRoot ?? (project.root ? `${project.root}/src` : 'src');
      const isNew = !project.targets.has('extract-i18n');
      useLynxExtractI18n(
        project,
        isNew && project.extensions['i18n']
          ? jsonMessagesOptions(sourceRoot)
          : {},
      );
    }
  });
