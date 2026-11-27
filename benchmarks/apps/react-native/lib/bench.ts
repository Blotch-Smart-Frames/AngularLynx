// The colors the benchmark's probe watches for (benchmarks/harness/probe):
// a native view's background set to one of them is a change the harness
// times. Nothing else in the app uses them.
export const SENTINEL_A = '#fe0102';
export const SENTINEL_B = '#0201fe';

/** The busy screen's moving box, which the probe follows frame by frame. */
export const SENTINEL_MOVER = '#01fe02';
