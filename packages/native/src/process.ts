import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** A native build step failed. The message ends with the log's last lines. */
export class NativeBuildError extends Error {}

/** How many log lines a failure message quotes. */
const TAIL_LINES = 40;
const MAX_ERROR_LINES = 20;
/** clang/swiftc/javac/kotlinc diagnostics and xcodebuild's own errors. */
const ERROR_LINE = /(^|:\d+(:\d+)?:\s|^\s*e:\s)error:|^error:|^e: /;

/**
 * Runs a native tool with its output going to `logFile` rather than the
 * terminal. xcodebuild and Gradle print thousands of lines on success, which
 * would bury the builder's own progress; on failure, the end of the log is
 * almost always the error, so that's what the thrown error quotes.
 */
export const run = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly logFile: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<void> => {
  mkdirSync(path.dirname(options.logFile), { recursive: true });
  appendFileSync(
    options.logFile,
    `\n$ ${[command, ...args].join(' ')}\n  (in ${options.cwd})\n`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const recent: string[] = [];
    const errors = new Set<string>();
    let partial = '';
    const record = (chunk: Buffer) => {
      appendFileSync(options.logFile, chunk);
      const lines = (partial + chunk.toString()).split('\n');
      partial = lines.pop()!;
      for (const line of lines) {
        // Compiler diagnostics ("file.swift:12:8: error: ...") say what went
        // wrong far better than the end of the log, which for xcodebuild is
        // usually a multi-kilobyte command line.
        if (ERROR_LINE.test(line) && errors.size < MAX_ERROR_LINES) {
          errors.add(line.trim());
        }
      }
      recent.push(...lines);
      recent.splice(0, Math.max(0, recent.length - TAIL_LINES));
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    child.on('error', (error) =>
      reject(
        new NativeBuildError(`Could not run ${command}: ${error.message}`),
      ),
    );
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail =
        errors.size > 0
          ? `The errors:\n\n${[...errors].join('\n')}`
          : `Its last lines:\n\n${[...recent, partial].join('\n').trim()}`;
      reject(
        new NativeBuildError(
          `${command} ${args[0] ?? ''} failed (exit code ${code}). The full log is ${options.logFile}. ${detail}`,
        ),
      );
    });
  });
};

/** Runs a command and returns its stdout, or undefined if it fails. */
export const capture = (
  command: string,
  args: readonly string[],
): Promise<string | undefined> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => resolve(code === 0 ? output : undefined));
  });
