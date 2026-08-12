import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { reportToNative as ReportToNativeFn } from './error-reporting';

describe('error-reporting', () => {
  let reportToNative: typeof ReportToNativeFn;

  beforeEach(async () => {
    // Delete the handlers/globals so a fresh import re-registers them and reseeds
    // __lynxLastError, and so the `typeof onerror !== 'function'` guards pass.
    delete (globalThis as any).onerror;
    delete (globalThis as any).onunhandledrejection;
    delete (globalThis as any).__lynxLastError;
    delete (globalThis as any)._ReportError;

    vi.resetModules();
    const mod = await import('./error-reporting');
    reportToNative = mod.reportToNative;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).onerror;
    delete (globalThis as any).onunhandledrejection;
    delete (globalThis as any).__lynxLastError;
    delete (globalThis as any)._ReportError;
  });

  it('seeds __lynxLastError to an empty string on load', () => {
    expect((globalThis as any).__lynxLastError).toBe('');
  });

  describe('reportToNative', () => {
    it('forwards the error to _ReportError with errorCode 1101 when defined', () => {
      const report = vi.fn();
      (globalThis as any)._ReportError = report;
      const err = new Error('report me');
      reportToNative(err);
      expect(report).toHaveBeenCalledWith(err, { errorCode: 1101 });
    });

    it('is a no-op when _ReportError is undefined', () => {
      expect(() => reportToNative(new Error('no reporter'))).not.toThrow();
    });

    it('is a no-op when _ReportError is not a function', () => {
      (globalThis as any)._ReportError = 'not-a-function';
      expect(() => reportToNative(new Error('bad reporter'))).not.toThrow();
    });
  });

  describe('onerror handler', () => {
    it('sets __lynxLastError from the provided Error object', () => {
      const err = new Error('boom');
      (globalThis as any).onerror('boom', '', 0, 0, err);
      expect((globalThis as any).__lynxLastError).toContain('Error: boom');
    });

    it('constructs an Error from the message when no Error object is provided', () => {
      (globalThis as any).onerror('bare message', '', 0, 0, undefined);
      expect((globalThis as any).__lynxLastError).toContain('bare message');
    });

    it('tolerates an Error with no stack (falls back to empty string)', () => {
      const err = new Error('no stack');
      err.stack = undefined;
      (globalThis as any).onerror('no stack', '', 0, 0, err);
      // Ends with the trailing newline the template adds before the empty stack.
      expect((globalThis as any).__lynxLastError).toBe('Error: no stack\n');
    });

    it('forwards to _ReportError when defined', () => {
      const report = vi.fn();
      (globalThis as any)._ReportError = report;
      const err = new Error('reported');
      (globalThis as any).onerror('reported', '', 0, 0, err);
      expect(report).toHaveBeenCalledWith(err, { errorCode: 1101 });
    });
  });

  describe('onunhandledrejection handler', () => {
    it('sets __lynxLastError when the rejection reason is an Error', () => {
      const err = new Error('rejected');
      (globalThis as any).onunhandledrejection({ reason: err });
      expect((globalThis as any).__lynxLastError).toContain('Error: rejected');
    });

    it('wraps non-Error rejection reasons in a descriptive Error', () => {
      (globalThis as any).onunhandledrejection({ reason: 'string reason' });
      expect((globalThis as any).__lynxLastError).toContain(
        'Unhandled rejection: string reason',
      );
    });

    it('handles a missing event object via optional chaining', () => {
      (globalThis as any).onunhandledrejection(undefined);
      expect((globalThis as any).__lynxLastError).toContain(
        'Unhandled rejection: undefined',
      );
    });

    it('tolerates an Error reason with no stack', () => {
      const err = new Error('no stack');
      err.stack = undefined;
      (globalThis as any).onunhandledrejection({ reason: err });
      expect((globalThis as any).__lynxLastError).toBe('Error: no stack\n');
    });
  });

  describe('host-provided handlers', () => {
    it('does not overwrite an onerror handler the host already installed', async () => {
      const existing = vi.fn();
      (globalThis as any).onerror = existing;
      vi.resetModules();
      await import('./error-reporting');
      expect((globalThis as any).onerror).toBe(existing);
    });

    it('does not overwrite an existing onunhandledrejection handler', async () => {
      const existing = vi.fn();
      (globalThis as any).onunhandledrejection = existing;
      vi.resetModules();
      await import('./error-reporting');
      expect((globalThis as any).onunhandledrejection).toBe(existing);
    });
  });
});
