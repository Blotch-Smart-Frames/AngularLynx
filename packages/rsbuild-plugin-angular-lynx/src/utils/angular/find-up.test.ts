import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { existsSync } from 'node:fs';
import { findUp } from './find-up';

const mockedExistsSync = vi.mocked(existsSync);

describe('findUp', () => {
  it('finds file in the starting directory', () => {
    mockedExistsSync.mockImplementation(
      (p) => p === path.join('/a/b/c', 'tsconfig.json'),
    );

    expect(findUp('tsconfig.json', '/a/b/c')).toBe(
      path.join('/a/b/c', 'tsconfig.json'),
    );
  });

  it('walks up directories to find file in ancestor', () => {
    mockedExistsSync.mockImplementation(
      (p) => p === path.join('/a', 'angular.json'),
    );

    expect(findUp('angular.json', '/a/b/c')).toBe(
      path.join('/a', 'angular.json'),
    );
  });

  it('returns null when file does not exist anywhere up to root', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(findUp('nonexistent.json', '/a/b/c')).toBeNull();
  });

  it('accepts array of names and returns first match', () => {
    mockedExistsSync.mockImplementation(
      (p) => p === path.join('/a/b', 'angular.json'),
    );

    expect(findUp(['angular.json', '.angular.json'], '/a/b/c')).toBe(
      path.join('/a/b', 'angular.json'),
    );
  });

  it('with array of names, matches second name if first does not exist', () => {
    mockedExistsSync.mockImplementation(
      (p) => p === path.join('/a/b', '.angular.json'),
    );

    expect(findUp(['angular.json', '.angular.json'], '/a/b/c')).toBe(
      path.join('/a/b', '.angular.json'),
    );
  });

  it('stops at filesystem root without infinite loop', () => {
    mockedExistsSync.mockReturnValue(false);

    findUp('missing.json', '/a/b/c');

    // Should have been called a finite number of times (once per dir per name)
    expect(mockedExistsSync.mock.calls.length).toBeLessThan(20);
  });
});
