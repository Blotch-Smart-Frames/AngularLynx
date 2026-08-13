import { describe, expect, it } from 'vitest';
import { BaseGesture, ContinuousGesture } from './base-gesture';
import { GestureType, type GestureEvent } from './types';

/**
 * Minimal concrete subclasses for testing abstract base classes.
 */
class ConcreteGesture extends BaseGesture<GestureEvent, ConcreteGesture> {
  readonly type = GestureType.DEFAULT;
}

class ConcreteContinuous extends ContinuousGesture<
  GestureEvent,
  ConcreteContinuous
> {
  readonly type = GestureType.PAN;
}

describe('BaseGesture', () => {
  describe('id', () => {
    it('assigns unique incrementing IDs to each instance', () => {
      const g1 = new ConcreteGesture();
      const g2 = new ConcreteGesture();

      expect(g2.id).toBe(g1.id + 1);
    });
  });

  describe('callbacks', () => {
    it('stores the onBegin callback and returns this', () => {
      const g = new ConcreteGesture();
      const cb = () => {};

      const result = g.onBegin(cb);

      expect(g._callbacks['onBegin']).toBe(cb);
      expect(result).toBe(g);
    });

    it('stores the onStart callback and returns this', () => {
      const g = new ConcreteGesture();
      const cb = () => {};

      const result = g.onStart(cb);

      expect(g._callbacks['onStart']).toBe(cb);
      expect(result).toBe(g);
    });

    it('stores the onEnd callback and returns this', () => {
      const g = new ConcreteGesture();
      const cb = () => {};

      const result = g.onEnd(cb);

      expect(g._callbacks['onEnd']).toBe(cb);
      expect(result).toBe(g);
    });

    it('stores the onTouchesDown callback and returns this', () => {
      const g = new ConcreteGesture();
      const cb = () => {};

      const result = g.onTouchesDown(cb);

      expect(g._callbacks['onTouchesDown']).toBe(cb);
      expect(result).toBe(g);
    });

    it('stores the onTouchesUp callback and returns this', () => {
      const g = new ConcreteGesture();
      const cb = () => {};

      const result = g.onTouchesUp(cb);

      expect(g._callbacks['onTouchesUp']).toBe(cb);
      expect(result).toBe(g);
    });

    it('overwrites a previously set callback when called again', () => {
      const g = new ConcreteGesture();
      const cb1 = () => {};
      const cb2 = () => {};

      g.onBegin(cb1);
      g.onBegin(cb2);

      expect(g._callbacks['onBegin']).toBe(cb2);
    });
  });

  describe('relations', () => {
    it('waitFor appends gestures and returns this', () => {
      const g = new ConcreteGesture();
      const dep1 = new ConcreteGesture();
      const dep2 = new ConcreteGesture();

      const result = g.waitFor(dep1, dep2);

      expect(g._waitFor).toEqual([dep1, dep2]);
      expect(result).toBe(g);
    });

    it('waitFor accumulates across multiple calls', () => {
      const g = new ConcreteGesture();
      const dep1 = new ConcreteGesture();
      const dep2 = new ConcreteGesture();

      g.waitFor(dep1);
      g.waitFor(dep2);

      expect(g._waitFor).toEqual([dep1, dep2]);
    });

    it('simultaneousWith appends gestures and returns this', () => {
      const g = new ConcreteGesture();
      const dep = new ConcreteGesture();

      const result = g.simultaneousWith(dep);

      expect(g._simultaneousWith).toEqual([dep]);
      expect(result).toBe(g);
    });

    it('continueWith appends gestures and returns this', () => {
      const g = new ConcreteGesture();
      const dep = new ConcreteGesture();

      const result = g.continueWith(dep);

      expect(g._continueWith).toEqual([dep]);
      expect(result).toBe(g);
    });
  });

  describe('config', () => {
    it('enabled(true) sets _config.enabled to true and returns this', () => {
      const g = new ConcreteGesture();

      const result = g.enabled(true);

      expect(g._config['enabled']).toBe(true);
      expect(result).toBe(g);
    });

    it('enabled(false) sets _config.enabled to false', () => {
      const g = new ConcreteGesture();

      g.enabled(false);

      expect(g._config['enabled']).toBe(false);
    });
  });

  describe('initial state', () => {
    it('starts with empty callbacks, config, and relation arrays', () => {
      const g = new ConcreteGesture();

      expect(g._callbacks).toEqual({});
      expect(g._config).toEqual({});
      expect(g._waitFor).toEqual([]);
      expect(g._simultaneousWith).toEqual([]);
      expect(g._continueWith).toEqual([]);
    });
  });
});

describe('ContinuousGesture', () => {
  it('stores the onUpdate callback and returns this', () => {
    const g = new ConcreteContinuous();
    const cb = () => {};

    const result = g.onUpdate(cb);

    expect(g._callbacks['onUpdate']).toBe(cb);
    expect(result).toBe(g);
  });

  it('inherits all BaseGesture methods', () => {
    const g = new ConcreteContinuous();
    const dep = new ConcreteContinuous();
    const cb = () => {};

    g.onBegin(cb).waitFor(dep).enabled(true);

    expect(g._callbacks['onBegin']).toBe(cb);
    expect(g._waitFor).toEqual([dep]);
    expect(g._config['enabled']).toBe(true);
  });
});
