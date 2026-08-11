import { availableParallelism } from 'node:os';

/**
 * Returns true only for non-empty string values — filters out undefined and `""`.
 */
const isPresent = (variable: string | undefined): variable is string => {
  return typeof variable === 'string' && variable !== '';
};

/**
 * Returns true when the variable represents a falsy intent.
 * Accepts `"0"` (Unix convention) and `"false"` (case-insensitive) so callers
 * can opt out with either style.
 */
const isDisabled = (variable: string): boolean => {
  return variable === '0' || variable.toLowerCase() === 'false';
};

/**
 * Maximum number of parallel worker threads used during Angular compilation.
 *
 * Reads `NG_BUILD_MAX_WORKERS`. When unset the default is capped at 4 to avoid
 * memory pressure on machines with many cores — Angular's compiler is
 * memory-intensive and spawning more than 4 workers rarely improves throughput.
 * At least 1 worker is guaranteed even on single-core machines.
 */
const maxWorkersVariable = process.env.NG_BUILD_MAX_WORKERS;
export const maxWorkers: number = isPresent(maxWorkersVariable)
  ? +maxWorkersVariable
  : Math.min(4, Math.max(availableParallelism() - 1, 1));

/**
 * Whether TypeScript type checking runs during the build.
 *
 * Reads `NG_BUILD_TYPE_CHECK`. Defaults to `true` so type errors surface in CI
 * without any explicit configuration. Set to `"0"` or `"false"` to skip type
 * checking for faster incremental builds during local development.
 */
const typeCheckingVariable = process.env.NG_BUILD_TYPE_CHECK;
export const useTypeChecking: boolean =
  !isPresent(typeCheckingVariable) || !isDisabled(typeCheckingVariable);
