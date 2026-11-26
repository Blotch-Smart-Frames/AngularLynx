import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoverViewElement } from './create-cover-view-element';
import { createTitleBarViewElement } from './create-title-bar-view-element';

const element = { tag: 'native' };
const view = { tag: 'view' };

beforeEach(() => {
  vi.stubGlobal(
    '__CreateElement',
    vi.fn(() => element),
  );
  vi.stubGlobal(
    '__CreateView',
    vi.fn(() => view),
  );
  vi.stubGlobal('__WEB__', false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe.each([
  ['title-bar-view', createTitleBarViewElement],
  ['cover-view', createCoverViewElement],
] as const)('%s', (tag, create) => {
  it.each(['windows', 'macOS'])('is the native element on %s', (platform) => {
    vi.stubGlobal('SystemInfo', { platform });
    expect(create(3)).toBe(element);
    expect(__CreateElement).toHaveBeenCalledWith(tag, 3);
  });

  // The native main thread has only lynx.SystemInfo, no global.
  it('reads the platform from lynx.SystemInfo on the native main thread', () => {
    vi.stubGlobal('lynx', { SystemInfo: { platform: 'macOS' } });
    expect(create(3)).toBe(element);
  });

  // iOS draws nothing for a tag it has no UI for, children included (#678).
  it.each(['iOS', 'Android', 'Harmony'])(
    'is a view on %s, which has no %s',
    (platform) => {
      vi.stubGlobal('SystemInfo', { platform });
      expect(create(3)).toBe(view);
      expect(__CreateView).toHaveBeenCalledWith(3);
      expect(__CreateElement).not.toHaveBeenCalled();
    },
  );

  it('is a view in the web preview', () => {
    vi.stubGlobal('__WEB__', true);
    vi.stubGlobal('SystemInfo', { platform: 'macOS' });
    expect(create(3)).toBe(view);
  });

  it('is a view when the platform is unknown', () => {
    vi.stubGlobal('SystemInfo', undefined);
    expect(create(3)).toBe(view);
  });
});
