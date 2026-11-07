/** A box on screen, in px. */
export type MenuRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** A size, in px. */
export type MenuSize = { readonly width: number; readonly height: number };

/**
 * How a menu sits against the element that opened it.
 *
 * - `'grow'`: over it, from its top edge (or its bottom edge, near the bottom
 *   of the screen), as Apple's pull-down menus grow out of their button.
 * - `'beside'`: below it, or above it near the bottom of the screen, a gap
 *   away. Context menus open beside the pressed element, and Material menus
 *   beside their anchor.
 */
export type MenuPlacementMode = 'grow' | 'beside';

export type MenuPlacementOptions = {
  /** The element that opened the menu, in the area's coordinates. */
  readonly anchor: MenuRect;
  /** The area the menu has to stay in: the screen inside its safe area. */
  readonly area: MenuSize;
  /** The menu's size at rest. */
  readonly menu: MenuSize;
  readonly mode: MenuPlacementMode;
  /**
   * Whether the anchor may move to make room, as the lifted element of a
   * context menu does when the menu fits neither below nor above it.
   */
  readonly movableAnchor?: boolean;
  /** The space between the menu and a `'beside'` anchor. */
  readonly gap?: number;
  /** The space the menu keeps from the area's edges. */
  readonly margin?: number;
};

export type MenuPlacement = {
  /** The menu's box at rest. */
  readonly frame: MenuRect;
  /**
   * Where the anchor sits while the menu is open: where it was, unless
   * `movableAnchor` let it move to make room.
   */
  readonly anchor: MenuRect;
  /**
   * The menu edge nearest the anchor, which the menu grows from and its
   * content is pinned to: it hangs from its `'top'` below or over the anchor,
   * and stands on its `'bottom'` above it.
   */
  readonly vertical: 'top' | 'bottom';
  /**
   * The anchor edge the menu lines up with: its `'right'` edge for an anchor
   * entirely in the right half of the area, such as a button in a corner,
   * so the menu opens toward the middle of the screen, and its `'left'` edge
   * otherwise, which includes a row as wide as the screen.
   */
  readonly horizontal: 'left' | 'right';
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where a menu goes on screen, beside or over the element that opened it,
 * kept inside the area (the screen within its safe area): below the element,
 * or above it when there's no room below, lined up with whichever of its
 * edges is nearer the middle of the screen.
 */
export const placeMenu = ({
  anchor,
  area,
  menu,
  mode,
  movableAnchor = false,
  gap = 8,
  margin = 8,
}: MenuPlacementOptions): MenuPlacement => {
  const width = clamp(menu.width, 0, area.width - 2 * margin);
  const height = clamp(menu.height, 0, area.height - 2 * margin);
  const horizontal = anchor.left < area.width / 2 ? 'left' : 'right';
  const left = clamp(
    horizontal === 'left' ? anchor.left : anchor.left + anchor.width - width,
    margin,
    area.width - margin - width,
  );
  const bottomLimit = area.height - margin;
  const anchorBottom = anchor.top + anchor.height;

  const place = (
    top: number,
    vertical: 'top' | 'bottom',
    anchorTop = anchor.top,
  ): MenuPlacement => ({
    frame: {
      left,
      top: clamp(top, margin, bottomLimit - height),
      width,
      height,
    },
    anchor: { ...anchor, top: anchorTop },
    vertical,
    horizontal,
  });

  if (mode === 'grow') {
    // Over the anchor, from its top edge, or else from its bottom edge.
    return anchor.top + height <= bottomLimit
      ? place(anchor.top, 'top')
      : place(anchorBottom - height, 'bottom');
  }

  if (anchorBottom + gap + height <= bottomLimit) {
    return place(anchorBottom + gap, 'top');
  }
  if (anchor.top - gap - height >= margin) {
    return place(anchor.top - gap - height, 'bottom');
  }
  // Room on neither side. A lifted element moves up until the menu fits
  // below it, as iOS moves a context menu's preview; if even that can't
  // make room, or the anchor can't move, the menu covers the anchor.
  const anchorTop = bottomLimit - height - gap - anchor.height;
  if (movableAnchor && anchorTop >= margin) {
    return place(anchorTop + anchor.height + gap, 'top', anchorTop);
  }
  return place(bottomLimit - height, 'top');
};

/**
 * Where a menu starts growing from, and shrinks back to, as it opens and
 * closes.
 *
 * - From the anchor itself for a `'grow'` menu: one shape whose frame grows,
 *   which Liquid Glass follows frame by frame (its glass can't morph one
 *   shape into another).
 * - From a small box in the corner nearest the anchor for a context menu.
 * - From a sliver along the edge nearest the anchor for Material, whose
 *   menus unfold from their anchor.
 */
export const menuStartFrame = (
  placement: MenuPlacement,
  from: 'anchor' | 'corner' | 'edge',
): MenuRect => {
  const { frame, anchor, vertical, horizontal } = placement;
  if (from === 'anchor') return anchor;
  const scale = from === 'corner' ? 0.3 : 1;
  const width = frame.width * scale;
  const height = from === 'corner' ? frame.height * scale : 0;
  return {
    left: horizontal === 'left' ? frame.left : frame.left + frame.width - width,
    top: vertical === 'top' ? frame.top : frame.top + frame.height - height,
    width,
    height,
  };
};
