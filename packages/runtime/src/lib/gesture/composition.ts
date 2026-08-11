import type { BaseGesture } from './base-gesture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGesture = BaseGesture<any, any>;

export class ComposedGesture {
  constructor(
    readonly gestures: AnyGesture[],
    readonly compositionType: 'simultaneous' | 'exclusive' | 'race',
  ) {}
}

export const Gesture = {
  // All gestures can recognize simultaneously — none blocks the others.
  Simultaneous(...gestures: AnyGesture[]): ComposedGesture {
    for (const g of gestures) {
      g.simultaneousWith(...gestures.filter((o) => o !== g));
    }
    return new ComposedGesture(gestures, 'simultaneous');
  },

  // Gestures are tried in order — each waits for all previous to fail before activating.
  // E.g. Exclusive(doubleTap, singleTap): singleTap waits for doubleTap to fail
  // before it can activate, giving doubleTap priority.
  Exclusive(...gestures: AnyGesture[]): ComposedGesture {
    for (let i = 1; i < gestures.length; i++) {
      gestures[i].waitFor(...gestures.slice(0, i));
    }
    return new ComposedGesture(gestures, 'exclusive');
  },

  // First gesture to recognize wins — no explicit dependency relations.
  Race(...gestures: AnyGesture[]): ComposedGesture {
    return new ComposedGesture(gestures, 'race');
  },
};
