import { describe, expect, it } from 'vitest';
import { NoopLynxAnimation } from './noop-animation';

describe('NoopLynxAnimation', () => {
  describe('constructor', () => {
    it('assigns an id with the expected prefix', () => {
      const anim = new NoopLynxAnimation();
      expect(anim.id).toMatch(/^__lynx-angular-noop-animation-\d+$/);
    });

    it('assigns unique ids to successive animations', () => {
      const a1 = new NoopLynxAnimation();
      const a2 = new NoopLynxAnimation();
      expect(a1.id).not.toBe(a2.id);
    });
  });

  describe('play()', () => {
    it('does nothing and does not throw', () => {
      const anim = new NoopLynxAnimation();
      expect(() => anim.play()).not.toThrow();
    });
  });

  describe('pause()', () => {
    it('does nothing and does not throw', () => {
      const anim = new NoopLynxAnimation();
      expect(() => anim.pause()).not.toThrow();
    });
  });

  describe('cancel()', () => {
    it('does nothing and does not throw', () => {
      const anim = new NoopLynxAnimation();
      expect(() => anim.cancel()).not.toThrow();
    });
  });
});
