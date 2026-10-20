// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { GlassManager } from './glass-manager';
import { attachWebGlass } from './web-glass';

const register = vi.fn();

vi.mock('./glass-manager', () => ({
  GlassManager: { for: vi.fn(() => ({ register })) },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('attachWebGlass', () => {
  it('registers a page element with its window’s manager', () => {
    vi.stubGlobal('IntersectionObserver', class {});
    const element = document.createElement('x-blur-view');
    attachWebGlass(element as unknown as ElementRef);
    expect(GlassManager.for).toHaveBeenCalledWith(window);
    expect(register).toHaveBeenCalledWith(element);
  });

  it('ignores refs that are not elements in a page', () => {
    attachWebGlass({} as ElementRef);
    expect(register).not.toHaveBeenCalled();
  });

  it('ignores browsers without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    attachWebGlass(
      document.createElement('x-blur-view') as unknown as ElementRef,
    );
    expect(register).not.toHaveBeenCalled();
  });

  it('never lets the glass break rendering', () => {
    vi.stubGlobal('IntersectionObserver', class {});
    register.mockImplementationOnce(() => {
      throw new Error('no WebGL here');
    });
    expect(() =>
      attachWebGlass(
        document.createElement('x-blur-view') as unknown as ElementRef,
      ),
    ).not.toThrow();
  });
});
