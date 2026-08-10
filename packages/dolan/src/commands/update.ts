import * as p from '@clack/prompts';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import pc from 'picocolors';
import { configExists, readConfig } from '../config.js';
import { getComponentNames } from '../registry.js';
import {
  getComponentFiles,
  getComponentSourceDir,
  getUiSourceDir,
  rewriteImports,
} from '../utils/resolve-paths.js';
import { formatContent } from '../utils/format.js';
import {
  getOrCreateLockfile,
  hashContent,
  writeLockfile,
  type Lockfile,
} from '../lockfile.js';
import {
  analyzeFile,
  formatDiff,
  formatHunk,
  getHunks,
  applySelectedHunks,
  summarizeComponent,
  STATUS_ICONS,
  STATUS_LABELS,
  type FileAnalysis,
  type ComponentAnalysis,
} from '../utils/analyze.js';

type ReviewResult = {
  decision: 'keep' | 'upstream' | 'partial';
  content?: string;
};

/**
 * Walks through each hunk in a diff and asks the user to accept or reject it.
 * "Show more context" re-computes the hunk with doubled context lines so the
 * user can see more surrounding code before deciding.
 */
const reviewHunks = async (
  componentName: string,
  fileName: string,
  currentContent: string,
  newContent: string,
): Promise<ReviewResult> => {
  let contextLines = 3;
  const hunks = getHunks(currentContent, newContent, contextLines);
  const accepted: boolean[] = Array.from({ length: hunks.length }, () => false);

  for (let i = 0; i < hunks.length; i++) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Re-fetch hunks if context was expanded — the current hunk may
      // have merged with neighbors, so we find the hunk that still covers
      // the original line range.
      const currentHunks = getHunks(currentContent, newContent, contextLines);
      const hunk =
        currentHunks.length === hunks.length
          ? currentHunks[i]
          : (currentHunks.find(
              (h) =>
                h.oldStart <= hunks[i].oldStart &&
                h.oldStart + h.oldLines >=
                  hunks[i].oldStart + hunks[i].oldLines,
            ) ??
            currentHunks[i] ??
            hunks[i]);

      const lineEnd = hunk.oldStart + hunk.oldLines - 1;
      p.log.message(`\n${formatHunk(hunk)}\n`);

      const choice = await p.select({
        message: `${pc.bold(componentName)}/${pc.bold(fileName)} — hunk ${i + 1}/${hunks.length} (lines ${hunk.oldStart}–${lineEnd})`,
        options: [
          {
            value: 'accept' as const,
            label: 'Accept',
            hint: 'apply this change',
          },
          {
            value: 'reject' as const,
            label: 'Reject',
            hint: 'skip this change',
          },
          {
            value: 'context' as const,
            label: 'Show more context',
            hint: 'expand surrounding lines',
          },
        ],
      });

      if (p.isCancel(choice)) {
        p.cancel('Update canceled.');
        process.exit(0);
      }

      if (choice === 'context') {
        contextLines *= 2;
        continue;
      }

      accepted[i] = choice === 'accept';
      break;
    }
  }

  const acceptedCount = accepted.filter(Boolean).length;
  if (acceptedCount === 0) return { decision: 'keep' };
  if (acceptedCount === hunks.length) return { decision: 'upstream' };

  const acceptedIndices = accepted
    .map((v, i) => (v ? i : -1))
    .filter((i) => i !== -1);
  const result = applySelectedHunks(
    currentContent,
    newContent,
    acceptedIndices,
  );

  if (result === false) {
    p.log.warn('Could not apply selected hunks — keeping your version.');
    return { decision: 'keep' };
  }

  return { decision: 'partial', content: result };
};

/**
 * Interactively presents a file change and asks the user to resolve it. Prompt
 * wording adapts to the file status — conflicts get "keep mine / take
 * upstream", while auto-updates and new files in selective mode get "apply /
 * skip for now". The "Show diff" option loops back into the same prompt so the
 * user can inspect before committing. "Review by hunk" lets the user
 * accept/reject individual changes within the file.
 */
