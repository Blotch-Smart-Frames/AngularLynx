import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { REPO_ROOT } from './packages.ts';

/**
 * Removes what the build and test tooling leaves behind and never cleans up:
 *
 *   npm run clean:caches
 *
 * 1. turbo's cache entries older than two weeks. turbo writes a `.tar.zst`
 *    and a `-meta.json` into `.turbo/cache` for every task run whose input
 *    hash it hasn't seen, shares that folder between every worktree of the
 *    repository, and never removes an entry. Rebuilding the ~100 examples
 *    alone adds hundreds of megabytes whenever a shared package changes, so
 *    on a laptop that builds branches all day the cache grew by about 3 GB a
 *    week. Two weeks keeps every entry a current branch can still hit: turbo
 *    looks entries up by input hash, so an older one came from inputs no
 *    checkout has had since.
 *
 * 2. npm cache content no index entry refers to any more. npm's cache is
 *    content-addressed: an index entry keyed by URL points at a blob by hash,
 *    and re-fetching a URL whose body changed writes a new blob and points the
 *    entry at that one, leaving the old blob behind until `npm cache verify`
 *    runs, which nothing does by itself. Installing through the E2E tests'
 *    Verdaccio makes that churn: Verdaccio serves the full metadata document
 *    of every package (40 MB for vite, 20 MB each for typescript, playwright
 *    and react-native), and packages with nightly releases change theirs
 *    daily, so each install through it stranded about a gigabyte. The cache
 *    reached 54 GB, 45 GB of it unreachable. Blobs written in the last hour
 *    stay, in case an install running right now has written one and not its
 *    entry yet.
 *
 * The SessionStart hook in .claude/settings.json runs this with `--quiet`, so
 * a machine that works on this repository through Claude Code prunes itself.
 * `--quiet` does the work at most once a day, and in a detached process,
 * since walking both caches takes up to half a minute and a session start
 * shouldn't wait for it. That process logs what it did, with the time, to
 * ~/.cache/angular-lynx/prune-caches.log.
 */
const TURBO_MAX_AGE_DAYS = 14;
const NPM_GRACE_MS = 60 * 60 * 1000;
const QUIET_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_DIR = path.join(os.homedir(), '.cache/angular-lynx');
const quiet = process.argv.includes('--quiet');
/** Set by the detached process `--quiet` starts, so it logs with a time. */
const detached = process.argv.includes('--detached');

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

const report = (message: string) => {
  console.log(detached ? `${new Date().toISOString()} ${message}` : message);
};

/**
 * The cache turbo actually uses from this checkout. In a git worktree, turbo
 * shares the main checkout's `.turbo/cache` ("Using shared worktree cache"
 * in its debug log), so a prune run from a worktree has to look there too.
 */
const turboCacheDir = (): string => {
  let mainRoot = REPO_ROOT;
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    mainRoot = path.dirname(path.resolve(REPO_ROOT, commonDir));
  } catch {
    // Not a git checkout (an exported copy): turbo uses the local folder.
  }
  return path.join(mainRoot, '.turbo/cache');
};

const pruneTurboCache = () => {
  const cacheDir = turboCacheDir();
  if (!existsSync(cacheDir)) {
    return;
  }
  const cutoff = Date.now() - TURBO_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let removedBytes = 0;
  let removedEntries = 0;
  for (const name of readdirSync(cacheDir)) {
    const file = path.join(cacheDir, name);
    let stats;
    try {
      stats = statSync(file);
    } catch {
      // Another session's prune, or turbo, got there first.
      continue;
    }
    if (!stats.isFile() || stats.mtimeMs >= cutoff) {
      continue;
    }
    rmSync(file, { force: true });
    removedBytes += stats.size;
    removedEntries += 1;
  }
  if (removedEntries > 0) {
    report(
      `Removed ${removedEntries} turbo cache entries older than ${TURBO_MAX_AGE_DAYS} days (${megabytes(removedBytes)}) from ${cacheDir}`,
    );
  } else if (!quiet) {
    report(`Nothing older than ${TURBO_MAX_AGE_DAYS} days in ${cacheDir}`);
  }
};

