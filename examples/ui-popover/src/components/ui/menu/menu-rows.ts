import { signal } from '@angular/core';

import { type MenuElement } from './menu-popup';

/** A point in the window's coordinates, in px, as a touch reports it. */
export type MenuPoint = { readonly x: number; readonly y: number };

/**
 * A row of a menu that a finger can slide onto and lift on to choose: an
 * item, or the row that opens a submenu.
 */
export type MenuRow = {
  /** The row's element, which the menu measures. */
  element(): MenuElement;
  /** Whether the row can't be chosen now. */
  disabled(): boolean;
  /** Does what a tap on the row does. */
  choose(): void;
  /**
   * Whether the row opens a submenu, which a finger sliding across the menu
   * opens by resting on the row, as UIKit's does, and carries on into.
   */
  readonly opensSubmenu?: boolean;
};

/**
 * What a menu shares with its items, sections and submenus: the rows a
 * finger can slide onto, and how the menu draws them while it's open.
 *
 * `ui-menu`, `ui-context-menu` and `ui-menu-submenu` each hold one and hand
 * it to their `ui-menu-popup`, which measures the rows as it opens and
 * writes how it placed them.
 */
export class MenuRows {
  readonly #rows = new Set<MenuRow>();
  readonly #parent: MenuRows | null;

  /**
   * `parent` is the rows of the menu a submenu is in: the press that opened
   * that menu is the one a submenu's taps can belong to (see ownsTap).
   */
  constructor(parent: MenuRows | null = null) {
    this.#parent = parent;
  }

  /**
   * The open submenu's menu, which a finger sliding across this menu moves
   * on to: it covers this one, so the finger is over its rows now.
   */
  openSubmenu: MenuDragTarget | null = null;

  /** The row under a finger sliding across the menu, if any. */
  readonly highlighted = signal<MenuRow | null>(null);
  /**
   * Whether the menu lists its rows from the bottom up: an Apple menu that
   * opens upward puts its first item nearest the finger, as UIKit's
   * `preferredElementOrder` does.
   */
  readonly reversed = signal(false);
  /** Whether the menu is open or opening, and not yet closing. */
  readonly shown = signal(false);
  /** Whether a submenu is open over the menu, which fades its rows. */
  readonly covered = signal(false);

  /** Counts changes to the rows, so a menu can tell its measurements are old. */
  #version = 0;

  /** Whether a finger that opened the menu is still down. */
  #pressing = false;
  /** When that finger lifted, in ms. */
  #liftedAt = -Infinity;

  /**
   * A finger touched down and opened the menu (see MenuPress).
   */
  pressStarted(): void {
    this.#pressing = true;
  }

