import { spawn, type ChildProcess } from 'node:child_process';
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
};

export type RunResult = {
  readonly code: number;
  /** stdout and stderr interleaved, as a user would see them in a terminal. */
  readonly output: string;
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

/** Kills a process started with {@link start}, including its children. */
export const stop = (child: ChildProcess) => {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    } else {
      process.kill(-child.pid, 'SIGTERM');
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
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output: output() }));
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
