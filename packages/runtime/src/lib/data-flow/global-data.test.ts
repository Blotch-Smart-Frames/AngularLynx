import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { LynxGlobalData } from './global-data';
import { globalDataUpdates } from './host-updates';

/**
 * Creates the service in an injection context, as the app's root injector
 * does, so the test can also destroy that injector.
 */
const create = (): { service: LynxGlobalData; injector: Injector } => {
  const injector = Injector.create({ providers: [] });
  return {
    service: runInInjectionContext(injector, () => new LynxGlobalData()),
    injector,
  };
};

describe('LynxGlobalData', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  describe('seeding', () => {
    it('starts as an empty object when lynx is not defined', () => {
      expect(create().service.globalData()).toEqual({});
    });

    it('starts as an empty object when the host sets no global props, so readers can index into it', () => {
      (globalThis as any).lynx = {};

      expect(create().service.globalData()).toEqual({});
    });

    it('starts with lynx.__globalProps', () => {
      (globalThis as any).lynx = { __globalProps: { theme: 'Dark' } };

      expect(create().service.globalData()).toEqual({ theme: 'Dark' });
    });
  });

  describe('host updates', () => {
    it('takes each update published by the engine callbacks', () => {
      const { service } = create();

      globalDataUpdates.next({ theme: 'Light', appLocale: 'fr-FR' });

      expect(service.globalData()).toEqual({
        theme: 'Light',
        appLocale: 'fr-FR',
      });
    });

    it('stops listening when its injector is destroyed', () => {
      (globalThis as any).lynx = { __globalProps: { theme: 'Dark' } };
      const { service, injector } = create();

      (injector as unknown as { destroy(): void }).destroy();
      globalDataUpdates.next({ theme: 'Light' });

      expect(service.globalData()).toEqual({ theme: 'Dark' });
    });
  });
});
