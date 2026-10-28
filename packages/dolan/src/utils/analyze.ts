import pc from 'picocolors';
import {
  diffLines,
  structuredPatch,
  applyPatch,
  type Hunk,
  type ParsedDiff,
} from 'diff';

export type FileStatus =
  | 'up-to-date'
  | 'auto-update'
  | 'user-modified'
  | 'conflict'
  | 'new-upstream';

export type FileAnalysis = {
  file: string;
  status: FileStatus;
  currentContent: string;
  newContent: string;
  /**
   * Why upstream's version of the file is no file, when it is: upstream
   * stopped shipping it, or it's a theme file for the Tailwind version the
   * app doesn't use. Taking upstream's version deletes it (see
   * analyzeRemovedFile), and its `newContent` is empty. The summary and the
   * question about it give this reason, since "upstream changed" would hide
   * that the file goes.
   */
  removed?: string;
};

export type ComponentAnalysis = {
  name: string;
  files: FileAnalysis[];
};

export const STATUS_ICONS: Record<FileStatus, string> = {
  'up-to-date': pc.green('✓'),
  'auto-update': pc.blue('↑'),
  'user-modified': pc.yellow('~'),
  conflict: pc.red('⚠'),
  'new-upstream': pc.blue('+'),
};

export const STATUS_LABELS: Record<FileStatus, string> = {
  'up-to-date': pc.dim('up to date'),
  'auto-update': pc.blue('upstream updated → auto-update'),
  'user-modified': pc.yellow('you modified → keeping yours'),
  conflict: pc.red('conflict — both modified'),
  'new-upstream': pc.blue('new file from upstream'),
};

/**
 * Three-way merge status detection. The lockfile stores the hash of each
 * file at install time (the "base"). Comparing current (user's file),
 * upstream (bundled source), and base (lockfile hash) lets us determine
 * who changed what:
 *   base == current, base != upstream → upstream changed → safe auto-update
 *   base != current, base == upstream → user changed → keep theirs
 *   base != current, base != upstream → both changed → conflict
 * When no base exists (missing lockfile entry), we can't tell who diverged,
 * so any difference is flagged as a conflict to be safe.
 */
export const analyzeFile = (
  currentContent: string | null,
  newContent: string,
  storedHash: string | null,
  hashContent: (content: string) => string,
): FileStatus => {
  if (currentContent === null) {
    return 'new-upstream';
  }

  const currentHash = hashContent(currentContent);
  const newHash = hashContent(newContent);

  if (storedHash === null) {
    if (currentHash === newHash) return 'up-to-date';
    return 'conflict';
  }

  if (storedHash === currentHash && storedHash === newHash) return 'up-to-date';
  if (currentHash === newHash) return 'up-to-date';
  if (storedHash === currentHash && storedHash !== newHash)
    return 'auto-update';
  if (storedHash !== currentHash && storedHash === newHash)
    return 'user-modified';
  return 'conflict';
};

/**
 * The status of a file dolan tracks but upstream no longer ships, such as the
 * `*-render.test.ts` files that 22.2.3 stopped copying, or the Tailwind 3
 * plugin of an app that moved to Tailwind 4. Upstream's version of it is "no
 * file", so the same three-way rules apply as for a changed file:
 *   - gone from disk too → up-to-date (only its lockfile entry is left)
 *   - current == base → auto-update (nobody edited it: delete it)
 *   - current != base → conflict (git's modify/delete: ask before deleting)
 */
export const analyzeRemovedFile = (
  currentContent: string | null,
  storedHash: string,
  hashContent: (content: string) => string,
): FileStatus => {
  if (currentContent === null) return 'up-to-date';
  return hashContent(currentContent) === storedHash
    ? 'auto-update'
    : 'conflict';
};

export const formatDiff = (
  currentContent: string,
  newContent: string,
): string => {
  const changes = diffLines(currentContent, newContent);
  const lines: string[] = [];

  for (const change of changes) {
    const text = change.value.replace(/\n$/, '');
    const changeLines = text.split('\n');

    for (const line of changeLines) {
      if (change.added) {
        lines.push(pc.green(`+ ${line}`));
      } else if (change.removed) {
        lines.push(pc.red(`- ${line}`));
      } else {
        lines.push(pc.dim(`  ${line}`));
      }
    }
  }

  return lines.join('\n');
};

export const summarizeComponent = (analysis: ComponentAnalysis): FileStatus => {
  const statuses = analysis.files.map((f) => f.status);
  if (statuses.includes('conflict')) return 'conflict';
  if (statuses.includes('auto-update') || statuses.includes('new-upstream'))
    return 'auto-update';
  if (statuses.includes('user-modified')) return 'user-modified';
  return 'up-to-date';
};

export { type Hunk } from 'diff';

export const getHunks = (
  currentContent: string,
  newContent: string,
  context = 3,
): Hunk[] => {
  const patch = structuredPatch(
    'file',
    'file',
    currentContent,
    newContent,
    '',
    '',
    {
      context,
    },
  );
  return patch.hunks;
};

export const formatHunk = (hunk: Hunk): string => {
  const lines: string[] = [];
  for (const line of hunk.lines) {
    const prefix = line[0];
    if (prefix === '+') {
      lines.push(pc.green(line));
    } else if (prefix === '-') {
      lines.push(pc.red(line));
    } else {
      lines.push(pc.dim(line));
    }
  }
  return lines.join('\n');
};

export const applySelectedHunks = (
  currentContent: string,
  newContent: string,
  acceptedIndices: number[],
): string | false => {
  const patch = structuredPatch('file', 'file', currentContent, newContent);
  const partial: ParsedDiff = {
    ...patch,
    hunks: patch.hunks.filter((_, i) => acceptedIndices.includes(i)),
  };
  return applyPatch(currentContent, partial);
};
