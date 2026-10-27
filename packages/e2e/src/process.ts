import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * Thrown when an E2E check fails. The message must say what the user would
 * see go wrong and where to look, because CI logs are the only thing a
 * maintainer has when a nightly run fails.
 */
export class CheckError extends Error {
  override name = 'CheckError';
}

/** Fails the run with `message` unless `condition` holds. */
export const check: (
  condition: unknown,
  message: string,
) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new CheckError(message);
  }
};

/** Prints a step heading so the CI log shows which step a failure is in. */
export const step = (title: string) => {
  console.log(`\n━━ ${title}`);
};

export type RunOptions = {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Every line of output is also appended here, for the failure artifacts. */
  readonly logFile?: string;
  /** Print output as it arrives. On by default so CI shows progress. */
  readonly echo?: boolean;
  /**
   * Kills the command, with its children, once it runs for `ms` without
   * printing a line that matches `progress` (or at all, without `progress`).
   * For commands that can hang outright, as Maestro did waiting on a device:
   * CI had no timeout of its own, so a hang ran until GitHub killed the job
   * hours later, with no logs to show for it.
   */
  readonly timeout?: {
    readonly ms: number;
    readonly progress?: RegExp;
  };
};

export type RunResult = {
  readonly code: number;
  /** stdout and stderr interleaved, as a user would see them in a terminal. */
  readonly output: string;
  /**
   * Set when {@link RunOptions.timeout} stopped the command, with what it had
   * printed by then. What it prints while it shuts down isn't a result: told
   * to stop, Maestro reported the flow it hung on, and every flow after it, as
   * failed.
   */
  readonly timedOut?: { readonly output: string };
};

// On Windows `npm` and `npx` are `.cmd` shims, which only start through a
// shell. Everywhere else, skipping the shell keeps arguments unmangled.
const useShell = process.platform === 'win32';

/** Starts a command without waiting for it, teeing its output to the log. */
export const start = (
  command: string,
  args: readonly string[],
  options: RunOptions,
): { child: ChildProcess; output: () => string } => {
  const display = [command, ...args].join(' ');
  if (options.logFile) {
    appendFileSync(options.logFile, `\n$ ${display}  (in ${options.cwd})\n`);
  }
  console.log(`$ ${display}`);

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: useShell,
    stdio: ['ignore', 'pipe', 'pipe'],
    // A process group lets `stop()` kill the whole tree. `npm start` runs
    // rspeedy through a shell, and killing only npm would leave the dev
    // server holding its port.
    detached: process.platform !== 'win32',
  });

  let output = '';
  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    if (options.echo !== false) {
      process.stdout.write(text);
    }
    if (options.logFile) {
      appendFileSync(options.logFile, text);
    }
  };
  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);

  return { child, output: () => output };
};

/**
 * Kills a process started with {@link start}, including its children. With
 * `killAfterMs`, a process group still running that long after SIGTERM gets
 * SIGKILL: a hung program may never get to the end of its shutdown.
 */
export const stop = (
  child: ChildProcess,
  { killAfterMs }: { killAfterMs?: number } = {},
) => {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      // Wait for taskkill: Windows won't delete a folder while a process
      // still has files open in it, so the work-dir cleanup right after
      // stopping Verdaccio failed with EPERM.
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    } else {
      process.kill(-child.pid, 'SIGTERM');
      if (killAfterMs !== undefined) {
        const pid = child.pid;
        const timer = setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // The group ended after SIGTERM.
          }
        }, killAfterMs);
        child.once('close', () => clearTimeout(timer));
      }
    }
  } catch {
    // Already gone.
  }
};

/** Runs a command to completion and returns its exit code and output. */
export const runAllowFailure = (
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> => {
  const { child, output } = start(command, args, options);
  const { timeout } = options;
  let timedOut: RunResult['timedOut'];
  let timer: NodeJS.Timeout | undefined;
  const watch = (ms: number, message: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = { output: output() };
      console.error(`\n! \`${command}\` ${message}; stopping it.`);
      stop(child, { killAfterMs: 10_000 });
    }, ms);
  };
  const { ms, progress } = timeout ?? {};
  const limit = `${Math.round((ms ?? 0) / 1000)}s`;
  if (ms !== undefined) {
    watch(ms, progress ? `made no progress for ${limit}` : `ran for ${limit}`);
  }
  if (ms !== undefined && progress) {
    // Whole lines only: a progress line can arrive split across chunks.
    let partial = '';
    const onData = (chunk: Buffer) => {
      const lines = (partial + chunk.toString()).split('\n');
      partial = lines.pop()!;
      // Once stopped, a command's output no longer counts as progress.
      if (!timedOut && lines.some((line) => progress.test(line))) {
        watch(ms, `made no progress for ${limit}`);
      }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
  }
  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: output(), timedOut });
    });
  });
};

/**
 * Runs a command and fails the run if it exits non-zero. Most E2E steps go
 * through here. Its exit code alone proves little (`ng add` exited 0 on
 * 22.2.1 while doing nothing), so callers check the files it produced too.
 */
export const run = async (
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> => {
  const result = await runAllowFailure(command, args, options);
  check(
    result.code === 0,
    `\`${[command, ...args].join(' ')}\` exited with code ${result.code}. Its output is above.`,
  );
  return result;
};

/** Waits until `predicate` returns true, polling every `intervalMs`. */
export const waitFor = async (
  description: string,
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs, intervalMs = 500 }: { timeoutMs: number; intervalMs?: number },
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new CheckError(
    `Timed out after ${timeoutMs / 1000}s waiting for ${description}.`,
  );
};
