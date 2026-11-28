import { useState } from '@lynx-js/react';
import { useGlobalProps, useMainThreadRef } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';

import { SENTINEL_A, SENTINEL_B, SENTINEL_MOVER, handlerOf } from '../lib/bench';

// The benchmark's busy screen (benchmarks/SPEC.md, "Busy"), which a
// BENCH_SCREEN build opens on: `busy`, or `busy?handler=main-thread`. The tap
// screen, with a box moving across the top on a CSS animation, and a handler
// that works for 50 ms before it counts the tap.

/**
 * 50 ms of the thread doing nothing else, as a handler that parses, sorts or
 * formats a lot would: on the background thread, and the same as a 'main
 * thread' function (which only a 'main thread' function can call).
 */
const work = () => {
  const end = Date.now() + 50;
  while (Date.now() < end) {
    // Busy on purpose.
  }
};
const workOnMainThread = () => {
  'main thread';
  const end = Date.now() + 50;
  while (Date.now() < end) {
    // Busy on purpose.
  }
};

export default function BenchBusy({ params }: { params: Record<string, string> }) {
  return handlerOf(params) === 'main-thread' ? <MainThreadBusy /> : <DefaultBusy />;
}

function Mover() {
  return (
    <view className="busy-track">
      <view className="busy-mover" style={{ backgroundColor: SENTINEL_MOVER }} />
    </view>
  );
}

/** ReactLynx's default: the work runs in bindtap, on the background thread. */
function DefaultBusy() {
  const [taps, setTaps] = useState(0);
  const { safeAreaTop = 0 } = useGlobalProps();
  return (
    <view className="tap-screen" style={{ paddingTop: `${safeAreaTop}px` }}>
      <Mover />
      <view className="tap-top">
        <view
          className="tap-box"
          style={{ backgroundColor: taps % 2 ? SENTINEL_B : SENTINEL_A }}
        />
        <text className="tap-count">Taps: {taps}</text>
      </view>
      <view
        className="busy-button"
        accessibility-element
        accessibility-traits="button"
        accessibility-label="Busy"
        bindtap={() => {
          work();
          setTaps(n => n + 1);
        }}
      >
        <text className="tap-label">Busy</text>
      </view>
    </view>
  );
}

/** The main thread's way: the work runs in the 'main thread' function. */
function MainThreadBusy() {
  const box = useMainThreadRef<MainThread.Element>(null);
  const count = useMainThreadRef<MainThread.Element>(null);
  const taps = useMainThreadRef(0);
  const { safeAreaTop = 0 } = useGlobalProps();

  const onTap = () => {
    'main thread';
    workOnMainThread();
    taps.current += 1;
    box.current?.setStyleProperty(
      'background-color',
      taps.current % 2 ? SENTINEL_B : SENTINEL_A,
    );
    count.current?.setAttribute('text', `Taps: ${taps.current}`);
  };

  return (
    <view className="tap-screen" style={{ paddingTop: `${safeAreaTop}px` }}>
      <Mover />
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
        className="busy-button"
        accessibility-element
        accessibility-traits="button"
        accessibility-label="Busy"
        main-thread:bindtap={onTap}
      >
        <text className="tap-label">Busy</text>
      </view>
    </view>
  );
}
