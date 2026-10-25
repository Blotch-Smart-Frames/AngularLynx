import type { JsonValue, workspaces } from '@angular-devkit/core';

const LYNX_EXTRACT_I18N_BUILDER = '@blotch/angular-lynx-build:extract-i18n';

/**
 * Angular's extract-i18n builders. The Lynx builder hands its options to
 * `@angular/build:extract-i18n`, and `@angular-devkit/build-angular`'s takes
 * the same ones, so a target of either works with it unchanged.
 */
const ANGULAR_EXTRACT_I18N_BUILDERS = [
  '@angular/build:extract-i18n',
  '@angular-devkit/build-angular:extract-i18n',
];

/**
 * Points a project's `extract-i18n` target at the AngularLynx builder, so
 * `ng extract-i18n` works. Angular CLI picks an extractor by itself only for
 * a project built with one of Angular's own builders; for the Lynx build
 * builder it fails with "Cannot determine project or target for command."
 * Angular's extractor would fail anyway on the first imported image, which
 * the Lynx builder sets it up for.
 *
 * `options` are set where the target doesn't set them already, so a format
 * or path the app chose stays. A target of Angular's switches builder; a
 * target with any other builder is the app's own choice, and stays as it is.
 */
export const useLynxExtractI18n = (
  project: workspaces.ProjectDefinition,
  options: Record<string, JsonValue> = {},
): void => {
  const target = project.targets.get('extract-i18n');
  if (!target) {
    project.targets.add({
      name: 'extract-i18n',
      builder: LYNX_EXTRACT_I18N_BUILDER,
      ...(Object.keys(options).length > 0 && { options }),
    });
    return;
  }
  if (
    target.builder !== LYNX_EXTRACT_I18N_BUILDER &&
    !ANGULAR_EXTRACT_I18N_BUILDERS.includes(target.builder)
  ) {
    return;
  }
  target.builder = LYNX_EXTRACT_I18N_BUILDER;
  const missing = Object.entries(options).filter(
    ([name]) => !(name in (target.options ?? {})),
  );
  if (missing.length > 0) {
    target.options = { ...target.options, ...Object.fromEntries(missing) };
  }
};

/**
 * The options `add-i18n` gives the `extract-i18n` target: the messages go as
 * JSON to `<sourceRoot>/locale/messages.json`, where Angular's i18n guide
 * keeps translation files. Angular's default format is XLIFF, but an app on
 * Lynx loads its translations at runtime with `loadTranslations()`, which
 * takes the JSON file's `translations` object as it is.
 */
export const jsonMessagesOptions = (
  sourceRoot: string,
): Record<string, JsonValue> => ({
  format: 'json',
  outputPath: `${sourceRoot}/locale`,
});
