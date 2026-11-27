import { memo, useGlobalProps, useMainThreadRef, useState } from '@lynx-js/react';

import { SENTINEL_A, SENTINEL_B, handlerOf } from '../lib/bench';

// The benchmark's partial-update screen (benchmarks/SPEC.md, "Update"), which
// a BENCH_SCREEN build opens on: `update?rows=1000`, with `&handler=main-thread`
// for the main thread's way.

const BUTTONS = [
  { every: 0, label: '1 row' },
  { every: 10, label: 'Every 10th' },
  { every: 1, label: 'Every row' },
] as const;

/** The rows a button changes: row 0 (every = 0), every 10th row, or every row. */
const changed = (count: number, every: number) => {
  const step = every || count;
  const rows: number[] = [];
  for (let i = 0; i < count; i += step) rows.push(i);
  return rows;
};

export default function BenchUpdate({ params }: { params: Record<string, string> }) {
  const count = Number(params.rows) > 0 ? Number(params.rows) : 1000;
  return handlerOf(params) === 'main-thread' ? (
    <MainThreadUpdate count={count} />
  ) : (
    <DefaultUpdate count={count} />
  );
}

/**
 * ReactLynx's default: the handler sets state on the background thread, and
 * React re-renders the rows whose value changed (memo keeps the others),
 * sending the difference to the main thread.
 */
function DefaultUpdate({ count }: { count: number }) {
  const [values, setValues] = useState(() => new Array<number>(count).fill(0));
  const { safeAreaTop = 0 } = useGlobalProps();

  const change = (every: number) => {
    setValues(previous => {
      const next = previous.slice();
      for (const i of changed(count, every)) next[i] = (next[i] ?? 0) + 1;
      return next;
    });
  };

  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(<Row key={i} id={i} value={values[i] ?? 0} />);
  }

  return (
    <view className="update-screen" style={{ paddingTop: `${safeAreaTop}px` }}>
      <scroll-view className="update-rows" scroll-orientation="vertical">
        {rows}
      </scroll-view>
      <view className="update-buttons">
        {BUTTONS.map(button => (
          <view
            key={button.every}
            className="update-button"
            accessibility-element
            accessibility-trait="button"
            accessibility-label={button.label}
            bindtap={() => change(button.every)}
          >
            <text className="update-label">{button.label}</text>
          </view>
        ))}
      </view>
    </view>
  );
}

const Row = memo(function Row({ id, value }: { id: number; value: number }) {
  return (
    <view className="update-row">
      <view
        className="update-box"
        style={{ backgroundColor: value % 2 ? SENTINEL_B : SENTINEL_A }}
      />
      <text className="update-name">Row {id}</text>
      <text className="update-value">{value}</text>
    </view>
  );
});

/**
 * The main thread's way: each button's 'main thread' function finds the
 * rows' elements and sets the changed rows' color and text itself. React
 * renders the rows once and never again.
 */
function MainThreadUpdate({ count }: { count: number }) {
  const { safeAreaTop = 0 } = useGlobalProps();
  const values = useMainThreadRef<number[]>([]);

  // A 'main thread' function for each button, made with its step.
  const change = (every: number) => () => {
    'main thread';
    const boxes = lynx.querySelectorAll('.update-box');
    const texts = lynx.querySelectorAll('.update-value-text');
    const step = every || count;
    for (let i = 0; i < count; i += step) {
      const value = (values.current[i] ?? 0) + 1;
      values.current[i] = value;
      boxes[i]?.setStyleProperty('background-color', value % 2 ? SENTINEL_B : SENTINEL_A);
      texts[i]?.setAttribute('text', `${value}`);
    }
  };

  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      <view key={i} className="update-row">
        <view className="update-box" style={{ backgroundColor: SENTINEL_A }} />
        <text className="update-name">Row {i}</text>
        <text className="update-value">
          <raw-text className="update-value-text" text="0" />
        </text>
      </view>,
    );
  }

  return (
    <view className="update-screen" style={{ paddingTop: `${safeAreaTop}px` }}>
      <scroll-view className="update-rows" scroll-orientation="vertical">
        {rows}
      </scroll-view>
      <view className="update-buttons">
        {BUTTONS.map(button => (
          <view
            key={button.every}
            className="update-button"
            accessibility-element
            accessibility-trait="button"
            accessibility-label={button.label}
            main-thread:bindtap={change(button.every)}
          >
            <text className="update-label">{button.label}</text>
          </view>
        ))}
      </view>
    </view>
  );
}
