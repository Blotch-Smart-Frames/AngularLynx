import { FIXTURE_ORIGIN } from './fixtureOrigin';

const BASE_URL = `${FIXTURE_ORIGIN}/api/v2`;
// The original's axios timeout.
const TIMEOUT_MS = 10000;

/**
 * GET a JSON resource from the fixture API, as the original's axios client
 * does. axios can't run here: it needs XMLHttpRequest, or fetch with the
 * `Request` and `Response` constructors, and Lynx's background thread has
 * only `fetch` itself. So this is the subset of axios the app uses: a base
 * URL, query params, a 10 s timeout, and a rejection for a non-2xx status
 * (which React Query then retries).
 */
export const apiGet = async <T>(
  path: string,
  params?: Record<string, string | number>,
): Promise<T> => {
  const query = params
    ? '?' +
      Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')
    : '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout of ${TIMEOUT_MS}ms exceeded`)), TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([fetch(`${BASE_URL}${path}${query}`), timeout]);
    if (!response.ok) {
      throw new Error(`Request failed with status code ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};
