import * as p from '@clack/prompts';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import { trackedComponents } from '../utils/installed.js';
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
  'new-upstream': pc.blue('new upstream'),
};

/**
 * Reports installed components that have diverged from upstream — a focused
 * subset of `dolan list` that filters out up-to-date entries.
 *
 * Designed to be CI-friendly:
 *   - `--json` emits machine-readable output for scripting.
 *   - Exit code 1 when ANY components are outdated, 0 when fully up to date.
 *     This lets pipelines fail loudly without parsing output (mirrors
 *     `npm outdated` behavior).
 *
 * A component with a file upstream no longer ships is outdated as well: the
 * file is still in the app until `update` deletes it (see analyzeComponent).
 */
export const outdatedCommand = async (options: { json?: boolean }) => {
  const cwd = process.cwd();

  if (!options.json) {
    p.intro(pc.bold('dolan outdated'));
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
    p.log.success('No components installed.');
    p.outro('');
    return;
  }

  // Ejected components (no lockfile entry) are the app's code, so they can't
  // be out of date.
  const lockfile = getOrCreateLockfile(cwd);
  const installed = trackedComponents(componentsDir, lockfile);

  if (installed.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ components: [] }));
      return;
    }
    p.log.success('No components installed.');
    p.outro('');
    return;
  }

  const tests = copiesTests(cwd);

  const outdated = installed
    .map((name) => componentStatus(name, componentsDir, lockfile, tests))
    .filter(({ status }) => status !== 'up-to-date');

  if (options.json) {
    console.log(
      JSON.stringify(
        { components: outdated.map(componentStatusJson) },
        null,
        2,
      ),
    );
    // Exit 1 when outdated so CI pipelines can detect "updates available"
    // without parsing stdout (e.g., `dolan outdated --json || echo "Run dolan update"`).
    process.exit(outdated.length > 0 ? 1 : 0);
  }

  if (outdated.length === 0) {
    p.log.success('All components are up to date.');
    p.outro('');
    return;
  }

  const maxNameLen = Math.max(...outdated.map((r) => r.name.length));

  for (const { name, status, fileCount, stale } of outdated) {
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

  p.outro(
    `${outdated.length} component(s) need attention. Run ${pc.bold('dolan update')} to apply.`,
  );
  process.exit(1);
};
