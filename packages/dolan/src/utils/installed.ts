import { existsSync, readdirSync } from 'node:fs';
import { getComponentNames } from '../registry.js';
import type { Lockfile } from '../lockfile.js';

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