const reviewFile = async (
  componentName: string,
  analysis: FileAnalysis,
): Promise<ReviewResult> => {
  const isNewFile = analysis.status === 'new-upstream';
  const isConflict = analysis.status === 'conflict';
  const isUserModified = analysis.status === 'user-modified';

  const suffix = isConflict
    ? '— how to resolve?'
    : isNewFile
      ? '— new file from upstream'
      : isUserModified
        ? '— you modified this file'
        : '— upstream changed';

  const applyOption =
    isConflict || isUserModified
      ? {
          value: 'upstream' as const,
          label: 'Take upstream version',
          hint: isUserModified
            ? 'revert to upstream'
            : 'discard my changes for this file',
        }
      : isNewFile
        ? {
            value: 'upstream' as const,
            label: 'Add this file',
            hint: 'create the file',
          }
        : {
            value: 'upstream' as const,
            label: 'Apply update',
            hint: 'overwrite with upstream',
          };

  const skipOption =
    isConflict || isUserModified
      ? {
          value: 'keep' as const,
          label: 'Keep my version',
          hint: 'skip upstream changes for this file',
        }
      : {
          value: 'keep' as const,
          label: 'Skip for now',
          hint: 'keep current, ask again next time',
        };

  const options: { value: string; label: string; hint: string }[] = [
    {
      value: 'diff',
      label: isNewFile ? 'Show new file' : 'Show diff',
      hint: 'see what changed',
    },
    skipOption,
    applyOption,
  ];

  // New files have nothing to compare hunk-by-hunk — it's all new content
  if (!isNewFile) {
    options.push({
      value: 'hunk-review',
      label: 'Review by hunk',
      hint: 'accept/reject individual changes',
    });
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const choice = await p.select({
      message: `${pc.bold(componentName)}/${pc.bold(analysis.file)} ${suffix}`,
      options,
    });

    if (p.isCancel(choice)) {
      p.cancel('Update canceled.');
      process.exit(0);
    }

    if (choice === 'diff') {
      if (isNewFile) {
        const lines = analysis.newContent
          .split('\n')
          .map((line) => pc.green(`+ ${line}`))
          .join('\n');
        p.log.message(`\n${pc.bold('New file')} (full content):\n\n${lines}\n`);
      } else {
        const diff = formatDiff(analysis.currentContent, analysis.newContent);
        p.log.message(
          `\n${pc.bold('Diff')} (${pc.red('- yours')} / ${pc.green('+ upstream')}):\n\n${diff}\n`,
        );
      }
      continue;
    }

    if (choice === 'hunk-review') {
      return reviewHunks(
        componentName,
        analysis.file,
        analysis.currentContent,
        analysis.newContent,
      );
    }

    return { decision: choice as 'keep' | 'upstream' };
  }
};

/**
 * Three-way merge update for installed components, modeled on the same flow
 * git/Mercurial use when applying upstream changes to a fork:
 *
 *   - **base** (lockfile hash) — what the file was at last add/update.
 *   - **current** (disk content) — what the user has now.
 *   - **upstream** (registry source, re-rewritten) — what we'd install fresh.
 *
 * For each file, `analyzeFile` produces a status:
 *   - **up-to-date**       — base == current == upstream (no work needed).
 *   - **auto-update**      — current matches base, upstream differs (safe to
 *                            overwrite — user hasn't touched the file).
 *   - **new-upstream**     — file didn't exist locally (new dependency file).
 *   - **user-modified**    — current differs from base, upstream matches base
 *                            (user has edits, no upstream change → keep theirs).
 *   - **conflict**         — current differs from base AND upstream differs
 *                            from base (both sides moved → prompt the user).
 *
 * `--force` bypasses all prompts and overwrites every file with upstream,
 * which is destructive but useful for resetting to a clean baseline.
 *
 * After the apply phase, the lockfile is updated to record the new upstream
 * hash for every file — even ones the user chose to keep. This intentionally
 * "advances the base" so the user only sees the same conflict once: next
 * update compares against the (now-advanced) base and surfaces only changes
 * introduced since this update.
 */
