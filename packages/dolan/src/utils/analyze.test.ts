import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { analyzeFile, formatDiff, summarizeComponent } from './analyze';

const hash = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 16);

describe('analyzeFile', () => {
  it('returns new-upstream when current content is null', () => {
    expect(analyzeFile(null, 'new content', null, hash)).toBe('new-upstream');
  });

  it('returns up-to-date when current matches new (no stored hash)', () => {
    expect(analyzeFile('same', 'same', null, hash)).toBe('up-to-date');
  });

  it('returns conflict when content differs with no stored hash', () => {
    expect(analyzeFile('local', 'upstream', null, hash)).toBe('conflict');
  });

  it('returns up-to-date when all three hashes match', () => {
    const stored = hash('content');
    expect(analyzeFile('content', 'content', stored, hash)).toBe('up-to-date');
  });

  it('returns up-to-date when user made same change as upstream', () => {
    const stored = hash('original');
    expect(analyzeFile('updated', 'updated', stored, hash)).toBe('up-to-date');
  });

  it('returns auto-update when only upstream changed', () => {
    const stored = hash('original');
    expect(analyzeFile('original', 'new-upstream', stored, hash)).toBe(
      'auto-update',
    );
  });

  it('returns user-modified when only user changed', () => {
    const stored = hash('original');
    expect(analyzeFile('user-edit', 'original', stored, hash)).toBe(
      'user-modified',
    );
  });

  it('returns conflict when both user and upstream changed differently', () => {
    const stored = hash('original');
    expect(analyzeFile('user-edit', 'upstream-edit', stored, hash)).toBe(
      'conflict',
    );
  });
});

describe('summarizeComponent', () => {
  it('returns up-to-date when all files are up-to-date', () => {
    const result = summarizeComponent({
      name: 'test',
      files: [
        {
          file: 'a.ts',
          status: 'up-to-date',
          currentContent: '',
          newContent: '',
        },
        {
          file: 'b.ts',
          status: 'up-to-date',
          currentContent: '',
          newContent: '',
        },
      ],
    });
    expect(result).toBe('up-to-date');
  });

  it('returns conflict when any file has conflict', () => {
    const result = summarizeComponent({
      name: 'test',
      files: [
        {
          file: 'a.ts',
          status: 'auto-update',
          currentContent: '',
          newContent: '',
        },
        {
          file: 'b.ts',
          status: 'conflict',
          currentContent: '',
          newContent: '',
        },
      ],
    });
    expect(result).toBe('conflict');
  });

  it('returns auto-update when any file needs update (no conflicts)', () => {
    const result = summarizeComponent({
      name: 'test',
      files: [
        {
          file: 'a.ts',
          status: 'up-to-date',
          currentContent: '',
          newContent: '',
        },
        {
          file: 'b.ts',
          status: 'auto-update',
          currentContent: '',
          newContent: '',
        },
      ],
    });
    expect(result).toBe('auto-update');
  });

  it('returns auto-update for new-upstream files', () => {
    const result = summarizeComponent({
      name: 'test',
      files: [
        {
          file: 'a.ts',
          status: 'new-upstream',
          currentContent: '',
          newContent: '',
        },
      ],
    });
    expect(result).toBe('auto-update');
  });

  it('returns user-modified when only user changes exist', () => {
    const result = summarizeComponent({
      name: 'test',
      files: [
        {
          file: 'a.ts',
          status: 'up-to-date',
          currentContent: '',
          newContent: '',
        },
        {
          file: 'b.ts',
          status: 'user-modified',
          currentContent: '',
          newContent: '',
        },
      ],
    });
    expect(result).toBe('user-modified');
  });
});

describe('formatDiff', () => {
  it('produces output with added and removed lines', () => {
    const result = formatDiff('line one\nline two\n', 'line one\nline three\n');
    expect(result).toContain('line one');
    expect(result).toContain('line two');
    expect(result).toContain('line three');
  });

  it('returns context-only output for identical content', () => {
    const result = formatDiff('same\n', 'same\n');
    expect(result).toContain('same');
    expect(result).not.toContain('+');
    expect(result).not.toContain('-');
  });
});
