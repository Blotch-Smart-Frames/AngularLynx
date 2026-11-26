import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxHaptics } from './haptics';

type Done = (result: object) => void;

const createHaptics = () =>
  Injector.create({ providers: [LynxHaptics] }).get(LynxHaptics);

/**
 * Stands in for the shells' AngularLynxHaptics module, as the background
 * thread sees it: each method calls back once. Unit tests run as the
 * background thread, so the service calls it directly.
 */
const stubModule = () => {
  const module = {
    impact: vi.fn((_style: string, done: Done) => done({})),
    selection: vi.fn((done: Done) => done({})),
    notification: vi.fn((_type: string, done: Done) => done({})),
  };
  vi.stubGlobal('NativeModules', { AngularLynxHaptics: module });
  return module;
};

/**
 * The page around web-core's main-thread iframe.
 */
const stubPage = (vibrate?: (pattern: number | number[]) => boolean) => {
  const page = { navigator: { vibrate: vibrate && vi.fn(vibrate) } };
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  vi.stubGlobal('parent', page);
  return page;
};

/**
 * Lets the call to the background thread settle.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LynxHaptics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('with the native module', () => {
    it('plays each kind of feedback through the module', () => {
      const module = stubModule();
      const haptics = createHaptics();

      haptics.impact('heavy');
      haptics.selection();
      haptics.notification('error');

      expect(module.impact).toHaveBeenCalledWith('heavy', expect.any(Function));
      expect(module.selection).toHaveBeenCalledWith(expect.any(Function));
      expect(module.notification).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
    });

    it('taps medium and reports success unless told otherwise', () => {
      const module = stubModule();
      const haptics = createHaptics();

      haptics.impact();
      haptics.notification();
      // A value from untyped code isn't passed on as a kind the shells
      // don't know.
      haptics.impact('loud' as 'light');
      haptics.notification('done' as 'success');

      expect(module.impact.mock.calls.map(([style]) => style)).toEqual([
        'medium',
        'medium',
      ]);
      expect(module.notification.mock.calls.map(([type]) => type)).toEqual([
        'success',
        'success',
      ]);
    });
  });

  describe('without the native module', () => {
    it('does nothing, and stops asking the background thread', async () => {
      const modules = {} as Record<string, unknown>;
      vi.stubGlobal('NativeModules', modules);
      const haptics = createHaptics();

      expect(() => haptics.selection()).not.toThrow();
      await settle();

      // Had the service asked again, it would find this module.
      const module = stubModule();
      haptics.selection();
      expect(module.selection).not.toHaveBeenCalled();
    });
  });

  describe('under the testing library', () => {
    it('does nothing', () => {
      vi.stubGlobal('lynxTestingEnv', {});
      const module = stubModule();

      createHaptics().impact('light');

      expect(module.impact).not.toHaveBeenCalled();
    });
  });

  describe('in the web preview', () => {
    it("vibrates with the page's navigator.vibrate()", () => {
      const page = stubPage(() => true);
      const module = stubModule();
      const haptics = createHaptics();

      haptics.selection();
      haptics.impact('heavy');
      haptics.notification('warning');

      expect(page.navigator.vibrate?.mock.calls).toEqual([
        [8],
        [25],
        [[20, 80, 20]],
      ]);
      expect(module.selection).not.toHaveBeenCalled();
    });

    it('does nothing where the browser has no vibration', () => {
      stubPage();

      expect(() => createHaptics().impact()).not.toThrow();
    });

    it('swallows a browser that throws rather than refusing', () => {
      stubPage(() => {
        throw new Error('Not allowed');
      });

      expect(() => createHaptics().notification()).not.toThrow();
    });

    it('uses its own window when it is not in a frame', () => {
      const page = stubPage(() => true);
      vi.stubGlobal('parent', undefined);
      vi.stubGlobal('navigator', page.navigator);

      createHaptics().selection();

      expect(page.navigator.vibrate).toHaveBeenCalledWith(8);
    });
  });
});
