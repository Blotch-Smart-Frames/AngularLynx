import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stands in for the element tree's flushes: the report waits for the next
 * one, which a test runs with flush().
 */
const { flushes, callOnBackground } = vi.hoisted(() => ({
  flushes: [] as (() => void)[],
  callOnBackground: vi.fn(() => Promise.resolve()),
}));
vi.mock('../lynx-element/lynx-element', () => ({
  afterNextFlush: (callback: () => void) => flushes.push(callback),
}));
vi.mock('../background-call', () => ({ callOnBackground }));
const flush = () => {
  for (const callback of flushes.splice(0)) callback();
};

import { reportFullyDrawn, resetFullyDrawnForTesting } from './fully-drawn';

describe('reportFullyDrawn', () => {
  beforeEach(() => {
    flushes.length = 0;
    callOnBackground.mockClear();
    resetFullyDrawnForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the shell’s module from the main thread after the next flush', () => {
    const invoke = vi.fn();
    const module = vi.fn(() => ({ invoke }));
    vi.stubGlobal('lynx', { module });
    reportFullyDrawn();
    // Not before native has what the app just rendered.
    expect(invoke).not.toHaveBeenCalled();
    flush();
    expect(module).toHaveBeenCalledWith('AngularLynxShell');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('reportFullyDrawn');
    expect(callOnBackground).not.toHaveBeenCalled();
  });

  it('reports once per process', () => {
    const invoke = vi.fn();
    vi.stubGlobal('lynx', { module: () => ({ invoke }) });
    reportFullyDrawn();
    reportFullyDrawn();
    flush();
    reportFullyDrawn();
    flush();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('goes through the background thread without main-thread modules', () => {
    vi.stubGlobal('lynx', undefined);
    reportFullyDrawn();
    flush();
    expect(callOnBackground).toHaveBeenCalledExactlyOnceWith(
      'callModule',
      'native',
      'AngularLynxShell',
      'reportFullyDrawn',
      [],
    );
  });

  it('goes through the background thread when the module is missing or throws', () => {
    vi.stubGlobal('lynx', {
      module: () => {
        throw new Error('no module');
      },
    });
    reportFullyDrawn();
    flush();
    expect(callOnBackground).toHaveBeenCalledOnce();

    resetFullyDrawnForTesting();
    vi.stubGlobal('lynx', { module: () => ({}) });
    reportFullyDrawn();
    flush();
    expect(callOnBackground).toHaveBeenCalledTimes(2);

    // A shell from before the method, whose module throws on it.
    resetFullyDrawnForTesting();
    vi.stubGlobal('lynx', {
      module: () => ({
        invoke: () => {
          throw new Error('no method');
        },
      }),
    });
    reportFullyDrawn();
    flush();
    expect(callOnBackground).toHaveBeenCalledTimes(3);
  });

  it('ignores a host that rejects the background call', async () => {
    vi.stubGlobal('lynx', undefined);
    callOnBackground.mockReturnValueOnce(Promise.reject(new Error('no shell')));
    reportFullyDrawn();
    flush();
    await Promise.resolve();
    expect(callOnBackground).toHaveBeenCalledOnce();
  });

  it('does nothing under the testing library', () => {
    vi.stubGlobal('lynxTestingEnv', {});
    reportFullyDrawn();
    expect(flushes).toHaveLength(0);
  });
});
