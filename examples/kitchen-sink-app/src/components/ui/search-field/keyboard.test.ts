import { Injector, type Renderer2 } from '@angular/core';
import { LynxSystemInfo } from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type KeyboardScreen,
  keyboardHeightOf,
  keyboardLift,
  keyboardScreen,
  measureForKeyboard,
} from './keyboard';

const IPHONE: KeyboardScreen = {
  platform: 'iOS',
  pixelRatio: 3,
  screenHeight: 874,
};
const PIXEL: KeyboardScreen = {
  platform: 'Android',
  pixelRatio: 2.625,
  screenHeight: 914,
};

/**
 * The Lynx function that runs an element's UI methods, which the testing
 * library defines on the global object.
 */
type InvokeUIMethod = {
  __InvokeUIMethod: (
    element: unknown,
    method: string,
    params: Record<string, unknown>,
    callback: (result: { code: number; data?: unknown }) => void,
  ) => void;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('keyboardHeightOf', () => {
  it('takes iOS’s points as they are', () => {
    expect(keyboardHeightOf({ detail: { height: 336 } }, IPHONE)).toBe(336);
  });

  it('turns Android’s physical pixels into px', () => {
    expect(keyboardHeightOf({ detail: { height: 819 } }, PIXEL)).toBe(312);
  });
});

describe('keyboardLift', () => {
  it('measures iOS’s keyboard up from the bottom of the screen', () => {
    // The keyboard's top is at 874 - 336 = 538; the field's bottom clears it
    // by the gap.
    expect(keyboardLift({ bottom: 820 }, { bottom: 840 }, 336, IPHONE, 8)).toBe(
      290,
    );
  });

  it('measures Android’s up from the bottom of the Lynx view', () => {
    // The keyboard's top is at 890 - 312 = 578.
    expect(keyboardLift({ bottom: 855 }, { bottom: 890 }, 312, PIXEL, 8)).toBe(
      285,
    );
  });

  it('is 0 when the keyboard doesn’t reach the element, or is down', () => {
    expect(keyboardLift({ bottom: 300 }, { bottom: 874 }, 336, IPHONE, 8)).toBe(
      0,
    );
    expect(keyboardLift({ bottom: 820 }, { bottom: 874 }, 0, IPHONE, 8)).toBe(
      0,
    );
  });
});

describe('keyboardScreen', () => {
  it('is LynxSystemInfo where there is one', () => {
    const info = { platform: 'iOS', pixelRatio: 3, screenHeight: 874 };
    const injector = Injector.create({
      providers: [{ provide: LynxSystemInfo, useValue: info }],
    });
    expect(keyboardScreen(injector)).toBe(info);
  });

  it('is null where LynxSystemInfo has no SystemInfo to read, and throws', () => {
    const injector = Injector.create({
      providers: [
        {
          provide: LynxSystemInfo,
          useFactory: () => {
            throw new Error('SystemInfo is not available in this environment');
          },
        },
      ],
    });
    expect(keyboardScreen(injector)).toBeNull();
  });
});

describe('measureForKeyboard', () => {
  /** A page holding a column holding the field, as Lynx elements. */
  const page = { element: 'page', tagName: 'page' };
  const column = { element: 'column' };
  const field = { element: 'field' };
  // The page has a parent of its own in the testing library, which the
  // walk stops short of.
  const parents = new Map<unknown, unknown>([
    [field, column],
    [column, page],
    [page, { element: 'document' }],
  ]);
  const renderer = {
    parentNode: (node: unknown) => parents.get(node) ?? null,
  } as unknown as Renderer2;

  it('measures the element and the page it’s in, on screen', async () => {
    const invoke = vi
      .spyOn(globalThis as unknown as InvokeUIMethod, '__InvokeUIMethod')
      .mockImplementation((element, _method, _params, callback) =>
        callback({
          code: 0,
          data: { bottom: element === 'page' ? 874 : 820 },
        }),
      );

    await expect(measureForKeyboard(renderer, field)).resolves.toEqual({
      element: expect.objectContaining({ bottom: 820 }),
      page: expect.objectContaining({ bottom: 874 }),
    });
    expect(invoke).toHaveBeenCalledWith(
      'field',
      'boundingClientRect',
      { relativeTo: 'screen' },
      expect.any(Function),
    );
  });

  it('is null where an element can’t be measured', async () => {
    vi.spyOn(
      globalThis as unknown as InvokeUIMethod,
      '__InvokeUIMethod',
    ).mockImplementation((_element, _method, _params, callback) =>
      callback({ code: 1 }),
    );
    await expect(measureForKeyboard(renderer, field)).resolves.toBeNull();
  });
});
