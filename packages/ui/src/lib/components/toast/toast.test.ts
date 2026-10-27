import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { DURATION } from '../../utils/animate';
import { UiToaster } from './toast';
import { type ToastOptions, dismissToast, toast, toasts } from './toast-state';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits out a toast's exit animation, after which the toaster drops it from
 * the queue, and renders that.
 */
const waitForExit = async () => {
  await sleep(DURATION.fast + 40);
  await waitForUpdate();
};

const renderToaster = async () => {
  const result = await render(UiToaster);
  /**
   * A toast's card: its host element, around the view holding its texts.
   */
  const card = (title: string) =>
    result.getByText(title).parentElement!.parentElement!;
  return {
    ...result,
    card,
    /** One property of a toast card's inline style. */
    styleOf: (title: string, property: string) =>
      (card(title) as HTMLElement).style.getPropertyValue(property),
    /**
     * Raises a toast and lets it mount, then start its entrance, which waits
     * a macrotask so the card is committed to Lynx's tree first.
     */
    raise: async (options: ToastOptions) => {
      const id = toast(options);
      await waitForUpdate();
      await waitForUpdate();
      return id;
    },
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;

/** Where the front toast rests. */
const FRONT = 'translateY(0px) scale(1)';
/** Where the toast behind the front one rests: lifted, and a little smaller. */
const SECOND = 'translateY(-14px) scale(0.95)';

describe('UiToaster', () => {
  // The queue is module state, so each test starts it empty.
  beforeEach(() => toasts.set([]));

  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  /**
   * The keyframes of the animations started on an element.
   */
  const keyframesOn = (element: Element) =>
    animate.mock.calls
      .filter(
        ([target, [operation]]) => target === element && operation === START,
      )
      .map(([, [, , keyframes]]) => keyframes);

  const entrance = [
    { transform: 'translateY(100%) scale(0.95)', opacity: 0 },
    { transform: FRONT, opacity: 1 },
  ];
  const exit = (fromY: number) => [
    { transform: `translateY(${fromY}px) scale(1)`, opacity: 1 },
    { transform: 'translateY(300px) scale(0.95)', opacity: 0 },
  ];
  const snapBack = (fromY: number) => [
    { transform: `translateY(${fromY}px) scale(1)` },
    { transform: FRONT },
  ];

  describe('showing toasts', () => {
    it('shows a toast once one is raised', async () => {
      const { queryByText, getByText, raise } = await renderToaster();
      expect(queryByText('Saved')).toBeNull();

      await raise({ title: 'Saved', description: 'Your changes are live.' });
      expect(getByText('Saved')).toBeTruthy();
      expect(getByText('Your changes are live.')).toBeTruthy();
    });

    it("leaves out a title or description it doesn't have", async () => {
      const { getByText, raise } = await renderToaster();
      await raise({ title: 'Only a title' });
      await raise({ title: '', description: 'Only a description' });
      const textsBeside = (text: string) =>
        getByText(text).parentElement!.querySelectorAll('text');
      expect(textsBeside('Only a title')).toHaveLength(1);
      expect(textsBeside('Only a description')).toHaveLength(1);
    });

    it('styles a toast by its variant', async () => {
      const { card, getByText, raise } = await renderToaster();
      const action = { label: 'Undo', onAction: () => {} };
      await raise({ title: 'Saved', description: 'Done.', action });
      expect(card('Saved').classList).toContain('bg-background');
      expect(getByText('Saved').classList).toContain('text-foreground');
      expect(getByText('Done.').classList).toContain('text-muted-foreground');
      expect(getByText('Undo').classList).toContain('text-foreground');
      expect(getByText('Undo').parentElement!.classList).toContain(
        'border-border',
      );

      await raise({
        title: 'Failed',
        description: 'Try again.',
        variant: 'destructive',
        action: { label: 'Retry', onAction: () => {} },
      });
      expect(card('Failed').classList).toContain('bg-destructive');
      for (const text of ['Failed', 'Try again.', 'Retry']) {
        expect(getByText(text).classList).toContain(
          'text-destructive-foreground',
        );
      }
      expect(getByText('Retry').parentElement!.classList).toContain(
        'border-destructive-foreground',
      );
    });

    it('stays hidden until it slides up into view', async () => {
      const { card, styleOf } = await renderToaster();
      toast({ title: 'Saved' });
      // Mounted, but its entrance waits a macrotask: until then it's hidden,
      // or it would flash at its resting place first.
      await waitForUpdate();
      expect(styleOf('Saved', 'opacity')).toBe('0');
      expect(keyframesOn(card('Saved'))).toEqual([]);

      await waitForUpdate();
      expect(styleOf('Saved', 'opacity')).toBe('1');
      expect(keyframesOn(card('Saved'))).toEqual([entrance]);
    });

    it('stacks the newest three, newest in front, and queues the rest', async () => {
      const { queryByText, styleOf, raise } = await renderToaster();
      for (const title of ['First', 'Second', 'Third', 'Fourth']) {
        await raise({ title });
      }
      // The oldest waits its turn, off screen.
      expect(queryByText('First')).toBeNull();
      expect(toasts()).toHaveLength(4);

      expect(styleOf('Fourth', 'z-index')).toBe('100');
      expect(styleOf('Fourth', 'transform')).toBe(FRONT);
      expect(styleOf('Third', 'z-index')).toBe('99');
      expect(styleOf('Third', 'transform')).toBe(SECOND);
      expect(styleOf('Second', 'z-index')).toBe('98');
      expect(styleOf('Second', 'transform')).toBe(
        'translateY(-28px) scale(0.9)',
      );
    });

    it('moves the stack back for a new toast, and forward when the front one goes', async () => {
      const { card, raise } = await renderToaster();
      await raise({ title: 'Older' });
      await raise({ title: 'Newer' });
      expect(keyframesOn(card('Older'))).toEqual([
        entrance,
        [{ transform: FRONT }, { transform: SECOND }],
      ]);

      fireEvent.tap(card('Newer'));
      await waitForExit();
      expect(keyframesOn(card('Older')).at(-1)).toEqual([
        { transform: SECOND },
        { transform: FRONT },
      ]);
    });

    it('brings a queued toast into the back of the stack once there is room', async () => {
      const { card, raise } = await renderToaster();
      for (const title of ['First', 'Second', 'Third', 'Fourth']) {
        await raise({ title });
      }
      fireEvent.tap(card('Fourth'));
      await waitForExit();
      // It mounts there, so it rises into the back slot rather than sliding
      // up past the others.
      await waitForUpdate();
      expect(keyframesOn(card('First'))).toEqual([
        [
          { transform: 'translateY(-20px) scale(0.864)', opacity: 0 },
          { transform: 'translateY(-28px) scale(0.9)', opacity: 1 },
        ],
      ]);
    });
  });

  describe('dismissing', () => {
    it('slides the front toast away when tapped', async () => {
      const { card, queryByText, raise } = await renderToaster();
      await raise({ title: 'Saved' });
      fireEvent.tap(card('Saved'));
      expect(keyframesOn(card('Saved')).at(-1)).toEqual(exit(0));

      await waitForExit();
      expect(queryByText('Saved')).toBeNull();
      expect(toasts()).toEqual([]);
    });

    it('slides away only once, however often it is tapped', async () => {
      const { card, queryByText, raise } = await renderToaster();
      await raise({ title: 'Saved' });
      fireEvent.tap(card('Saved'));
      fireEvent.tap(card('Saved'));
      expect(keyframesOn(card('Saved'))).toEqual([entrance, exit(0)]);

      await waitForExit();
      expect(queryByText('Saved')).toBeNull();
    });

    it('ignores taps on a toast behind the front one', async () => {
      const { card, getByText, raise } = await renderToaster();
      await raise({ title: 'Older' });
      await raise({ title: 'Newer' });
      animate.mockClear();

      fireEvent.tap(card('Older'));
      await waitForExit();
      expect(animate).not.toHaveBeenCalled();
      expect(getByText('Older')).toBeTruthy();
    });

    it('runs its action, then goes', async () => {
      const onAction = vi.fn();
      const { getByText, queryByText, raise } = await renderToaster();
      await raise({ title: 'Deleted', action: { label: 'Undo', onAction } });

      // The action catches its tap, so the card doesn't see it as well.
      fireEvent.tap(getByText('Undo').parentElement!, {
        eventType: 'catchEvent',
      });
      expect(onAction).toHaveBeenCalledTimes(1);

      await waitForExit();
      expect(queryByText('Deleted')).toBeNull();
    });

    it('goes by itself once its duration is up', async () => {
      const { queryByText, raise } = await renderToaster();
      await raise({ title: 'Saved', duration: 30 });
      expect(queryByText('Saved')).not.toBeNull();

      await sleep(30);
      await waitForExit();
      expect(queryByText('Saved')).toBeNull();
    });

    it('fades a toast behind the front one away in place when it expires', async () => {
      const { card, queryByText, raise } = await renderToaster();
      // Raised together, so the older one is behind from the start.
      toast({ title: 'Older', duration: 30 });
      await raise({ title: 'Newer' });

      await sleep(30);
      await waitForUpdate();
      expect(keyframesOn(card('Older')).at(-1)).toEqual([
        { transform: SECOND, opacity: 1 },
        { transform: 'translateY(-14px) scale(0.855)', opacity: 0 },
      ]);

      await waitForExit();
      expect(queryByText('Older')).toBeNull();
      expect(queryByText('Newer')).not.toBeNull();
    });

    it("lets a toast that's going finish, rather than moving back for a new one", async () => {
      const { card, raise } = await renderToaster();
      await raise({ title: 'Older' });
      fireEvent.tap(card('Older'));
      await raise({ title: 'Newer' });
      expect(keyframesOn(card('Older'))).toEqual([entrance, exit(0)]);
    });

    describe('removed before its timers fire', () => {
      // A destroyed output warns (NG0953) if something still emits on it.
      let warn: MockInstance<typeof console.warn>;
      beforeEach(() => {
        warn = vi.spyOn(console, 'warn');
      });
      afterEach(() => warn.mockRestore());

      it("doesn't expire once it's gone", async () => {
        const { card, queryByText, raise } = await renderToaster();
        const id = await raise({ title: 'Saved', duration: 100 });
        const removed = card('Saved');
        dismissToast(id);
        await waitForUpdate();
        expect(queryByText('Saved')).toBeNull();

        await sleep(100);
        await waitForExit();
        expect(keyframesOn(removed)).toEqual([entrance]);
        expect(warn).not.toHaveBeenCalledWith(
          expect.stringContaining('NG0953'),
        );
      });

      it("doesn't report finishing its exit once it's gone", async () => {
        const { card, queryByText, raise } = await renderToaster();
        const id = await raise({ title: 'Saved' });
        fireEvent.tap(card('Saved'));
        dismissToast(id);
        await waitForUpdate();
        expect(queryByText('Saved')).toBeNull();

        await waitForExit();
        expect(warn).not.toHaveBeenCalledWith(
          expect.stringContaining('NG0953'),
        );
      });
    });
  });

  describe('dragging', () => {
    /**
     * Fires a touch event the card catches, at a height on screen.
     */
    const touch = (
      name: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
      element: Element,
      clientY?: number,
    ) =>
      fireEvent[name](element, {
        eventType: 'catchEvent',
        ...(clientY === undefined ? {} : { touches: [{ clientY }] }),
      });

    it('follows the finger down, and springs back if let go early', async () => {
      const { card, styleOf, raise } = await renderToaster();
      await raise({ title: 'Saved' });

      touch('touchstart', card('Saved'), 100);
      touch('touchmove', card('Saved'), 130);
      await waitForUpdate();
      expect(styleOf('Saved', 'transform')).toBe('translateY(30px) scale(1)');

      // Docked at the bottom, it only moves down.
      touch('touchmove', card('Saved'), 60);
      await waitForUpdate();
      expect(styleOf('Saved', 'transform')).toBe(FRONT);

      touch('touchmove', card('Saved'), 150);
      touch('touchend', card('Saved'));
      await waitForUpdate();
      expect(keyframesOn(card('Saved')).at(-1)).toEqual(snapBack(50));
      expect(styleOf('Saved', 'transform')).toBe(FRONT);
    });

    it('springs back when the touch is canceled', async () => {
      const { card, raise } = await renderToaster();
      await raise({ title: 'Saved' });
      touch('touchstart', card('Saved'), 100);
      touch('touchmove', card('Saved'), 140);
      touch('touchcancel', card('Saved'));
      expect(keyframesOn(card('Saved')).at(-1)).toEqual(snapBack(40));
    });

    it('slides away from the finger when dragged far enough', async () => {
      const { card, queryByText, raise } = await renderToaster();
      await raise({ title: 'Saved' });
      touch('touchstart', card('Saved'), 100);
      touch('touchmove', card('Saved'), 220);
      touch('touchend', card('Saved'));
      expect(keyframesOn(card('Saved')).at(-1)).toEqual(exit(120));

      await waitForExit();
      expect(queryByText('Saved')).toBeNull();
    });

    it("doesn't expire while held, and gets its full time again once let go", async () => {
      const { card, queryByText, raise } = await renderToaster();
      await raise({ title: 'Saved', duration: 100 });
      touch('touchstart', card('Saved'), 100);

      await sleep(100);
      await waitForExit();
      expect(queryByText('Saved')).not.toBeNull();

      touch('touchend', card('Saved'));
      await sleep(100);
      await waitForExit();
      expect(queryByText('Saved')).toBeNull();
    });

    it('ignores touches on a toast behind the front one', async () => {
      const { card, styleOf, raise } = await renderToaster();
      await raise({ title: 'Older' });
      await raise({ title: 'Newer' });
      animate.mockClear();

      touch('touchstart', card('Older'), 100);
      touch('touchmove', card('Older'), 200);
      touch('touchend', card('Older'));
      await waitForUpdate();
      expect(styleOf('Older', 'transform')).toBe(SECOND);
      expect(animate).not.toHaveBeenCalled();
    });

    it('ignores touches without a position', async () => {
      const { card, styleOf, raise } = await renderToaster();
      await raise({ title: 'Saved' });

      // Without a starting point, there's no drag to follow.
      touch('touchstart', card('Saved'));
      touch('touchmove', card('Saved'), 200);
      await waitForUpdate();
      expect(styleOf('Saved', 'transform')).toBe(FRONT);

      // A move without a position leaves the toast where it was.
      touch('touchstart', card('Saved'), 100);
      touch('touchmove', card('Saved'), 140);
      touch('touchmove', card('Saved'));
      await waitForUpdate();
      expect(styleOf('Saved', 'transform')).toBe('translateY(40px) scale(1)');
    });

    it("doesn't spring back when a tap dismissed it mid-drag", async () => {
      const { card, queryByText, raise } = await renderToaster();
      await raise({ title: 'Saved' });
      touch('touchstart', card('Saved'), 100);
      touch('touchmove', card('Saved'), 120);
      fireEvent.tap(card('Saved'));
      touch('touchend', card('Saved'));
      expect(keyframesOn(card('Saved'))).toEqual([entrance, exit(20)]);

      await waitForExit();
      expect(queryByText('Saved')).toBeNull();
    });
  });
});
