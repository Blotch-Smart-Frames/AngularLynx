import { type MonoTypeOperatorFunction, retry, timer } from 'rxjs';

/**
 * Retries a failed request twice, waiting 1 s and then 2 s, as React Query's
 * defaults in the original do (`retry: 2`, with its exponential delay).
 */
export const retryTwice = <T>(): MonoTypeOperatorFunction<T> =>
  retry({
    count: 2,
    delay: (_error, attempt) => timer(Math.min(1000 * 2 ** (attempt - 1), 30_000)),
  });
