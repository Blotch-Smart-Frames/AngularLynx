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
    p.log.success('No components installed.');
    p.outro('');
    return;
  }

  const lockfile = getOrCreateLockfile(cwd);

  const outdated: { name: string; status: FileStatus; fileCount: number }[] =
    [];

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
      // Canonicalize like add/update so drift detection compares apples to
      // apples against the formatted hash stored in the lockfile.
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
    if (overall !== 'up-to-date') {
      outdated.push({ name, status: overall, fileCount: files.length });
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ components: outdated }, null, 2));
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

  for (const { name, status, fileCount } of outdated) {
    const paddedName = name.padEnd(maxNameLen);
    const filesLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
    p.log.message(
      `  ${STATUS_ICONS[status]} ${pc.bold(paddedName)}  ${STATUS_SHORT_LABELS[status]}  ${pc.dim(`(${filesLabel})`)}`,
    );
  }

  p.outro(
    `${outdated.length} component(s) need attention. Run ${pc.bold('dolan update')} to apply.`,
  );
  process.exit(1);
};
