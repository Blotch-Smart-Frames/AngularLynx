import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxAnimation } from './animation';

describe('LynxAnimation', () => {
  let fakeRef: ElementRef;

  beforeEach(() => {
    fakeRef = {} as ElementRef;
    globalThis.__ElementAnimate = vi.fn();
  });

  describe('constructor', () => {
    it('assigns an id with the expected prefix', () => {
      const anim = new LynxAnimation(fakeRef, [], {});
      expect(anim.id).toMatch(/^__lynx-angular-animation-\d+$/);
    });

    it('assigns unique ids to successive animations', () => {
      const a1 = new LynxAnimation(fakeRef, [], {});
      const a2 = new LynxAnimation(fakeRef, [], {});
      expect(a1.id).not.toBe(a2.id);
    });

    it('calls __ElementAnimate with ANIMATION_START and generated id as name when options.name is absent', () => {
      const keyframes = [{ opacity: '0' }, { opacity: '1' }];
      const options = { duration: 300 };
      const anim = new LynxAnimation(fakeRef, keyframes, options);

      expect(globalThis.__ElementAnimate).toHaveBeenCalledOnce();
      expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(fakeRef, [
        0, // ANIMATION_START
        anim.id,
        keyframes,
        options,
      ]);
    });

    it('calls __ElementAnimate with ANIMATION_START and options.name when provided', () => {
      const keyframes = [{ transform: 'scale(0)' }];
      const options = { name: 'my-animation', duration: 500 };
      const anim = new LynxAnimation(fakeRef, keyframes, options);

      expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(fakeRef, [
        0, // ANIMATION_START
        'my-animation',
        keyframes,
        options,
      ]);
      // The auto-generated id is still assigned even when options.name is used as the animation name
      expect(anim.id).toMatch(/^__lynx-angular-animation-\d+$/);
    });

    it('normalizes iterations to iterationCount for web-core compatibility', () => {
      const keyframes = [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(360deg)' },
      ];
      const options = { duration: 800, iterations: Infinity, easing: 'linear' };
      const anim = new LynxAnimation(fakeRef, keyframes, options);

      expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(fakeRef, [
        0,
        anim.id,
        keyframes,
        expect.objectContaining({
          iterationCount: 'infinite',
          timingFunction: 'linear',
          iterations: Infinity,
          easing: 'linear',
        }),
      ]);
    });

    it('normalizes fill to fillMode for web-core compatibility', () => {
      const keyframes = [{ opacity: '0' }, { opacity: '1' }];
      const options = { duration: 300, fill: 'forwards' as const };
      const anim = new LynxAnimation(fakeRef, keyframes, options);

      expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(fakeRef, [
        0,
        anim.id,
        keyframes,
        expect.objectContaining({ fillMode: 'forwards', fill: 'forwards' }),
      ]);
    });

    it('does not overwrite explicit iterationCount with iterations', () => {
      const keyframes = [{ opacity: '0' }];
      const options = {
        duration: 300,
        iterations: Infinity,
        iterationCount: 3,
      };
      const anim = new LynxAnimation(fakeRef, keyframes, options);

      expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(fakeRef, [
        0,
        anim.id,
        keyframes,
        expect.objectContaining({ iterationCount: 3 }),
      ]);
    });
  });

  describe('play()', () => {
    it('calls __ElementAnimate with ANIMATION_PLAY and the animation id', () => {
      const anim = new LynxAnimation(fakeRef, [], {});
      vi.clearAllMocks();

      anim.play();

      expect(globalThis.__ElementAnimate).toHaveBeenCalledOnce();
      expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(fakeRef, [
        1, // ANIMATION_PLAY
        anim.id,
      ]);
    });
  });

  describe('pause()', () => {
    it('calls __ElementAnimate with ANIMATION_PAUSE and the animation id', () => {
      const anim = new LynxAnimation(fakeRef, [], {});
      vi.clearAllMocks();

      anim.pause();

      expect(globalThis.__ElementAnimate).toHaveBeenCalledOnce();
      expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(fakeRef, [
        2, // ANIMATION_PAUSE
        anim.id,
      ]);
    });
  });

  describe('cancel()', () => {
    it('calls __ElementAnimate with ANIMATION_CANCEL and the animation id', () => {
      const anim = new LynxAnimation(fakeRef, [], {});
      vi.clearAllMocks();

      anim.cancel();

      expect(globalThis.__ElementAnimate).toHaveBeenCalledOnce();
      expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(fakeRef, [
        3, // ANIMATION_CANCEL
        anim.id,
      ]);
    });
  });
});
