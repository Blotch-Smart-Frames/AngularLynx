import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from './logger';

// logger is a thin console.log wrapper — the only thing worth asserting is
// that each method logs (so callers see output) and that the message text is
// present in what was logged (the color codes are picocolors' concern, not
// ours, and are exercised for free either way).
describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('success logs a checkmark-prefixed message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.success('done');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('done');
  });

  it('info logs the message as-is', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('hello');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('hello');
  });

  it('warn logs a warning-prefixed message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.warn('careful');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('careful');
  });

  it('error logs an error-prefixed message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.error('broken');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('broken');
  });
});