export const updateCommand = async (options: {
  force?: boolean;
  selective?: boolean;
}) => {
  const cwd = process.cwd();

  p.intro(pc.bold('dolan update'));

  if (!configExists(cwd)) {
    p.log.error(
      `No ${pc.cyan('dolan.config.json')} found. Run ${pc.bold('dolan init')} first.`,
    );
    process.exit(1);
  }

  const config = readConfig(cwd);
  const componentsDir = resolve(cwd, config.aliases.components);

  // Theme files are tracked independently of components (see the shared-file
  // pass below). A project can legitimately have theme drift with zero tracked
  // components — e.g. after ejecting every component but keeping the theme, or
  // a theme-only setup. So we must NOT bail out just because there are no
  // components: that would silently skip theme updates, including the
  // destructive `--force` reset the user explicitly asked for. We compute the
  // installed list defensively (empty when the dir is absent) and let the
  // normal "nothing to do" checks below decide whether there's real work.
  const allKnown = new Set(getComponentNames());
  const installed = existsSync(componentsDir)
    ? readdirSync(componentsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && allKnown.has(entry.name))
        .map((entry) => entry.name)
        .sort()
    : [];

  const lockfile = getOrCreateLockfile(cwd);

  // --- Analysis phase ---
  const s = p.spinner();
  s.start('Analyzing changes...');

  const componentAnalyses: ComponentAnalysis[] = [];

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
      // Normalize to the consumer's oxfmt config before hashing/diffing so the
      // lockfile base, the shown diff, and the written file all agree.
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

    componentAnalyses.push({ name, files: fileAnalyses });
  }

  // Analyze shared files (theme only — utils now come from @blotch/dolan)
  const uiSrc = getUiSourceDir();
  const sharedAnalyses: FileAnalysis[] = [];

  // Theme files
  const themeDir = resolve(cwd, config.aliases.theme);
  const themeFiles = ['default.css', 'dark.css', 'tailwind-plugin.ts'];
  for (const file of themeFiles) {
    const src = join(uiSrc, 'theme', file);
    if (!existsSync(src)) continue;

    const destPath = join(themeDir, file);
    // Theme files include `.css` (passed through untouched) and
    // `tailwind-plugin.ts` (normalized to the consumer's oxfmt config).
    const newContent = formatContent(readFileSync(src, 'utf-8'), destPath);
    const currentContent = existsSync(destPath)
      ? readFileSync(destPath, 'utf-8')
      : null;
    const storedHash = lockfile.theme[file]?.hash ?? null;

    sharedAnalyses.push({
      file: `theme/${file}`,
      status: analyzeFile(currentContent, newContent, storedHash, hashContent),
      currentContent: currentContent ?? '',
      newContent,
    });
  }

  s.stop('Analysis complete.');

  // --- Display summary ---
  if (componentAnalyses.length > 0) {
    p.log.message(pc.bold('\nComponents:'));

    for (const comp of componentAnalyses) {
      const overall = summarizeComponent(comp);
      p.log.message(
        `  ${STATUS_ICONS[overall]} ${pc.bold(comp.name)} — ${STATUS_LABELS[overall]}`,
      );
    }
  }

  if (sharedAnalyses.length > 0) {
    p.log.message(pc.bold('\nShared files:'));
    for (const file of sharedAnalyses) {
      p.log.message(
        `  ${STATUS_ICONS[file.status]} ${pc.bold(file.file)} — ${STATUS_LABELS[file.status]}`,
      );
    }
  }

  // Compute stats
  const allFiles = [
    ...componentAnalyses.flatMap((c) => c.files),
    ...sharedAnalyses,
  ];
  const autoUpdateCount = allFiles.filter(
    (f) => f.status === 'auto-update' || f.status === 'new-upstream',
  ).length;
  const userModifiedCount = allFiles.filter(
    (f) => f.status === 'user-modified',
  ).length;
  const conflictCount = allFiles.filter((f) => f.status === 'conflict').length;
  const upToDateCount = allFiles.filter(
    (f) => f.status === 'up-to-date',
  ).length;

  p.log.message('');
  p.log.info(
    [
      upToDateCount > 0 ? `${pc.green(String(upToDateCount))} up to date` : '',
      autoUpdateCount > 0
        ? `${pc.blue(String(autoUpdateCount))} auto-update`
        : '',
      userModifiedCount > 0
        ? `${pc.yellow(String(userModifiedCount))} kept (user-modified)`
        : '',
      conflictCount > 0 ? `${pc.red(String(conflictCount))} conflict(s)` : '',
    ]
      .filter(Boolean)
      .join(', '),
  );

  // Nothing to do
  if (autoUpdateCount === 0 && conflictCount === 0 && userModifiedCount === 0) {
    p.outro('Everything is up to date.');
    writeLockfile(
      cwd,
      buildLockfile(componentAnalyses, sharedAnalyses, lockfile),
    );
    return;
  }

  const isSelective = !!options.selective && !options.force;

  if (options.force) {
    p.log.warn(
      'Force mode — all files will be overwritten with upstream versions.',
    );
  }

  // Nothing actionable without force or selective
  if (
    !options.force &&
    !isSelective &&
    autoUpdateCount === 0 &&
    conflictCount === 0
  ) {
    p.outro('Everything is up to date.');
    writeLockfile(
      cwd,
      buildLockfile(componentAnalyses, sharedAnalyses, lockfile),
    );
    return;
  }

  if (!options.force && !isSelective && autoUpdateCount > 0) {
    const confirm = await p.confirm({
      message: `Apply ${autoUpdateCount} auto-update(s)?`,
      initialValue: true,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Update canceled.');
      process.exit(0);
    }
  }

  const reviewableCount = autoUpdateCount + userModifiedCount;
  if (isSelective && reviewableCount > 0) {
    p.log.info(
      `Selective mode — reviewing ${pc.bold(String(reviewableCount))} file(s) individually.`,
    );
  }

  // --- Resolve conflicts ---
  const resolutions = new Map<string, ReviewResult>();
  const partialContents = new Map<string, string>();

  if (!options.force) {
    for (const comp of componentAnalyses) {
      for (const file of comp.files) {
        if (file.status === 'conflict') {
          const key = `${comp.name}/${file.file}`;
          const result = await reviewFile(comp.name, file);
          resolutions.set(key, result);
          if (result.decision === 'partial' && result.content) {
            partialContents.set(key, result.content);
          }
        }
      }
    }

    for (const file of sharedAnalyses) {
      if (file.status === 'conflict') {
        const result = await reviewFile('shared', file);
        resolutions.set(file.file, result);
        if (result.decision === 'partial' && result.content) {
          partialContents.set(file.file, result.content);
        }
      }
    }
  }

  // --- Selective review of auto-updates and new files ---
  if (isSelective) {
    for (const comp of componentAnalyses) {
      for (const file of comp.files) {
        if (
          file.status === 'auto-update' ||
          file.status === 'new-upstream' ||
          file.status === 'user-modified'
        ) {
          const key = `${comp.name}/${file.file}`;
          const result = await reviewFile(comp.name, file);
          resolutions.set(key, result);
          if (result.decision === 'partial' && result.content) {
            partialContents.set(key, result.content);
          }
        }
      }
    }

    for (const file of sharedAnalyses) {
      if (
        file.status === 'auto-update' ||
        file.status === 'new-upstream' ||
        file.status === 'user-modified'
      ) {
        const result = await reviewFile('shared', file);
        resolutions.set(file.file, result);
        if (result.decision === 'partial' && result.content) {
          partialContents.set(file.file, result.content);
        }
      }
    }
  }

  // --- Apply changes ---
  const applySpinner = p.spinner();
  applySpinner.start('Applying updates...');

  let appliedCount = 0;
  let skippedCount = 0;
  const newLockfile = getOrCreateLockfile(cwd);

  for (const comp of componentAnalyses) {
    const destDir = resolve(componentsDir, comp.name);
    mkdirSync(destDir, { recursive: true });

    if (!newLockfile.components[comp.name]) {
      newLockfile.components[comp.name] = {};
    }

    for (const file of comp.files) {
      const destPath = join(destDir, file.file);
      const key = `${comp.name}/${file.file}`;

      const resolution = resolutions.get(key)?.decision;

      // In selective mode, auto-update/new-upstream files need explicit
      // approval — "skip for now" means don't touch file OR lockfile hash
      // so the change surfaces again on the next run.
      const selectivelySkipped =
        isSelective &&
        (file.status === 'auto-update' || file.status === 'new-upstream') &&
        resolution === 'keep';

      // Overwrite when ANY of these are true:
      //   1. auto-update (not selectively skipped, not partial)
      //   2. new-upstream (not selectively skipped, not partial)
      //   3. user-modified resolved as 'upstream' (selective review or force)
      //   4. conflict resolved as 'upstream' (or force)
      const shouldOverwrite =
        !selectivelySkipped &&
        resolution !== 'partial' &&
        (file.status === 'auto-update' ||
          file.status === 'new-upstream' ||
          (file.status === 'user-modified' &&
            (options.force || resolution === 'upstream')) ||
          (file.status === 'conflict' &&
            (options.force || resolution === 'upstream')));

      if (resolution === 'partial') {
        // User accepted some hunks but not all — write reconstructed
        // content and advance lockfile to upstream hash. On next update
        // the file shows as "user-modified" (the user's partial is their
        // version now).
        const content = partialContents.get(key)!;
        writeFileSync(destPath, content);
        newLockfile.components[comp.name][file.file] = {
          hash: hashContent(file.newContent),
        };
        appliedCount++;
      } else if (shouldOverwrite) {
        writeFileSync(destPath, file.newContent);
        newLockfile.components[comp.name][file.file] = {
          hash: hashContent(file.newContent),
        };
        appliedCount++;
      } else if (selectivelySkipped) {
        // "Not now" — preserve the existing lockfile entry so this file
        // appears as auto-update/new-upstream again on the next run.
        const existingEntry = lockfile.components[comp.name]?.[file.file];
        if (existingEntry) {
          newLockfile.components[comp.name][file.file] = existingEntry;
        }
        skippedCount++;
      } else if (file.status === 'conflict') {
        // User chose to keep their version. We still advance the lockfile base
        // to the current upstream hash. This means on the next update:
        //   - If upstream hasn't changed again: base==upstream but base!=current
        //     → shows as "user-modified" (not a conflict). Correct.
        //   - If upstream changes again: base=old-upstream ≠ new-upstream AND
        //     base ≠ user's current → conflict again. Correct.
        newLockfile.components[comp.name][file.file] = {
          hash: hashContent(file.newContent),
        };
        skippedCount++;
      } else if (file.status === 'user-modified') {
        newLockfile.components[comp.name][file.file] = lockfile.components[
          comp.name
        ]?.[file.file] ?? {
          hash: hashContent(file.newContent),
        };
        skippedCount++;
      } else {
        // up-to-date — record hash
        newLockfile.components[comp.name][file.file] = {
          hash: hashContent(file.newContent),
        };
      }
    }
  }

  // Apply shared files (theme only)
  for (const file of sharedAnalyses) {
    const fileName = file.file.split('/').pop()!;
    mkdirSync(themeDir, { recursive: true });
    const destPath = join(themeDir, fileName);

    const sharedResolution = resolutions.get(file.file)?.decision;

    const selectivelySkippedShared =
      isSelective &&
      (file.status === 'auto-update' || file.status === 'new-upstream') &&
      sharedResolution === 'keep';

    const shouldOverwrite =
      !selectivelySkippedShared &&
      sharedResolution !== 'partial' &&
      (file.status === 'auto-update' ||
        file.status === 'new-upstream' ||
        (file.status === 'user-modified' &&
          (options.force || sharedResolution === 'upstream')) ||
        (file.status === 'conflict' &&
          (options.force || sharedResolution === 'upstream')));

    const entry = { hash: hashContent(file.newContent) };

    if (sharedResolution === 'partial') {
      const content = partialContents.get(file.file)!;
      writeFileSync(destPath, content);
      newLockfile.theme[fileName] = entry;
      appliedCount++;
    } else if (shouldOverwrite) {
      writeFileSync(destPath, file.newContent);
      newLockfile.theme[fileName] = entry;
      appliedCount++;
    } else if (selectivelySkippedShared) {
      const existingEntry = lockfile.theme[fileName];
      if (existingEntry) {
        newLockfile.theme[fileName] = existingEntry;
      }
      skippedCount++;
    } else if (file.status === 'conflict') {
      newLockfile.theme[fileName] = entry;
      skippedCount++;
    } else if (file.status === 'up-to-date') {
      newLockfile.theme[fileName] = entry;
    }
  }

  writeLockfile(cwd, newLockfile);

  applySpinner.stop('Done!');

  // --- Final summary ---
  if (appliedCount > 0) {
    p.log.success(`${pc.bold(String(appliedCount))} file(s) updated.`);
  }
  if (skippedCount > 0 && isSelective) {
    p.log.info(
      `${pc.bold(String(skippedCount))} file(s) skipped — they'll appear again on next update.`,
    );
  } else if (skippedCount > 0) {
    p.log.info(`${pc.bold(String(skippedCount))} file(s) kept as-is.`);
  }

  p.outro('Update complete.');
};

/**
 * Build a fresh lockfile snapshot for the "nothing to apply" case
 */
const buildLockfile = (
  components: ComponentAnalysis[],
  shared: FileAnalysis[],
  existing: Lockfile,
): Lockfile => {
  const lockfile: Lockfile = { ...existing };

  for (const comp of components) {
    if (!lockfile.components[comp.name]) {
      lockfile.components[comp.name] = {};
    }
    for (const file of comp.files) {
      lockfile.components[comp.name][file.file] = {
        hash: hashContent(file.newContent),
      };
    }
  }

  for (const file of shared) {
    const fileName = file.file.split('/').pop()!;
    const entry = { hash: hashContent(file.newContent) };
    lockfile.theme[fileName] = entry;
  }

  return lockfile;
};
