// The colors the benchmark's probe watches for (benchmarks/harness/probe):
// a native view's background set to one of them is a change the harness
// times. Nothing else in the app uses them.
export const SENTINEL_A = '#fe0102';
export const SENTINEL_B = '#0201fe';

/**
 * Which handlers a benchmark screen uses (its `handler` query parameter):
 * ReactLynx's default, which runs on the background thread and changes the
 * screen through React's state, or `main-thread`, a `main-thread:bindtap`
 * with a 'main thread' function that changes the elements itself, which is
 * what a ReactLynx app does when a tap has to answer quickly.
 */
export type Handler = 'default' | 'main-thread';

export const handlerOf = (params: Record<string, string>): Handler =>
  params.handler === 'main-thread' ? 'main-thread' : 'default';

/** The busy screen's moving box, which the probe follows frame by frame. */
export const SENTINEL_MOVER = '#01fe02';

