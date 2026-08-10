import { describe, expect, it } from 'vitest';
import { PinchGesture } from './pinch-gesture';
import { GestureType } from './types';

describe('PinchGesture', () => {
  it('has type GestureType.PINCH', () => {
    expect(new PinchGesture().type).toBe(GestureType.PINCH);
  });

  it('inherits onUpdate from ContinuousGesture', () => {
    const g = new PinchGesture();
    const cb = () => {};

    g.onUpdate(cb);

    expect(g._callbacks['onUpdate']).toBe(cb);
  });

  it('inherits all BaseGesture callback and relation methods', () => {
    const g = new PinchGesture();
    const dep = new PinchGesture();
    const cb = () => {};

    g.onBegin(cb).onEnd(cb).waitFor(dep).enabled(false);

    expect(g._callbacks['onBegin']).toBe(cb);
    expect(g._callbacks['onEnd']).toBe(cb);
    expect(g._waitFor).toEqual([dep]);
    expect(g._config['enabled']).toBe(false);
  });
});
