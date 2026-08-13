import { describe, expect, it } from 'vitest';
import { RotationGesture } from './rotation-gesture';
import { GestureType } from './types';

describe('RotationGesture', () => {
  it('has type GestureType.ROTATION', () => {
    expect(new RotationGesture().type).toBe(GestureType.ROTATION);
  });

  it('inherits onUpdate from ContinuousGesture', () => {
    const g = new RotationGesture();
    const cb = () => {};

    g.onUpdate(cb);

    expect(g._callbacks['onUpdate']).toBe(cb);
  });

  it('inherits all BaseGesture callback and relation methods', () => {
    const g = new RotationGesture();
    const dep = new RotationGesture();
    const cb = () => {};

    g.onBegin(cb).onStart(cb).simultaneousWith(dep).enabled(true);

    expect(g._callbacks['onBegin']).toBe(cb);
    expect(g._callbacks['onStart']).toBe(cb);
    expect(g._simultaneousWith).toEqual([dep]);
    expect(g._config['enabled']).toBe(true);
  });
});
