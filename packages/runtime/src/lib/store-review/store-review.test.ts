import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxStoreReview } from './store-review';

type Done = (result: object) => void;

const createStoreReview = () =>
  Injector.create({ providers: [LynxStoreReview] }).get(LynxStoreReview);

/**
 * Stands in for the shells' AngularLynxStoreReview module, as the
 * background thread sees it. Unit tests run as the background thread, so the
 * service calls it directly. `answer` calls back the way the module does
 * once the store has the request.
 */
const stubModule = () => {
  let done: Done | undefined;
  const request = vi.fn((callback: Done) => {
    done = callback;
  });
  vi.stubGlobal('NativeModules', { AngularLynxStoreReview: { request } });
  return { request, answer: () => done?.({}) };
};

describe('LynxStoreReview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the native module, and resolves once it answers', async () => {
    const module = stubModule();
    let resolved = false;
    const request = createStoreReview()
      .request()
      .then((value) => {
        resolved = true;
        return value;
      });
    await Promise.resolve();
    expect(module.request).toHaveBeenCalledOnce();
    expect(module.request).toHaveBeenCalledWith(expect.any(Function));
    // The store hasn't answered yet: on Android, the prompt is still open.
    expect(resolved).toBe(false);
    module.answer();
    await expect(request).resolves.toBeUndefined();
  });

  it('asks again each time, leaving the rate limit to the store', async () => {
    const module = stubModule();
    module.request.mockImplementation((done: Done) => done({}));
    const storeReview = createStoreReview();
    await storeReview.request();
    await storeReview.request();
    expect(module.request).toHaveBeenCalledTimes(2);
  });

  // Lynx Explorer, the web preview and an app built without storeReview.
  it('resolves without the native module', async () => {
    vi.stubGlobal('NativeModules', {});
    await expect(createStoreReview().request()).resolves.toBeUndefined();
  });

  it('resolves when the module throws', async () => {
    vi.stubGlobal('NativeModules', {
      AngularLynxStoreReview: {
        request: () => {
          throw new Error('No Play Store');
        },
      },
    });
    await expect(createStoreReview().request()).resolves.toBeUndefined();
  });
});
