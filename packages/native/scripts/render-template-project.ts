import {
  APP_PROJECT,
  TEMPLATE_PROJECT_DIR,
  writeIosProject,
} from './generate-ios-project.ts';
import { renderIosProject } from './ios-project.ts';

/**
 * Vitest global setup: renders the template's App.xcodeproj before the tests,
 * as `npm run build` does before packing. It isn't in git, and the generator
 * and eject tests copy the real template, so a fresh clone's `npm test` would
 * otherwise test a template without its Xcode project.
 */
export default () => {
  writeIosProject(TEMPLATE_PROJECT_DIR, renderIosProject(APP_PROJECT));
};
