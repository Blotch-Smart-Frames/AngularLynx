import { describe, expect, it } from 'vitest';
import {
  type MenuPlacementOptions,
  type MenuRect,
  menuStartFrame,
  placeMenu,
} from './menu-placement';

/** A phone's screen inside its safe area, in points. */
const AREA = { width: 402, height: 778 };
const MENU = { width: 250, height: 200 };

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): MenuRect => ({ left, top, width, height });

const place = (options: Partial<MenuPlacementOptions> & { anchor: MenuRect }) =>
  placeMenu({ area: AREA, menu: MENU, mode: 'beside', ...options });

describe('placeMenu', () => {
  it('opens below an anchor with room below, lined up with its left edge', () => {
    const placement = place({ anchor: rect(16, 100, 370, 96) });

    expect(placement).toEqual({
      frame: rect(16, 204, 250, 200),
      anchor: rect(16, 100, 370, 96),
      vertical: 'top',
      horizontal: 'left',
    });
  });

  it('lines up with the right edge of an anchor in the right half', () => {
    const placement = place({ anchor: rect(340, 10, 44, 44) });

    expect(placement.horizontal).toBe('right');
    expect(placement.frame.left).toBe(384 - 250);
  });

  it('keeps the menu inside the area horizontally', () => {
    expect(place({ anchor: rect(380, 10, 60, 44) }).frame.left).toBe(
      402 - 8 - 250,
    );
    expect(place({ anchor: rect(-40, 10, 44, 44) }).frame.left).toBe(8);
  });

  it('opens above an anchor near the bottom', () => {
    const placement = place({ anchor: rect(16, 700, 100, 44) });

    expect(placement.vertical).toBe('bottom');
    expect(placement.frame.top).toBe(700 - 8 - 200);
  });

  it('moves a lifted anchor up when the menu fits on neither side', () => {
    const anchor = rect(16, 150, 370, 450);
    const placement = place({ anchor, movableAnchor: true });

    // The anchor moves up until the menu fits below it, inside the margin.
    const anchorTop = 778 - 8 - 200 - 8 - 450;
    expect(placement.anchor).toEqual({ ...anchor, top: anchorTop });
    expect(placement.frame.top).toBe(anchorTop + 450 + 8);
    expect(placement.vertical).toBe('top');
  });

  it('covers an anchor it can neither open beside nor move', () => {
    const anchor = rect(16, 100, 370, 600);

    // Too tall to move out of the way, or not movable: the menu sits at the
    // bottom of the area, over the anchor.
    for (const movableAnchor of [true, false]) {
      const placement = place({ anchor, movableAnchor });
      expect(placement.anchor).toEqual(anchor);
      expect(placement.frame.top).toBe(778 - 8 - 200);
    }
  });

  it('shrinks a menu taller or wider than the area to fit', () => {
    const placement = place({
      anchor: rect(16, 100, 44, 44),
      menu: { width: 500, height: 1000 },
    });

    expect(placement.frame).toEqual(rect(8, 8, 402 - 16, 778 - 16));
  });

  it('grows a pull-down menu over its anchor, from its top edge', () => {
    const placement = place({ anchor: rect(16, 100, 80, 44), mode: 'grow' });

    expect(placement.frame).toEqual(rect(16, 100, 250, 200));
    expect(placement.vertical).toBe('top');
  });

  it('grows a pull-down menu from the bottom edge of an anchor near the bottom', () => {
    const placement = place({ anchor: rect(16, 720, 80, 44), mode: 'grow' });

    expect(placement.frame.top).toBe(764 - 200);
    expect(placement.vertical).toBe('bottom');
  });

  it('takes its own gap and margin', () => {
    const placement = place({
      anchor: rect(0, 100, 80, 40),
      gap: 0,
      margin: 0,
    });

    expect(placement.frame).toEqual(rect(0, 140, 250, 200));
  });
});

describe('menuStartFrame', () => {
  const below = placeMenu({
    anchor: rect(16, 100, 80, 44),
    area: AREA,
    menu: MENU,
    mode: 'beside',
  });
  const aboveRight = placeMenu({
    anchor: rect(300, 700, 80, 44),
    area: AREA,
    menu: MENU,
    mode: 'beside',
  });

  it('starts a pull-down menu as its anchor', () => {
    expect(menuStartFrame(below, 'anchor')).toEqual(below.anchor);
  });

  it('starts a context menu small, in the corner nearest its anchor', () => {
    expect(menuStartFrame(below, 'corner')).toEqual(
      rect(16, 152, 250 * 0.3, 200 * 0.3),
    );
    const { frame } = aboveRight;
    expect(menuStartFrame(aboveRight, 'corner')).toEqual(
      rect(
        frame.left + frame.width - 250 * 0.3,
        frame.top + frame.height - 200 * 0.3,
        250 * 0.3,
        200 * 0.3,
      ),
    );
  });

  it('starts a Material menu as a sliver along the edge nearest its anchor', () => {
    expect(menuStartFrame(below, 'edge')).toEqual(rect(16, 152, 250, 0));
    const { frame } = aboveRight;
    expect(menuStartFrame(aboveRight, 'edge')).toEqual(
      rect(frame.left, frame.top + frame.height, 250, 0),
    );
  });
});