/**
 * Where npm keeps its cache: `npm run` passes it on, otherwise the default.
 */
const npmCacheDir = (): string =>
  path.join(
    process.env['npm_config_cache'] ??
      process.env['NPM_CONFIG_CACHE'] ??
      path.join(os.homedir(), '.npm'),
    '_cacache',
  );

/**
 * The content files the index refers to. An index file holds one line per
 * entry, the key's hash, a tab and the entry as JSON; a key written again
 * appends a line, and every line counts here, so an entry only an older line
 * names keeps its content (npm would ignore it, but it's small).
 */
const referencedContent = (cacheDir: string): Set<string> => {
  const referenced = new Set<string>();
  const indexDir = path.join(cacheDir, 'index-v5');
  if (!existsSync(indexDir)) {
    return referenced;
  }
  for (const entry of readdirSync(indexDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }
    let lines: string[];
    try {
      lines = readFileSync(path.join(entry.parentPath, entry.name), 'utf8')
        .split('\n')
        .filter((line) => line.includes('\t'));
    } catch {
      continue;
    }
    for (const line of lines) {
      let integrity: unknown;
      try {
        ({ integrity } = JSON.parse(line.slice(line.indexOf('\t') + 1)) as {
          integrity?: unknown;
        });
      } catch {
        continue;
      }
      if (typeof integrity !== 'string') {
        continue;
      }
      // "sha512-<base64>"; the content lives at content-v2/<algorithm>/ under
      // the hex digest split two characters, two characters, the rest.
      for (const hash of integrity.split(/\s+/)) {
        const dash = hash.indexOf('-');
        if (dash < 0) {
          continue;
        }
        const hex = Buffer.from(hash.slice(dash + 1), 'base64').toString('hex');
        referenced.add(
          path.join(
            cacheDir,
            'content-v2',
            hash.slice(0, dash),
            hex.slice(0, 2),
            hex.slice(2, 4),
            hex.slice(4),
          ),
        );
      }
    }
  }
  return referenced;
};

const pruneNpmCache = () => {
  const cacheDir = npmCacheDir();
  const contentDir = path.join(cacheDir, 'content-v2');
  if (!existsSync(contentDir)) {
    return;
  }
  const referenced = referencedContent(cacheDir);
  const cutoff = Date.now() - NPM_GRACE_MS;
  let removedBytes = 0;
  let removedFiles = 0;
  for (const entry of readdirSync(contentDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }
    const file = path.join(entry.parentPath, entry.name);
    if (referenced.has(file)) {
      continue;
    }
    let stats;
    try {
      stats = statSync(file);
    } catch {
      continue;
    }
    if (stats.mtimeMs >= cutoff) {
      continue;
    }
    rmSync(file, { force: true });
    removedBytes += stats.size;
    removedFiles += 1;
  }
  if (removedFiles > 0) {
    report(
      `Removed ${removedFiles} npm cache blobs nothing refers to (${megabytes(removedBytes)}) from ${cacheDir}`,
    );
  } else if (!quiet) {
    report(`Every blob in ${cacheDir} is still referenced`);
  }
};

/**
 * Whether a `--quiet` run is due: once a day. The stamp sits next to the
 * other things this repository keeps under ~/.cache/angular-lynx.
 */
const quietRunDue = (): boolean => {
  const stamp = path.join(STATE_DIR, 'caches-pruned');
  try {
    if (Date.now() - statSync(stamp).mtimeMs < QUIET_INTERVAL_MS) {
      return false;
    }
  } catch {
    // No stamp yet.
  }
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stamp, new Date().toISOString());
  return true;
};

/**
 * Starts the real run in a process that outlives this one, with its output
 * appended to the log, so the hook that called this returns at once.
 */
const pruneDetached = () => {
  mkdirSync(STATE_DIR, { recursive: true });
  const log = openSync(path.join(STATE_DIR, 'prune-caches.log'), 'a');
  spawn(process.execPath, [process.argv[1]!, '--detached'], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', log, log],
  }).unref();
};

if (quiet) {
  if (quietRunDue()) {
    pruneDetached();
  }
} else {
  pruneTurboCache();
  pruneNpmCache();
}
