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
