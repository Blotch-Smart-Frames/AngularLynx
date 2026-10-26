import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CssHotUpdateOptions, createCssHotUpdate } from './css-hot-update';
import { HMR_RELOAD } from './hmr-protocol';
import { createTestContext } from './testing/test-context';

const UPDATE_PATH =
  '.lynx/main__main-thread/main__main-thread.abc.css.hot-update.json';

const setup = (
  overrides: Partial<CssHotUpdateOptions> = {},
  { hasDevtool = true } = {},
) => {
  const channel = createTestContext();
  const replaceStyleSheetByIdWithBase64 = vi.fn();
  const requireModuleAsync = vi.fn();
  const flushElementTree = vi.fn();
  const update = createCssHotUpdate({
    isMainThread: true,
    lynx: {
      requireModuleAsync,
      getDevtool: () =>
        hasDevtool ? { replaceStyleSheetByIdWithBase64 } : undefined,
      getJSContext: () => channel.context,
    },
    publicPath: 'http://dev/',
    cssHotUpdateList: () => [['main__main-thread', UPDATE_PATH]],
    flushElementTree,
    ...overrides,
  });
  return {
    ...channel,
    update,
    replaceStyleSheetByIdWithBase64,
    requireModuleAsync,
    flushElementTree,
    /** Answers the stylesheet load the updater started. */
    loaded: (error: Error | null, result?: object) => {
      const [, callback] = requireModuleAsync.mock.calls.slice(-1)[0]!;
      callback(error, result);
    },
  };
};

describe('createCssHotUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the chunk's new stylesheet and applies it in place", () => {
    const {
      update,
      requireModuleAsync,
      loaded,
      replaceStyleSheetByIdWithBase64,
      flushElementTree,
    } = setup();

    update('module', {}, '')();
    vi.runAllTimers();
    expect(requireModuleAsync).toHaveBeenCalledWith(
      `http://dev/${UPDATE_PATH}`,
      expect.any(Function),
    );
    loaded(null, { content: 'BASE64', deps: { '0': ['3'] } });

    // The stylesheets that import this one first, then this one.
    expect(replaceStyleSheetByIdWithBase64.mock.calls).toEqual([
      [3, 'BASE64'],
      [0, 'BASE64'],
    ]);
    expect(flushElementTree).toHaveBeenCalled();
  });

  it('loads the stylesheet once for the CSS modules one update replaces', () => {
    const { update, requireModuleAsync } = setup();
    const first = update('a', {}, '');
    const second = update('b', {}, '');

    first();
    second();
    vi.runAllTimers();

    expect(requireModuleAsync).toHaveBeenCalledTimes(1);
  });

  it('applies a stylesheet by its own CSS ID', () => {
    const { update, loaded, replaceStyleSheetByIdWithBase64 } = setup();

    update('module', {}, '5')();
    vi.runAllTimers();
    loaded(null, { content: 'BASE64', deps: {} });

    expect(replaceStyleSheetByIdWithBase64.mock.calls).toEqual([[5, 'BASE64']]);
  });

  it('does nothing for an update without content', () => {
    const { update, loaded, replaceStyleSheetByIdWithBase64, sent } = setup();

    update('module', {}, undefined)();
    vi.runAllTimers();
    loaded(null, { deps: {} });

    expect(replaceStyleSheetByIdWithBase64).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('does nothing without a list of stylesheet updates', () => {
    const { update, requireModuleAsync } = setup({
      cssHotUpdateList: () => null,
    });

    update('module', {}, '')();
    vi.runAllTimers();

    expect(requireModuleAsync).not.toHaveBeenCalled();
  });

  // The background thread's CSS modules don't run in an AngularLynx app's
  // updates, or have no stylesheet to apply.
  it('does nothing on the background thread', () => {
    const { update, requireModuleAsync } = setup({ isMainThread: false });

    update('module', {}, '')();
    vi.runAllTimers();

    expect(requireModuleAsync).not.toHaveBeenCalled();
  });

  describe('asking for a reload when the stylesheet can not be applied', () => {
    it('when it can not be loaded', () => {
      const { update, loaded, sentOf } = setup();

      update('module', {}, '')();
      vi.runAllTimers();
      loaded(new Error('offline'));

      expect(sentOf(HMR_RELOAD)).toEqual([
        {
          reason: expect.stringContaining(
            "Can't apply the stylesheet update: Error: offline",
          ),
        },
      ]);
    });

    it('when Lynx has no way to replace a stylesheet', () => {
      const { update, loaded, sentOf } = setup({}, { hasDevtool: false });

      update('module', {}, '')();
      vi.runAllTimers();
      loaded(null, { content: 'BASE64', deps: {} });

      expect(sentOf(HMR_RELOAD)).toEqual([
        {
          reason: expect.stringContaining(
            'replaceStyleSheetByIdWithBase64 is missing',
          ),
        },
      ]);
    });

    it('when replacing it throws', () => {
      const { update, loaded, sentOf, replaceStyleSheetByIdWithBase64 } =
        setup();
      replaceStyleSheetByIdWithBase64.mockImplementation(() => {
        throw new Error('bad buffer');
      });

      update('module', {}, '')();
      vi.runAllTimers();
      loaded(null, { content: 'BASE64', deps: {} });

      expect(sentOf(HMR_RELOAD)).toEqual([
        { reason: expect.stringContaining('bad buffer') },
      ]);
    });
  });
});
