import * as p from '@clack/prompts';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import { getComponentNames } from '../registry.js';
import {
  getComponentFiles,
  getComponentSourceDir,
  rewriteImports,
} from '../utils/resolve-paths.js';
import { formatContent } from '../utils/format.js';
import { getOrCreateLockfile, hashContent } from '../lockfile.js';
import {
  analyzeFile,
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
 * files has user edits.
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
  // unrelated files as "missing upstream".
  const allKnown = new Set(getComponentNames());
  const installed = readdirSync(componentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && allKnown.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (installed.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ components: [] }));
      return;
    }
    p.log.warn('No components installed.');
    p.outro('Done.');
    return;
  }

  const lockfile = getOrCreateLockfile(cwd);

  const results: { name: string; status: FileStatus; fileCount: number }[] = [];

  for (const name of installed) {
    const destDir = resolve(componentsDir, name);
    const files = getComponentFiles(name);
    const lockedComponent = lockfile.components[name] ?? {};

    const fileAnalyses: FileAnalysis[] = [];

    for (const file of files) {
      const srcContent = readFileSync(
        join(getComponentSourceDir(name), file),
        'utf-8',
      );
      const destPath = join(destDir, file);
      // Canonicalize like add/update so status compares apples to apples
      // against the formatted hash stored in the lockfile.
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

      fileAnalyses.push({
        file,
        status,
        currentContent: currentContent ?? '',
        newContent,
      });
    }

    const overall = summarizeComponent({ name, files: fileAnalyses });
    results.push({ name, status: overall, fileCount: files.length });
  }

  if (options.json) {
    console.log(JSON.stringify({ components: results }, null, 2));
    return;
  }

  const maxNameLen = Math.max(...results.map((r) => r.name.length));

  for (const { name, status, fileCount } of results) {
    const paddedName = name.padEnd(maxNameLen);
    const filesLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
    p.log.message(
      `  ${STATUS_ICONS[status]} ${pc.bold(paddedName)}  ${STATUS_SHORT_LABELS[status]}  ${pc.dim(`(${filesLabel})`)}`,
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
  ].filter(Boolean);

  p.outro(parts.join(', '));
};
