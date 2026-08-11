import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxSystemInfo } from './system-info';

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
});
