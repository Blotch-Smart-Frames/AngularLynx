import { computed } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxSystemInfo } from './system-info';

// The relay to the background thread, which the main thread asks for the OS
// version. Off the main thread (the default here) nothing calls it.
const background = vi.hoisted(() => ({
  isMainThread: vi.fn(() => false),
  callOnBackground: vi.fn(),
}));
vi.mock('../background-call', () => background);

describe('LynxSystemInfo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('when SystemInfo is unavailable', () => {
    it('constructor throws', () => {
      expect(() => new LynxSystemInfo()).toThrow('SystemInfo is not available');
    });
  });

  describe('when SystemInfo is available', () => {
    const mockSystemInfo = {
      engineVersion: '3.2',
      lynxSdkVersion: '3.2',
      osVersion: '18.0',
      pixelWidth: 1170,
      pixelHeight: 2532,
      pixelRatio: 3,
      platform: 'iOS' as const,
      runtimeType: 'jsc' as const,
      theme: { mode: 'light' },
    };

    beforeEach(() => {
      vi.stubGlobal('SystemInfo', mockSystemInfo);
    });

    it('exposes platform', () => {
      const service = new LynxSystemInfo();
      expect(service.platform).toBe('iOS');
    });

    it('exposes engineVersion', () => {
      const service = new LynxSystemInfo();
      expect(service.engineVersion).toBe('3.2');
    });

    it('exposes osVersion', () => {
      const service = new LynxSystemInfo();
      expect(service.osVersion).toBe('18.0');
    });

    it('exposes pixelWidth', () => {
      const service = new LynxSystemInfo();
      expect(service.pixelWidth).toBe(1170);
    });

    it('exposes pixelHeight', () => {
      const service = new LynxSystemInfo();
      expect(service.pixelHeight).toBe(2532);
    });

    it('exposes pixelRatio', () => {
      const service = new LynxSystemInfo();
      expect(service.pixelRatio).toBe(3);
    });

    it('exposes runtimeType', () => {
      const service = new LynxSystemInfo();
      expect(service.runtimeType).toBe('jsc');
    });

    it('computes screenWidth as pixelWidth / pixelRatio', () => {
      const service = new LynxSystemInfo();
      expect(service.screenWidth).toBe(390);
    });

    it('computes screenHeight as pixelHeight / pixelRatio', () => {
      const service = new LynxSystemInfo();
      expect(service.screenHeight).toBe(844);
    });

    it('exposes theme object', () => {
      const service = new LynxSystemInfo();
      expect(service.theme).toEqual({ mode: 'light' });
    });

    it('returns undefined theme when not provided', () => {
      vi.stubGlobal('SystemInfo', { ...mockSystemInfo, theme: undefined });
      const service = new LynxSystemInfo();
      expect(service.theme).toBeUndefined();
    });
  });

  describe('on the native main thread, which has only lynx.SystemInfo', () => {
    it('reads lynx.SystemInfo', () => {
      vi.stubGlobal('lynx', { SystemInfo: { platform: 'Android' } });

      expect(new LynxSystemInfo().platform).toBe('Android');
    });

    it('prefers lynx.SystemInfo over the global', () => {
      vi.stubGlobal('lynx', { SystemInfo: { platform: 'Android' } });
      vi.stubGlobal('SystemInfo', { platform: 'iOS' });

      expect(new LynxSystemInfo().platform).toBe('Android');
    });

    it('falls back to the global when lynx has no SystemInfo', () => {
      vi.stubGlobal('lynx', {});
      vi.stubGlobal('SystemInfo', { platform: 'iOS' });

      expect(new LynxSystemInfo().platform).toBe('iOS');
    });
  });

  describe('osVersion on the native main thread, whose SystemInfo has none', () => {
    afterEach(() => {
      background.isMainThread.mockReset().mockReturnValue(false);
      background.callOnBackground.mockReset();
    });

    it("takes the host's osVersion global prop", () => {
      vi.stubGlobal('lynx', {
        SystemInfo: { platform: 'iOS' },
        __globalProps: { osVersion: '26.2' },
      });

      expect(new LynxSystemInfo().osVersion).toBe('26.2');
    });

    it('ignores a global prop that is not a version', () => {
      vi.stubGlobal('lynx', {
        SystemInfo: { platform: 'iOS' },
        __globalProps: { osVersion: 26 },
      });

      expect(new LynxSystemInfo().osVersion).toBe('');
    });

    it('is empty without global props, off the main thread', () => {
      vi.stubGlobal('SystemInfo', { platform: 'iOS' });

      expect(new LynxSystemInfo().osVersion).toBe('');
      expect(background.callOnBackground).not.toHaveBeenCalled();
    });

    it('asks the background thread on the main thread, and computed() sees the answer', async () => {
      background.isMainThread.mockReturnValue(true);
      background.callOnBackground.mockResolvedValue('18.4');
      vi.stubGlobal('lynx', { SystemInfo: { platform: 'iOS' } });

      const info = new LynxSystemInfo();
      const major = computed(() => info.osVersion.split('.')[0]);
      expect(major()).toBe('');

      await Promise.resolve();
      expect(background.callOnBackground).toHaveBeenCalledWith('osVersion');
      expect(major()).toBe('18');
    });

    it('stays empty when the background thread has no version or no answer', async () => {
      background.isMainThread.mockReturnValue(true);
      background.callOnBackground
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('no background thread'));
      vi.stubGlobal('lynx', { SystemInfo: { platform: 'Android' } });

      const first = new LynxSystemInfo();
      const second = new LynxSystemInfo();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(first.osVersion).toBe('');
      expect(second.osVersion).toBe('');
    });
  });
});
