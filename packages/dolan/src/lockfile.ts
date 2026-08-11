import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type FileEntry = {
  hash: string;
};

export type Lockfile = {
  version: number;
  components: Record<string, Record<string, FileEntry>>;
  utils?: Record<string, FileEntry>;
  theme: Record<string, FileEntry>;
};

const LOCKFILE_NAME = 'dolan.lock.json';

/**
 * 16 hex chars = 64-bit prefix of SHA-256. Enough collision resistance for
 * file integrity checks (the probability of a false "no change" detection is
 * 1 in 2^64), while keeping the lockfile compact and human-readable.
 */
export const hashContent = (content: string): string => {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
};

export const getLockfilePath = (cwd: string): string => {
  return resolve(cwd, LOCKFILE_NAME);
};

export const lockfileExists = (cwd: string): boolean => {
  return existsSync(getLockfilePath(cwd));
};

export const readLockfile = (cwd: string): Lockfile => {
  const path = getLockfilePath(cwd);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Lockfile;
};

export const createEmptyLockfile = (): Lockfile => ({
  version: 1,
  components: {},
  theme: {},
});

export const writeLockfile = (cwd: string, lockfile: Lockfile): void => {
  const path = getLockfilePath(cwd);
  writeFileSync(path, JSON.stringify(lockfile, null, 2) + '\n');
};

export const getOrCreateLockfile = (cwd: string): Lockfile => {
  if (lockfileExists(cwd)) {
    return readLockfile(cwd);
  }
  return createEmptyLockfile();
};
