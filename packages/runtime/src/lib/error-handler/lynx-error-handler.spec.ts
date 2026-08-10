import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxErrorHandler } from './lynx-error-handler';

describe('LynxErrorHandler', () => {
  let handler: LynxErrorHandler;

  beforeEach(() => {
    handler = new LynxErrorHandler();
    delete (globalThis as any).__lynxLastError;
    delete (globalThis as any)._ReportError;
  });

  afterEach(() => {
    delete (globalThis as any).__lynxLastError;
    delete (globalThis as any)._ReportError;
  });

  describe('__lynxLastError', () => {
    it('sets __lynxLastError from an Error instance', () => {
      const err = new Error('boom');
      handler.handleError(err);
      expect((globalThis as any).__lynxLastError).toContain('Error: boom');
    });

    it('includes the stack trace when present', () => {
      const err = new Error('with stack');
      handler.handleError(err);
      expect((globalThis as any).__lynxLastError).toContain(err.stack ?? '');
    });

    it('coerces a non-Error value to Error before writing __lynxLastError', () => {
      handler.handleError('plain string error');
      expect((globalThis as any).__lynxLastError).toContain(
        'plain string error',
      );
    });

    it('coerces a number to a string', () => {
      handler.handleError(42);
      expect((globalThis as any).__lynxLastError).toContain('42');
    });

    it('coerces null to a string', () => {
      handler.handleError(null);
      expect((globalThis as any).__lynxLastError).toContain('null');
    });

    it('uses the Error name in the __lynxLastError string', () => {
      class CustomError extends Error {
        override name = 'CustomError';
      }
      handler.handleError(new CustomError('custom'));
      expect((globalThis as any).__lynxLastError).toMatch(/^CustomError:/);
    });
  });

  describe('_ReportError', () => {
    it('calls _ReportError with the error and errorCode 1101 when defined', () => {
      const reportError = vi.fn();
      (globalThis as any)._ReportError = reportError;

      const err = new Error('reported');
      handler.handleError(err);

      expect(reportError).toHaveBeenCalledOnce();
      expect(reportError).toHaveBeenCalledWith(err, { errorCode: 1101 });
    });

    it('passes a synthesized Error (not the raw value) to _ReportError for non-Error inputs', () => {
      const reportError = vi.fn();
      (globalThis as any)._ReportError = reportError;

      handler.handleError('raw string');

      const [passedErr] = reportError.mock.calls[0];
      expect(passedErr).toBeInstanceOf(Error);
      expect(passedErr.message).toBe('raw string');
    });

    it('does not throw when _ReportError is not defined', () => {
      expect(() => handler.handleError(new Error('no reporter'))).not.toThrow();
    });

    it('does not call _ReportError when it is not a function', () => {
      // Guard against accidental global pollution where _ReportError is e.g. a number.
      (globalThis as any)._ReportError = 'not-a-function';
      expect(() =>
        handler.handleError(new Error('non-fn reporter')),
      ).not.toThrow();
    });
  });
});
