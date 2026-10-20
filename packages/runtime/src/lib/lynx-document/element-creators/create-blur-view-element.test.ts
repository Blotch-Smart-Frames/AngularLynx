import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachWebGlass } from '../../web-glass/web-glass';
import { createBlurViewElement } from './create-blur-view-element';

vi.mock('../../web-glass/web-glass', () => ({ attachWebGlass: vi.fn() }));

const ref = { tag: 'blur-view' };

/**
 * The glass module loads through a dynamic import, so it attaches a few
 * microtasks after the element is created.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
  vi.stubGlobal(
    '__CreateElement',
    vi.fn(() => ref),
  );
  vi.stubGlobal('__MAIN_THREAD__', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('createBlurViewElement', () => {
  it('creates a native blur-view', () => {
    expect(createBlurViewElement(3)).toBe(ref);
    expect(__CreateElement).toHaveBeenCalledWith('blur-view', 3);
  });

  it('leaves the glass to the platform on native', async () => {
    vi.stubGlobal('__WEB__', false);
    createBlurViewElement(3);
    await settle();
    expect(attachWebGlass).not.toHaveBeenCalled();
  });

  it('leaves web’s background thread alone', async () => {
    vi.stubGlobal('__WEB__', true);
    vi.stubGlobal('__MAIN_THREAD__', false);
    createBlurViewElement(3);
    await settle();
    expect(attachWebGlass).not.toHaveBeenCalled();
  });

  it('draws the glass itself on web', async () => {
    vi.stubGlobal('__WEB__', true);
    createBlurViewElement(3);
    await settle();
    expect(attachWebGlass).toHaveBeenCalledWith(ref);
  });

  it('keeps rendering if the glass module fails', async () => {
    vi.stubGlobal('__WEB__', true);
    vi.mocked(attachWebGlass).mockImplementationOnce(() => {
      throw new Error('no glass');
    });
    expect(createBlurViewElement(3)).toBe(ref);
    await settle();
    expect(attachWebGlass).toHaveBeenCalled();
  });
});
