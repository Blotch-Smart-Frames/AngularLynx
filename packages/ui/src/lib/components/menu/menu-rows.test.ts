import { describe, expect, it, vi } from 'vitest';
import { type MenuRow, MenuPress, MenuRows } from './menu-rows';

const aRow = (): MenuRow => ({
  element: () => ({ element: {} }),
  disabled: () => false,
  choose: vi.fn(),
});

/**
 * A touch event with one finger at (x, y), as Lynx sends it.
 */
const touch = (x: number, y: number) => ({
  touches: [{ clientX: x, clientY: y }],
});

/**
 * A touchend: the finger that lifted is only in changedTouches.
 */
const lift = (x: number, y: number) => ({
  touches: [],
  changedTouches: [{ clientX: x, clientY: y }],
});

const renderPress = () => {
  const target = { dragTo: vi.fn(), dropAt: vi.fn() };
  return { target, press: new MenuPress(() => target) };
};

describe('MenuRows', () => {
  it('keeps its rows in order until each is taken away', () => {
    const rows = new MenuRows();
    const first = aRow();
    const second = aRow();
    const removeFirst = rows.add(first);
    rows.add(second);
    expect(rows.all()).toEqual([first, second]);

    removeFirst();
    expect(rows.all()).toEqual([second]);
  });

  it('counts each change to its rows', () => {
    const rows = new MenuRows();
    const start = rows.version;
    const remove = rows.add(aRow());
    expect(rows.version).toBe(start + 1);
    remove();
    expect(rows.version).toBe(start + 2);
  });

  it('turns the highlight off when the lit row goes', () => {
    const rows = new MenuRows();
    const lit = aRow();
    const other = aRow();
    const removeLit = rows.add(lit);
    const removeOther = rows.add(other);
    rows.highlighted.set(lit);

    removeOther();
    expect(rows.highlighted()).toBe(lit);
    removeLit();
    expect(rows.highlighted()).toBeNull();
  });
});

describe('MenuRows taps', () => {
  it('owns the taps of the press that opened the menu, until shortly after it lifts', () => {
    vi.useFakeTimers();
    const rows = new MenuRows();
    expect(rows.ownsTap()).toBe(false);

    rows.pressStarted();
    expect(rows.ownsTap()).toBe(true);
    // Still down: every tap is the press's.
    expect(rows.ownsTap()).toBe(true);
    rows.pressEnded();
    expect(rows.ownsTap()).toBe(true);
    // The one tap a press sends is used up.
    expect(rows.ownsTap()).toBe(false);

    rows.pressStarted();
    rows.pressEnded();
    vi.advanceTimersByTime(600);
    expect(rows.ownsTap()).toBe(false);

    // A lift with no press, as on Material, owns nothing.
    rows.pressEnded();
    expect(rows.ownsTap()).toBe(false);
    vi.useRealTimers();
  });

  it('owns no tap after the system takes the press over', () => {
    const rows = new MenuRows();
    rows.pressStarted();
    rows.pressCanceled();
    expect(rows.ownsTap()).toBe(false);

    // A cancel with no press leaves a lift's tap the press's.
    rows.pressStarted();
    rows.pressEnded();
    rows.pressCanceled();
    expect(rows.ownsTap()).toBe(true);
  });
});

describe('MenuPress', () => {
  it('follows a finger once it moves further than a tap would', () => {
    const { target, press } = renderPress();
    press.start(touch(100, 100));
    expect(press.active).toBe(true);

    press.move(touch(105, 105));
    expect(target.dragTo).not.toHaveBeenCalled();

    press.move(touch(100, 120));
    expect(target.dragTo).toHaveBeenLastCalledWith({ x: 100, y: 120 });
    // Once dragging, every move counts, even back near the start.
    press.move(touch(101, 101));
    expect(target.dragTo).toHaveBeenLastCalledWith({ x: 101, y: 101 });

    expect(press.end(lift(101, 140))).toBe(true);
    expect(target.dropAt).toHaveBeenCalledWith({ x: 101, y: 140 });
    expect(press.active).toBe(false);
  });

  it('chooses nothing when the finger lifts without having moved', () => {
    const { target, press } = renderPress();
    press.start(touch(100, 100));

    expect(press.end(lift(100, 100))).toBe(true);
    expect(target.dropAt).not.toHaveBeenCalled();
    expect(target.dragTo).not.toHaveBeenCalled();
  });

  it('drops where the lifting finger is, while another stays down', () => {
    const { target, press } = renderPress();
    press.start(touch(100, 100));
    press.move(touch(100, 150));

    press.end({
      touches: [{ clientX: 300, clientY: 300 }],
      changedTouches: [{ clientX: 100, clientY: 160 }],
    });
    expect(target.dropAt).toHaveBeenCalledWith({ x: 100, y: 160 });

    // A lift that reports only the fingers still down drops at the first.
    press.start(touch(100, 100));
    press.move(touch(100, 150));
    press.end(touch(100, 170));
    expect(target.dropAt).toHaveBeenLastCalledWith({ x: 100, y: 170 });
  });

  it('turns the highlight off for a lift it has no point for', () => {
    const { target, press } = renderPress();
    press.start(touch(100, 100));
    press.move(touch(100, 150));

    expect(press.end({})).toBe(true);
    expect(target.dropAt).not.toHaveBeenCalled();
    expect(target.dragTo).toHaveBeenLastCalledWith(null);
  });

  it('ignores moves and lifts without a press, or without a point', () => {
    const { target, press } = renderPress();
    press.move(touch(100, 150));
    expect(press.end(lift(100, 150))).toBe(false);

    // A press whose event has no finger isn't followed.
    press.start({ touches: [{}] });
    expect(press.active).toBe(false);
    press.start(null);
    expect(press.active).toBe(false);

    press.start(touch(100, 100));
    press.move({ touches: [] });
    expect(target.dragTo).not.toHaveBeenCalled();
    expect(target.dropAt).not.toHaveBeenCalled();
  });

  it('stops following, and turns the highlight off, when canceled', () => {
    const { target, press } = renderPress();
    press.start(touch(100, 100));
    press.cancel();
    expect(press.active).toBe(false);
    expect(target.dragTo).not.toHaveBeenCalled();

    press.start(touch(100, 100));
    press.move(touch(100, 150));
    press.cancel();
    expect(target.dragTo).toHaveBeenLastCalledWith(null);
    expect(press.end(lift(100, 150))).toBe(false);
  });
});
