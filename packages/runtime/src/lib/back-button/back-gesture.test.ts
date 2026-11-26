import { describe, expect, it, vi } from 'vitest';
import { type BackGestureFollower, BackGestures } from './back-gesture';

const follower: BackGestureFollower = {
  progress: () => {},
  cancel: () => {},
  commit: () => true,
};

describe('BackGestures', () => {
  it('asks the last registered target first, and the next when it declines', () => {
    const gestures = new BackGestures();
    const outer = vi.fn(() => follower);
    const inner = vi.fn(() => null);
    gestures.register(outer);
    gestures.register(inner);

    expect(gestures.start('left')).toBe(follower);
    expect(inner).toHaveBeenCalledWith('left');
    expect(outer).toHaveBeenCalledWith('left');
  });

  it('stops asking a target once it unregisters, and has none follow without one', () => {
    const gestures = new BackGestures();
    const target = vi.fn(() => follower);
    const unregister = gestures.register(target);
    unregister();
    unregister();

    expect(gestures.start('right')).toBeNull();
    expect(target).not.toHaveBeenCalled();
  });
});
