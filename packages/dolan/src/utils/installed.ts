import { existsSync, readdirSync } from 'node:fs';
import { getComponentNames } from '../registry.js';
import { trackedThemeFiles, type Lockfile } from '../lockfile.js';
import { getComponentFiles } from './resolve-paths.js';
import { themeFilesFor } from './tailwind.js';

/**
 * The registry components with a folder in the components directory. Other
 * folders (the app's own code next to the components) aren't dolan's.
 */
export const componentsOnDisk = (componentsDir: string): string[] => {
  if (!existsSync(componentsDir)) return [];
  const known = new Set(getComponentNames());
  return readdirSync(componentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && known.has(entry.name))
    .map((entry) => entry.name)
    .sort();
};

/**
 * The installed components dolan tracks: on disk and in the lockfile. `add`
 * records every component it copies, and `eject` removes the record to hand
 * the component over to the app, so a folder without one is the app's own
 * code. `update`, `list`, `diff` and `outdated` leave it alone: before, they
 * scanned the folders, so an ejected component showed as a conflict,
 * `update --force` overwrote it and `update` tracked it again.
 */
export const trackedComponents = (
  componentsDir: string,
  lockfile: Lockfile,
): string[] =>
  componentsOnDisk(componentsDir).filter((name) => lockfile.components[name]);

/** The components on disk that dolan doesn't track (see trackedComponents). */
export const untrackedComponents = (
  componentsDir: string,
  lockfile: Lockfile,
): string[] =>
  componentsOnDisk(componentsDir).filter((name) => !lockfile.components[name]);

/**
 * The files dolan tracks for a component that upstream no longer ships, such
 * as the `*-render.test.ts` files that 22.2.3 stopped copying. `update` and
 * `add` used to keep their lockfile entries and leave them on disk, where a
 * stale spec importing a helper dolan doesn't copy broke the app's `ng test`.
 *
 * Shipped means shipped with tests: a project without the testing library
 * doesn't get the components' `<name>.test.ts`, but upstream still ships it,
 * so a copy from before dolan checked for the library isn't deleted here
 * (`doctor` warns about those instead).
 */
export const droppedFiles = (name: string, lockfile: Lockfile): string[] => {
  const shipped = new Set(getComponentFiles(name, { tests: true }));
  return Object.keys(lockfile.components[name] ?? {}).filter(
    (file) => !shipped.has(file),
  );
};

/**
 * The theme files dolan tracks (see trackedThemeFiles) that the project no
 * longer takes: the Tailwind 3 plugin and its test once it's on Tailwind 4,
 * or `tailwind.css` once it's back on Tailwind 3. `update` used to look only
 * at the files the project takes, so the plugin stayed, on disk and in the
 * lockfile, as dead code and an uncovered file in the app's coverage report.
 *
 * As for droppedFiles, a test counts as taken whether or not the project has
 * the testing library: the plugin's test goes with the plugin, not with the
 * library, so a Tailwind 3 project that drops the library keeps its copy.
 */
export const droppedThemeFiles = (
  cwd: string,
  themeDir: string,
  lockfile: Lockfile,
): string[] => {
  const takes = new Set(themeFilesFor(cwd, { tests: true }));
  return trackedThemeFiles(lockfile, themeDir).filter(
    (file) => !takes.has(file),
  );
};
