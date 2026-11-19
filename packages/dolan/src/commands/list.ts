import * as p from '@clack/prompts';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import { trackedComponents, untrackedComponents } from '../utils/installed.js';
import { copiesTests } from '../utils/packages.js';
import { getOrCreateLockfile } from '../lockfile.js';
import {
  removalLine,
  STATUS_ICONS,
  type FileStatus,
} from '../utils/analyze.js';
import {
  componentStatus,
  componentStatusJson,
} from '../utils/analyze-component.js';

const STATUS_SHORT_LABELS: Record<FileStatus, string> = {
  'up-to-date': pc.dim('up to date'),
  'auto-update': pc.blue('outdated'),
  'user-modified': pc.yellow('modified'),
  conflict: pc.red('conflict'),
  'new-upstream': pc.blue('outdated'),
};

/**
 * Lists every installed component along with its overall update status.
 *
 * For each component, every file is analyzed via the same three-way merge
 * function used by `dolan update` (lockfile-base / current / upstream), then
 * `summarizeComponent` rolls the per-file statuses up into a single component-
 * level status using a priority order (conflict > user-modified > outdated >
 * up-to-date) — so a component is flagged "modified" even if only one of its
 * files has user edits. A file upstream no longer ships counts as a change
 * too, and is named under its component (see analyzeComponent).
 *
 * Supports --json for machine-readable output (used by CI/scripts), which
 * short-circuits the interactive prompts entirely.
 */
export const listCommand = async (options: { json?: boolean }) => {
  const cwd = process.cwd();

  if (!options.json) {
    p.intro(pc.bold('dolan list'));
  }

  if (!configExists(cwd)) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'no config found' }));
      process.exit(1);
    }
    p.log.error(
      `No ${pc.cyan('dolan.config.json')} found. Run ${pc.bold('dolan init')} first.`,
    );
    process.exit(1);
  }

  const config = readConfig(cwd);
  const componentsDir = resolve(cwd, config.aliases.components);

  if (!existsSync(componentsDir)) {
    if (options.json) {
      console.log(JSON.stringify({ components: [] }));
      return;
    }
    p.log.warn('No components installed.');
    p.outro('Done.');
    return;
  }

  // The installed set = intersection of "directories in components dir" and
  // "names known to the registry". Anything else (e.g. user-authored folders
  // colocated with components) is ignored so we don't accidentally report
  // unrelated files as "missing upstream". Ejected components (no lockfile
  // entry) are listed apart: they're the app's code, with nothing to compare.
  const lockfile = getOrCreateLockfile(cwd);
  const installed = trackedComponents(componentsDir, lockfile);
  const ejected = untrackedComponents(componentsDir, lockfile);

  if (installed.length === 0 && ejected.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ components: [] }));
      return;
    }
    p.log.warn('No components installed.');
    p.outro('Done.');
    return;
  }

  const tests = copiesTests(cwd);
  const results = installed.map((name) =>
    componentStatus(name, componentsDir, lockfile, tests),
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        ejected.length > 0
          ? { components: results.map(componentStatusJson), ejected }
          : { components: results.map(componentStatusJson) },
        null,
        2,
      ),
    );
    return;
  }

  const maxNameLen = Math.max(
    ...[...results.map((r) => r.name), ...ejected].map((name) => name.length),
  );

  for (const { name, status, fileCount, stale } of results) {
    const paddedName = name.padEnd(maxNameLen);
    const filesLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
    p.log.message(
      `  ${STATUS_ICONS[status]} ${pc.bold(paddedName)}  ${STATUS_SHORT_LABELS[status]}  ${pc.dim(`(${filesLabel})`)}`,
    );
    // Name each file `update` would delete, since "outdated" alone reads
    // like a change to the files upstream still ships.
    for (const file of stale) {
      p.log.message(`    ${removalLine(`${name}/${file.file}`, file)}`);
    }
  }

  for (const name of ejected) {
    p.log.message(
      `  ${pc.dim('○')} ${pc.bold(name.padEnd(maxNameLen))}  ${pc.dim('ejected (not tracked)')}`,
    );
  }

  const upToDate = results.filter((r) => r.status === 'up-to-date').length;
  const outdated = results.filter(
    (r) => r.status === 'auto-update' || r.status === 'new-upstream',
  ).length;
  const modified = results.filter((r) => r.status === 'user-modified').length;
  const conflicts = results.filter((r) => r.status === 'conflict').length;

  const parts = [
    `${results.length} installed`,
    upToDate > 0 ? `${pc.green(String(upToDate))} up to date` : '',
    outdated > 0 ? `${pc.blue(String(outdated))} outdated` : '',
    modified > 0 ? `${pc.yellow(String(modified))} modified` : '',
    conflicts > 0 ? `${pc.red(String(conflicts))} conflict(s)` : '',
    ejected.length > 0 ? `${pc.dim(String(ejected.length))} ejected` : '',
  ].filter(Boolean);

  p.outro(parts.join(', '));
};
