import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { LynxGlobalData } from '../data-flow/global-data';
import { LynxSystemInfo } from '../system-info/system-info';
import {
  LynxSafeArea,
  SAFE_AREA_INSET_BOTTOM,
  SAFE_AREA_INSET_LEFT,
  SAFE_AREA_INSET_RIGHT,
  SAFE_AREA_INSET_TOP,
} from './safe-area';

describe('safe area inset constants', () => {
  it('expose the CSS env() expressions for each edge', () => {
    expect(SAFE_AREA_INSET_TOP).toBe('env(safe-area-inset-top)');
    expect(SAFE_AREA_INSET_BOTTOM).toBe('env(safe-area-inset-bottom)');
    expect(SAFE_AREA_INSET_LEFT).toBe('env(safe-area-inset-left)');
    expect(SAFE_AREA_INSET_RIGHT).toBe('env(safe-area-inset-right)');
  });
});

describe('LynxSafeArea', () => {
  /**
   * Builds a LynxSafeArea instance backed by fake LynxGlobalData (a real
   * signal, so `isNotchScreen`'s `computed()` reacts as it would for real)
   * and a fake LynxSystemInfo exposing a configurable `platform` getter.
   */
  const createSafeArea = (
    globalData: Record<string, unknown>,
    platform: string = 'iOS',
  ): LynxSafeArea => {
    const injector = Injector.create({
      providers: [
        {
          provide: LynxGlobalData,
          useValue: { globalData: signal(globalData) },
        },
        {
          provide: LynxSystemInfo,
          useValue: {
            get platform() {
              return platform;
            },
          },
        },
      ],
    });
    return runInInjectionContext(injector, () => new LynxSafeArea());
  };

  it('reports isNotchScreen true when the host flags a notch', () => {
    const safeArea = createSafeArea({ isNotchScreen: true });

    expect(safeArea.isNotchScreen()).toBe(true);
  });

  it('reports isNotchScreen false when the flag is absent from global data', () => {
    const safeArea = createSafeArea({});

    expect(safeArea.isNotchScreen()).toBe(false);
  });

  it('delegates platform to the injected LynxSystemInfo', () => {
    const safeArea = createSafeArea({}, 'Android');

    expect(safeArea.platform).toBe('Android');
  });
});
