import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashContent, type Lockfile } from '../lockfile.js';
import {
  analyzeFile,
  analyzeRemovedFile,
  summarizeComponent,
  type FileAnalysis,
  type FileStatus,
} from './analyze.js';
import { formatContent } from './format.js';
import { droppedFiles } from './installed.js';
import {
  getComponentFiles,
  getComponentSourceDir,
  rewriteImports,
} from './resolve-paths.js';

/**
 * How an installed component's files compare with upstream: one analysis per
 * file upstream ships (its tests only when `tests`), then one per file dolan
 * tracks that upstream has stopped shipping (see droppedFiles).
 *
 * `update`, `list`, `diff` and `outdated` all read a component through this.
 * Each used to have its own copy of the loop, and only `update`'s learned
 * about the files upstream stopped shipping. So a component whose one change
 * was such a file showed as up to date in the other three, and `outdated`
 * exited 0 while the stale spec broke the app's `ng test`.
 */
export const analyzeComponent = (
  name: string,
  componentsDir: string,
  lockfile: Lockfile,
  tests: boolean,
): FileAnalysis[] => {
  const srcDir = getComponentSourceDir(name);
  const destDir = resolve(componentsDir, name);
  // `update` also analyzes a dependency the project doesn't have yet, which
  // has no entry: its files are all new.
  const lockedComponent = lockfile.components[name] ?? {};

  const analyses: FileAnalysis[] = [];

  for (const file of getComponentFiles(name, { tests })) {
    const destPath = join(destDir, file);
    // Normalize to the app's oxfmt config, as `add` and `update` do before
    // they write, so the lockfile's hash, the diff shown and the file written
    // all agree. Otherwise every file would read as drifted.
    const newContent = formatContent(
      rewriteImports(readFileSync(join(srcDir, file), 'utf-8')),
      destPath,
    );
    const currentContent = existsSync(destPath)
      ? readFileSync(destPath, 'utf-8')
      : null;

    analyses.push({
      file,
      status: analyzeFile(
        currentContent,
        newContent,
        lockedComponent[file]?.hash ?? null,
        hashContent,
      ),
      currentContent: currentContent ?? '',
      newContent,
    });
  }

  // Files dolan copied that upstream has since stopped shipping. Upstream's
  // version of one is no file, so taking it deletes the copy, by the same
  // rules as a change: an untouched one is an auto-update, an edited one a
  // conflict.
  for (const file of droppedFiles(name, lockfile)) {
    const destPath = join(destDir, file);
    const currentContent = existsSync(destPath)
      ? readFileSync(destPath, 'utf-8')
      : null;

    analyses.push({
      file,
      status: analyzeRemovedFile(
        currentContent,
        // droppedFiles lists the lockfile's entries, so it has one.
        lockedComponent[file]!.hash,
        hashContent,
      ),
      currentContent: currentContent ?? '',
      newContent: '',
      removed: 'upstream no longer ships it',
    });
  }

  return analyses;
};

/** An installed component's row in `list` and `outdated`. */
export type ComponentStatus = {
  name: string;
  status: FileStatus;
  /**
   * The component's files in the app once it's up to date with what upstream
   * ships, plus the stale ones still there.
   */
  fileCount: number;
  /**
   * The files still in the app that upstream no longer ships: what `update`
   * deletes, or asks about. One that's gone from disk already has only a
   * lockfile entry left, which `update` drops without a word, so it isn't
   * here, nor in `fileCount`.
   */
  stale: FileAnalysis[];
};

export const componentStatus = (
  name: string,
  componentsDir: string,
  lockfile: Lockfile,
  tests: boolean,
): ComponentStatus => {
  const files = analyzeComponent(name, componentsDir, lockfile, tests);
  const stale = files.filter(
    (file) => file.removed && file.status !== 'up-to-date',
  );
  return {
    name,
    status: summarizeComponent({ name, files }),
    fileCount: files.filter((file) => !file.removed).length + stale.length,
    stale,
  };
};

/**
 * A component as `list --json` and `outdated --json` print it. The stale
 * files are named, as the text output names them, since the status alone
 * reads like an ordinary change. The key is left out when there are none, so
 * the output for every other component is what it was.
 */
export const componentStatusJson = ({
  name,
  status,
  fileCount,
  stale,
}: ComponentStatus): {
  name: string;
  status: FileStatus;
  fileCount: number;
  removedUpstream?: string[];
} => ({
  name,
  status,
  fileCount,
  ...(stale.length > 0 && { removedUpstream: stale.map((file) => file.file) }),
});
