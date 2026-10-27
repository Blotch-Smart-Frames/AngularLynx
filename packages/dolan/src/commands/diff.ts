import * as p from '@clack/prompts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import { getComponentNames, getEntry } from '../registry.js';
import {
  getComponentFiles,
  getComponentSourceDir,
  rewriteImports,
} from '../utils/resolve-paths.js';
import { formatContent } from '../utils/format.js';
import { trackedComponents, untrackedComponents } from '../utils/installed.js';
import { isInteractive } from '../utils/interactive.js';
import { copiesTests } from '../utils/packages.js';
import { getOrCreateLockfile, hashContent } from '../lockfile.js';
import {
  analyzeFile,
  formatDiff,
  summarizeComponent,
  STATUS_ICONS,
  type FileAnalysis,
  type FileStatus,
} from '../utils/analyze.js';

const STATUS_SHORT_LABELS: Record<FileStatus, string> = {
  'up-to-date': pc.dim('up to date'),
  'auto-update': pc.blue('outdated'),
  'user-modified': pc.yellow('modified'),
  conflict: pc.red('conflict'),
  'new-upstream': pc.blue('new upstream'),
};

/**
 * Shows the diff between installed components and their current upstream
 * source. Two modes:
 *
 *   - With a component name: print the per-file diff immediately. Useful for
 *     CI-style "what would change?" inspection.
 *   - Without arguments: summarize all components that have any divergence
 *     from upstream and prompt to pick which one's diff to display. Without a
 *     terminal to ask in, it shows them all, as `git diff` would.
 *
 * Uses the same analyzeFile + summarizeComponent pipeline as `list`/`update`
 * so what you see here matches what those commands will report.
 */
export const diffCommand = async (component?: string) => {
  const cwd = process.cwd();

  p.intro(pc.bold('dolan diff'));

  if (!configExists(cwd)) {
    p.log.error(
      `No ${pc.cyan('dolan.config.json')} found. Run ${pc.bold('dolan init')} first.`,
    );
    process.exit(1);
  }

  const config = readConfig(cwd);
  const componentsDir = resolve(cwd, config.aliases.components);

  if (!existsSync(componentsDir)) {
    p.log.warn('No components installed.');
    p.outro('Done.');
    return;
  }

  const lockfile = getOrCreateLockfile(cwd);
  // Ejected components (no lockfile entry) are the app's code, with no
  // upstream to diff against.
  const installed = trackedComponents(componentsDir, lockfile);
  const ejected = untrackedComponents(componentsDir, lockfile);

  if (installed.length === 0 && !(component && ejected.includes(component))) {
    p.log.warn('No components installed.');
    p.outro('Done.');
    return;
  }

  const tests = copiesTests(cwd);

  if (component) {
    // Show diff for a specific component
    if (!getEntry(component)) {
      p.log.error(
        `Unknown component ${pc.bold(component)}. Available: ${getComponentNames().join(', ')}`,
      );
      process.exit(1);
    }

    if (ejected.includes(component)) {
      p.log.warn(
        `${pc.bold(component)} is ejected: dolan doesn't track it, so there's no upstream to compare.`,
      );
      p.outro('');
      return;
    }

    if (!installed.includes(component)) {
      p.log.error(`${pc.bold(component)} is not installed.`);
      process.exit(1);
    }

    showComponentDiff(component, componentsDir, lockfile, tests);
    p.outro('');
    return;
  }

  // Summary mode — show all components with changes
  const changed: { name: string; status: FileStatus }[] = [];

  for (const name of installed) {
    const analyses = analyzeComponent(name, componentsDir, lockfile, tests);
    const overall = summarizeComponent({ name, files: analyses });
    if (overall !== 'up-to-date') {
      changed.push({ name, status: overall });
    }
  }

  if (changed.length === 0) {
    p.log.success('All components are up to date with upstream.');
    p.outro('');
    return;
  }

  p.log.message(pc.bold(`${changed.length} component(s) with changes:\n`));

  for (const { name, status } of changed) {
    p.log.message(
      `  ${STATUS_ICONS[status]} ${pc.bold(name)}  ${STATUS_SHORT_LABELS[status]}`,
    );
  }

  p.log.message('');

  // No terminal to ask in: show them all.
  const choice = isInteractive()
    ? await p.select({
        message: 'Show diff for which component?',
        options: [
          ...changed.map((c) => ({ value: c.name, label: c.name })),
          { value: '__all__', label: 'All changed components' },
          { value: '__none__', label: 'Exit' },
        ],
      })
    : '__all__';

  if (p.isCancel(choice) || choice === '__none__') {
    p.outro('');
    return;
  }

  const toShow =
    choice === '__all__' ? changed.map((c) => c.name) : [choice as string];

  for (const name of toShow) {
    showComponentDiff(name, componentsDir, lockfile, tests);
  }

  p.outro('');
};

const analyzeComponent = (
  name: string,
  componentsDir: string,
  lockfile: { components: Record<string, Record<string, { hash: string }>> },
  tests: boolean,
): FileAnalysis[] => {
  const srcDir = getComponentSourceDir(name);
  const files = getComponentFiles(name, { tests });
  // Only tracked components get here, and those have an entry.
  const lockedComponent = lockfile.components[name]!;
  const destDir = resolve(componentsDir, name);

  const analyses: FileAnalysis[] = [];

  for (const file of files) {
    const srcContent = readFileSync(join(srcDir, file), 'utf-8');
    const destPath = join(destDir, file);
    // Match how add/update canonicalize upstream content, or every file would
    // read as drifted against the formatted hash recorded in the lockfile.
    const newContent = formatContent(rewriteImports(srcContent), destPath);

    const currentContent = existsSync(destPath)
      ? readFileSync(destPath, 'utf-8')
      : null;

    const storedHash = lockedComponent[file]?.hash ?? null;
    const status = analyzeFile(
      currentContent,
      newContent,
      storedHash,
      hashContent,
    );

    analyses.push({
      file,
      status,
      currentContent: currentContent ?? '',
      newContent,
    });
  }

  return analyses;
};

const showComponentDiff = (
  name: string,
  componentsDir: string,
  lockfile: { components: Record<string, Record<string, { hash: string }>> },
  tests: boolean,
) => {
  const analyses = analyzeComponent(name, componentsDir, lockfile, tests);

  p.log.message(`\n${pc.bold(name)}`);

  for (const analysis of analyses) {
    if (analysis.status === 'up-to-date') continue;

    const header = `── ${name}/${analysis.file} (${STATUS_SHORT_LABELS[analysis.status]}) ──`;
    p.log.message(`\n${pc.dim(header)}`);

    if (analysis.status === 'new-upstream') {
      // No current content to diff against — render the full upstream file
      // in green so it visually reads as "new content" rather than as a diff.
      p.log.message(pc.green(analysis.newContent));
    } else {
      const diff = formatDiff(analysis.currentContent, analysis.newContent);
      p.log.message(diff);
    }
  }

  const allUpToDate = analyses.every((a) => a.status === 'up-to-date');
  if (allUpToDate) {
    p.log.message(pc.dim('  All files up to date.'));
  }
};
