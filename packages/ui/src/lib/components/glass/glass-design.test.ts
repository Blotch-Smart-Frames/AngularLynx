import { Injector, runInInjectionContext } from '@angular/core';
import { LynxSystemInfo } from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  glassDesignFor,
  injectGlassDesign,
  injectSystemDrawsGlass,
  provideGlass,
  UI_GLASS_OPTIONS,
} from './glass-design';

describe('glassDesignFor', () => {
  it('gives iOS 26 and later Liquid Glass, and earlier iOS the frosted materials', () => {
    expect(glassDesignFor('iOS', '26.0', {})).toBe('glass');
    expect(glassDesignFor('iOS', '27.1', {})).toBe('glass');
    expect(glassDesignFor('iOS', '25.4', {})).toBe('frosted');
    expect(glassDesignFor('iOS', '15.0', {})).toBe('frosted');
  });

  it('counts an iOS version not known yet as current', () => {
    expect(glassDesignFor('iOS', '', {})).toBe('glass');
  });

  it('gives Android Material unless the app opts into glass', () => {
    expect(glassDesignFor('Android', '15', {})).toBe('material');
    expect(glassDesignFor('Android', '15', { android: 'glass' })).toBe('glass');
  });

  it('draws glass in the web preview, and Material where there is none', () => {
    expect(glassDesignFor('web', '', {})).toBe('glass');
    expect(glassDesignFor('Harmony', '5.0', { android: 'glass' })).toBe(
      'material',
    );
    expect(glassDesignFor(undefined, '', {})).toBe('material');
  });
});

describe('provideGlass', () => {
  it('provides the options', () => {
    expect(provideGlass({ android: 'glass' })).toEqual({
      provide: UI_GLASS_OPTIONS,
      useValue: { android: 'glass' },
    });
  });
});

describe('injectGlassDesign', () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * Runs `fn` in an injector. A plain injector has no root scope, so it gets
   * LynxSystemInfo, which the app's root injector would make, explicitly.
   */
  const inject = <T>(fn: () => T, options = {}) =>
    runInInjectionContext(
      Injector.create({
        providers: [
          LynxSystemInfo,
          { provide: UI_GLASS_OPTIONS, useValue: options },
        ],
      }),
      fn,
    );

  it("reads the platform and version from SystemInfo, with the app's options", () => {
    vi.stubGlobal('SystemInfo', { platform: 'Android', osVersion: '14' });

    expect(inject(injectGlassDesign)()).toBe('material');
    expect(inject(injectGlassDesign, { android: 'glass' })()).toBe('glass');
    expect(inject(injectSystemDrawsGlass)).toBe(false);
  });

  it('knows that iOS draws its own glass', () => {
    vi.stubGlobal('SystemInfo', { platform: 'iOS', osVersion: '26.0' });

    expect(inject(injectSystemDrawsGlass)).toBe(true);
  });
});
