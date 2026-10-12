import type { ElementRef } from '../../types/lynx';

export const createScrollCoordinatorElement = (pageId: number): ElementRef => {
  return __CreateElement('scroll-coordinator', pageId);
};

export const createScrollCoordinatorHeaderElement = (
  pageId: number,
): ElementRef => {
  return __CreateElement('scroll-coordinator-header', pageId);
};

export const createScrollCoordinatorToolbarElement = (
  pageId: number,
): ElementRef => {
  return __CreateElement('scroll-coordinator-toolbar', pageId);
};

export const createScrollCoordinatorSlotElement = (
  pageId: number,
): ElementRef => {
  return __CreateElement('scroll-coordinator-slot', pageId);
};

// Draggable variant of the slot: the slot content can be dragged up/down to
// fold/unfold the header (toggled by `enable-drag`).
export const createScrollCoordinatorSlotDragElement = (
  pageId: number,
): ElementRef => {
  return __CreateElement('scroll-coordinator-slot-drag', pageId);
};
