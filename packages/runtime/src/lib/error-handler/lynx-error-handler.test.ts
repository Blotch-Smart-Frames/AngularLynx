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

    it('falls back to an empty string when the Error has no stack', () => {
      // Errors reconstructed on the native side sometimes lack a `stack`
      // property. The `?? ''` fallback prevents `undefined` from being
      // concatenated into the debug string.
      const err = new Error('no stack');
      // Deleting the own `stack` property makes it undefined without breaking
      // the prototype chain that instanceof checks against.
      Object.defineProperty(err, 'stack', {
        value: undefined,
        configurable: true,
      });
      handler.handleError(err);
      expect((globalThis as any).__lynxLastError).toBe('Error: no stack\n');
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

  describe('onViewError', () => {
    // A minimal ErrorDetails — the handler ignores it, but Angular always
    // passes one, so the tests mirror the real call shape.
    const details = {
      declarationType: class {},
      declarationInstance: {},
    };

    afterEach(() => {
      delete (globalThis as any).lynx;
    });

    it('writes the caught error to __lynxLastError', () => {
      handler.onViewError(new Error('caught by boundary'), details);
      expect((globalThis as any).__lynxLastError).toContain(
        'Error: caught by boundary',
      );
    });

    it('reports to lynx.reportError at warning level', () => {
      const reportError = vi.fn();
      (globalThis as any).lynx = { reportError };

      const err = new Error('recovered');
      handler.onViewError(err, details);

      expect(reportError).toHaveBeenCalledWith(err, { level: 'warning' });
    });

    it('never calls the fatal _ReportError for a caught error', () => {
      // The boundary already rendered its fallback — escalating to the fatal
      // LEPUS channel would raise the on-device red error overlay.
      const fatal = vi.fn();
      (globalThis as any)._ReportError = fatal;
      (globalThis as any).lynx = { reportError: vi.fn() };

      handler.onViewError(new Error('recovered'), details);

      expect(fatal).not.toHaveBeenCalled();
    });

    it('does not throw outside the Lynx runtime (no lynx global)', () => {
      expect(() =>
        handler.onViewError(new Error('off device'), details),
      ).not.toThrow();
    });

    it('does not throw when lynx.reportError is unavailable (older runtimes)', () => {
      (globalThis as any).lynx = {};
      expect(() =>
        handler.onViewError(new Error('old runtime'), details),
      ).not.toThrow();
    });
  });
});
