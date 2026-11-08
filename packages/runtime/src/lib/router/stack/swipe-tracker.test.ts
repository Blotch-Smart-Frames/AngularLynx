import { describe, expect, it } from 'vitest';
import { EDGE_WIDTH, SwipeTracker } from './swipe-tracker';

const WIDTH = 400;

describe('SwipeTracker', () => {
  it('starts deciding a touch at the edge, or anywhere when content swipes are allowed', () => {
    expect(new SwipeTracker(EDGE_WIDTH, 300, 0, WIDTH, false).state).toBe(
      'pending',
    );
    expect(new SwipeTracker(EDGE_WIDTH, 300, 0, WIDTH, false).fromEdge).toBe(
      true,
    );
    expect(new SwipeTracker(200, 300, 0, WIDTH, true).state).toBe('pending');
  });

  it("ignores a touch away from the edge where content can't swipe", () => {
    const tracker = new SwipeTracker(EDGE_WIDTH + 1, 300, 0, WIDTH, false);
    expect(tracker.state).toBe('ignored');
    expect(tracker.move(300, 300, 16)).toBe('ignored');
  });

  it('stays a tap until the finger moves further than the slop', () => {
    const tracker = new SwipeTracker(100, 300, 0, WIDTH, true);
    expect(tracker.move(108, 302, 16)).toBe('pending');
  });

  it('drags once the finger moves right more than it moves up or down', () => {
    const tracker = new SwipeTracker(100, 300, 0, WIDTH, true);
    expect(tracker.move(115, 305, 16)).toBe('dragging');
    expect(tracker.progress).toBeCloseTo(15 / WIDTH);
    // It keeps dragging whichever way the finger goes from then on.
    expect(tracker.move(150, 380, 32)).toBe('dragging');
  });

  it('leaves a touch that moves left to the page', () => {
    const tracker = new SwipeTracker(100, 300, 0, WIDTH, true);
    expect(tracker.move(85, 300, 16)).toBe('ignored');
  });

  it('leaves a touch that moves up or down first to the page', () => {
    const tracker = new SwipeTracker(100, 300, 0, WIDTH, true);
    expect(tracker.move(105, 320, 16)).toBe('ignored');
  });

  it('keeps progress between 0 and 1', () => {
    const tracker = new SwipeTracker(10, 300, 0, WIDTH, false);
    tracker.move(30, 300, 16);
    tracker.move(0, 300, 32);
    expect(tracker.progress).toBe(0);
    tracker.move(600, 300, 48);
    expect(tracker.progress).toBe(1);
  });

  it("measures the finger's speed over its last moves", () => {
    const tracker = new SwipeTracker(10, 300, 0, WIDTH, false);
    // Slow at first, then 2px per ms for the last 80ms.
    tracker.move(30, 300, 100);
    tracker.move(40, 300, 200);
    tracker.move(120, 300, 240);
    tracker.move(200, 300, 280);
    expect(tracker.velocity).toBeCloseTo(2);
  });

  it('has no speed before the finger moves', () => {
    expect(new SwipeTracker(10, 300, 0, WIDTH, false).velocity).toBe(0);
  });

  it('completes a slow drag past the middle, and brings back one short of it', () => {
    const past = new SwipeTracker(10, 300, 0, WIDTH, false);
    past.move(100, 300, 1000);
    past.move(215, 300, 2000);
    expect(past.completes()).toBe(true);

    const short = new SwipeTracker(10, 300, 0, WIDTH, false);
    short.move(100, 300, 1000);
    short.move(180, 300, 2000);
    expect(short.completes()).toBe(false);
  });

  it('completes a flick from anywhere, and brings back a drag flung back', () => {
    const flick = new SwipeTracker(10, 300, 0, WIDTH, false);
    flick.move(30, 300, 10);
    flick.move(60, 300, 40);
    expect(flick.completes()).toBe(true);

    const flungBack = new SwipeTracker(10, 300, 0, WIDTH, false);
    flungBack.move(300, 300, 1000);
    flungBack.move(260, 300, 1040);
    expect(flungBack.completes()).toBe(false);
  });
});
