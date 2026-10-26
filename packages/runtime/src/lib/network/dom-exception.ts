/**
 * Legacy error codes of the DOMException names code here can raise, which
 * older code still checks (`error.code === 20` for an abort).
 */
const CODES: Record<string, number> = {
  NotSupportedError: 9,
  InvalidStateError: 11,
  SyntaxError: 12,
  InvalidAccessError: 15,
  NetworkError: 19,
  AbortError: 20,
  TimeoutError: 23,
};

/**
 * `DOMException` for Lynx's main thread, which has none. Angular's HTTP
 * backends create one when a request times out
 * (`new DOMException('signal timed out', 'TimeoutError')`); without the
 * global, that line threw a ReferenceError in a timer instead of failing the
 * request.
 */
export class LynxDOMException extends Error {
  readonly code: number;

  constructor(message = '', name = 'Error') {
    super(message);
    this.name = name;
    this.code = CODES[name] ?? 0;
  }
}
