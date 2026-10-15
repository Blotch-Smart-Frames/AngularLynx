import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NativeBuildError, capture, run } from './process.ts';

let dir: string;
let logFile: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-process-'));
  logFile = path.join(dir, 'logs/build.log');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('run', () => {
  it('sends output to the log, not the terminal', async () => {
    await run('sh', ['-c', 'echo out; echo err >&2'], { cwd: dir, logFile });
    const log = readFileSync(logFile, 'utf8');
    expect(log).toContain('$ sh -c echo out; echo err >&2');
    expect(log).toContain('out\n');
    expect(log).toContain('err\n');
  });

  it('quotes compiler errors when there are any', async () => {
    const error = await run(
      'sh',
      [
        '-c',
        [
          'echo "a very long command line"',
          'echo "/x/App.swift:12:8: error: cannot find Foo"',
          'echo "/x/App.swift:12:8: error: cannot find Foo"',
          'echo "e: file.kt:3:1 Unresolved reference"',
          'echo "** BUILD FAILED **"',
          'exit 65',
        ].join('; '),
      ],
      { cwd: dir, logFile },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NativeBuildError);
    expect((error as Error).message).toBe(
      `sh -c failed (exit code 65). The full log is ${logFile}. The errors:\n\n/x/App.swift:12:8: error: cannot find Foo\ne: file.kt:3:1 Unresolved reference`,
    );
  });

  it('quotes the end of the log otherwise', async () => {
    const error = await run(
      'sh',
      [
        '-c',
        'for i in $(seq 1 50); do echo line $i; done; printf tail; exit 1',
      ],
      { cwd: dir, logFile },
    ).catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).toContain('Its last lines:');
    expect(message).toContain('line 50\ntail');
    expect(message).not.toContain('line 10\n');
  });

  it('reports a command that cannot start', async () => {
    await expect(
      run('definitely-not-a-command', [], { cwd: dir, logFile }),
    ).rejects.toThrow(/Could not run definitely-not-a-command/);
  });
});

describe('capture', () => {
  it('returns stdout, or undefined on failure', async () => {
    expect(await capture('sh', ['-c', 'echo hi'])).toBe('hi\n');
    expect(await capture('sh', ['-c', 'exit 1'])).toBeUndefined();
    expect(await capture('definitely-not-a-command', [])).toBeUndefined();
  });
});