  /**
   * That finger lifted: the tap Lynx sends after it is the press's.
   */
  pressEnded(): void {
    if (!this.#pressing) return;
    this.#pressing = false;
    this.#liftedAt = Date.now();
  }

  /**
   * The system took that finger's touch over, as a scroll does, or what it
   * pressed went away: no tap follows, so the next one is a tap of its own.
   */
  pressCanceled(): void {
    if (!this.#pressing) return;
    this.#pressing = false;
    this.#liftedAt = -Infinity;
  }

  /**
   * Whether a tap belongs to the press that opened the menu, and so does
   * nothing. Lynx sends a tap as the finger lifts, to whatever is under it
   * then: the trigger, or the row that grew under the finger, which a press
   * that lifts without sliding mustn't choose (and a slide has chosen
   * already). A tap later than TAP_AFTER_PRESS is one of its own, such as a
   * screen reader's. A submenu's rows ask the menu it's in: a finger that
   * rested on its row to open it lifts on one of its items.
   */
  ownsTap(): boolean {
    const owned =
      this.#pressing || Date.now() - this.#liftedAt < TAP_AFTER_PRESS;
    this.#liftedAt = this.#pressing ? this.#liftedAt : -Infinity;
    return owned || (this.#parent?.ownsTap() ?? false);
  }

  /**
   * Adds a row, until the returned function takes it away.
   */
  add(row: MenuRow): () => void {
    this.#rows.add(row);
    this.#version++;
    return () => {
      this.#rows.delete(row);
      this.#version++;
      if (this.highlighted() === row) this.highlighted.set(null);
    };
  }

  /**
   * Changes each time a row is added or taken away: the rows after it move,
   * so where the menu measured them no longer holds.
   */
  get version(): number {
    return this.#version;
  }

  /**
   * Every row, in the order they were added.
   */
  all(): readonly MenuRow[] {
    return [...this.#rows];
  }
}

/**
 * How long after a press lifts its tap can arrive, in ms. Lynx sends the
 * tap after the touch ends; one later than this is a tap of its own.
 */
const TAP_AFTER_PRESS = 500;

/**
 * How far, in px, a finger moves before its press becomes a drag across the
 * menu. A press that lifts without moving leaves the menu open, as UIKit's
 * does, rather than choosing the item that grew under the finger.
 */
const DRAG_SLOP = 10;

/** What a Lynx touch event carries, as far as a drag reads it. */
type TouchEventLike = {
  readonly touches?: readonly TouchLike[];
  readonly changedTouches?: readonly TouchLike[];
};
type TouchLike = { readonly clientX?: number; readonly clientY?: number };

/**
 * Where a touch event's finger is, in the window's coordinates: the first
 * touch still down, or, for a `touchend` (`lifted`), the one that lifted,
 * which is in `changedTouches` while `touches` holds any finger still down.
 * Lynx reports `clientX` and `clientY` in the window, which is how the menu
 * measures its elements (see measureMenuElement).
 */
const touchPoint = (event: unknown, lifted = false): MenuPoint | null => {
  const touch = event as TouchEventLike | null;
  const point = lifted
    ? (touch?.changedTouches?.[0] ?? touch?.touches?.[0])
    : (touch?.touches?.[0] ?? touch?.changedTouches?.[0]);
  return typeof point?.clientX === 'number' && typeof point.clientY === 'number'
    ? { x: point.clientX, y: point.clientY }
    : null;
};

/**
 * What a press tells the menu as a finger slides across it: `dragTo()`
 * highlights the row under the finger, and `dropAt()` chooses it.
 */
export type MenuDragTarget = {
  dragTo(point: MenuPoint | null): void;
  dropAt(point: MenuPoint): void;
};

/**
 * A press that opened a menu, or held its element until a context menu
 * opened, followed as the finger slides onto an item and lifts to choose it,
 * as on iOS.
 */
export class MenuPress {
  readonly #target: () => MenuDragTarget;
  #start: MenuPoint | null = null;
  #dragging = false;

  constructor(target: () => MenuDragTarget) {
    this.#target = target;
  }

  /**
   * Whether a finger is down.
   */
  get active(): boolean {
    return this.#start !== null;
  }

  /**
   * A finger touched down.
   */
  start(event: unknown): void {
    this.#start = touchPoint(event);
    this.#dragging = false;
  }

  /**
   * The finger moved: once it has gone further than a tap would, the row
   * under it lights up.
   */
  move(event: unknown): void {
    const start = this.#start;
    const point = touchPoint(event);
    if (!start || !point) return;
    if (
      !this.#dragging &&
      Math.hypot(point.x - start.x, point.y - start.y) > DRAG_SLOP
    ) {
      this.#dragging = true;
    }
    if (this.#dragging) this.#target().dragTo(point);
  }

  /**
   * The finger lifted: after a drag, the row under it is chosen. Returns
   * whether a press was being followed.
   */
  end(event: unknown): boolean {
    const start = this.#start;
    const point = touchPoint(event, true);
    const dragging = this.#dragging;
    this.#start = null;
    this.#dragging = false;
    if (!start) return false;
    if (dragging && point) this.#target().dropAt(point);
    else if (dragging) this.#target().dragTo(null);
    return true;
  }

  /**
   * The system took the touch over, as a scroll does.
   */
  cancel(): void {
    if (this.#dragging) this.#target().dragTo(null);
    this.#start = null;
    this.#dragging = false;
  }
}
