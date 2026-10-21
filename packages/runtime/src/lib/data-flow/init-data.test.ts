import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { initDataUpdates } from './host-updates';
import { LynxInitData } from './init-data';

/**
 * Creates the service in an injection context, as the app's root injector
 * does, so the test can also destroy that injector.
 */
const create = (): { service: LynxInitData; injector: Injector } => {
  const injector = Injector.create({ providers: [] });
  return {
    service: runInInjectionContext(injector, () => new LynxInitData()),
    injector,
  };
};

describe('LynxInitData', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  describe('seeding', () => {
    it('starts as an empty object when lynx is not defined', () => {
      expect(create().service.initData()).toEqual({});
    });

    it('starts as an empty object when lynx.__initData is undefined', () => {
      (globalThis as any).lynx = {};

      expect(create().service.initData()).toEqual({});
    });

    it('starts with lynx.__initData', () => {
      (globalThis as any).lynx = { __initData: { userId: 'abc' } };

      expect(create().service.initData()).toEqual({ userId: 'abc' });
    });
  });

  describe('host updates', () => {
    it('takes each update published by the engine callbacks', () => {
      const { service } = create();

      initDataUpdates.next({ userId: 'xyz', role: 'admin' });

      expect(service.initData()).toEqual({ userId: 'xyz', role: 'admin' });
    });

    it('stops listening when its injector is destroyed', () => {
      (globalThis as any).lynx = { __initData: { userId: 'abc' } };
      const { service, injector } = create();

      (injector as unknown as { destroy(): void }).destroy();
      initDataUpdates.next({ userId: 'xyz' });

      expect(service.initData()).toEqual({ userId: 'abc' });
    });
  });
});
