import { useState } from '@lynx-js/react';
import { useMainThreadRef } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';

import { SENTINEL_A, SENTINEL_B, handlerOf } from '../lib/bench';

// The benchmark's tap screen (benchmarks/SPEC.md, "Tap"), which a
// BENCH_SCREEN build opens on: `tap`, or `tap?handler=main-thread`.
export default function BenchTap({ params }: { params: Record<string, string> }) {
  return handlerOf(params) === 'main-thread' ? <MainThreadTap /> : <DefaultTap />;
}

/** ReactLynx's default: bindtap runs on the background thread, sets state, and React's commit reaches the main thread as a patch. */
function DefaultTap() {
  const [taps, setTaps] = useState(0);
  return (
    <view className="tap-screen">
      <view className="tap-top">
        <view
          className="tap-box"
          style={{ backgroundColor: taps % 2 ? SENTINEL_B : SENTINEL_A }}
        />
        <text className="tap-count">Taps: {taps}</text>
      </view>
      <view
        className="tap-button"
        accessibility-element
        accessibility-traits="button"
        accessibility-label="Tap"
        bindtap={() => setTaps(n => n + 1)}
      >
        <text className="tap-label">Tap</text>
      </view>
    </view>
  );
}

/**
 * The main thread's way: the 'main thread' function runs where the elements
 * are, and sets the box's color and the count's text on them directly,
 * without React.
 */
function MainThreadTap() {
  const box = useMainThreadRef<MainThread.Element>(null);
  const count = useMainThreadRef<MainThread.Element>(null);
  const taps = useMainThreadRef(0);

  const onTap = () => {
    'main thread';
    taps.current += 1;
    box.current?.setStyleProperty(
      'background-color',
      taps.current % 2 ? SENTINEL_B : SENTINEL_A,
    );
    count.current?.setAttribute('text', `Taps: ${taps.current}`);
  };

  return (
    <view className="tap-screen">
      <view className="tap-top">
        <view
          className="tap-box"
          main-thread:ref={box}
          style={{ backgroundColor: SENTINEL_A }}
        />
        <text className="tap-count">
          {/* The text's own raw-text element, whose text a 'main thread'
              function can set. */}
          <raw-text main-thread:ref={count} text="Taps: 0" />
        </text>
      </view>
      <view
        className="tap-button"
        accessibility-element
        accessibility-traits="button"
        accessibility-label="Tap"
        main-thread:bindtap={onTap}
      >
        <text className="tap-label">Tap</text>
      </view>
    </view>
  );
}
