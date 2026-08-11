import type { ElementRef } from '../../types/lynx';

// __CreateElement('block', pageId) creates a plain generic FiberElement whose
// tag happens to be the string "block" — it is NOT the native BlockElement
// C++ subclass (only __CreateBlock() constructs that). A generic element
// isn't layout-only, so it reaches the native painting pipeline and tries to
// create a real UI for tag "block", which no platform registers a UI class
// for, crashing with "block ui not found when create UI" (native only — the
// web platform's generic __CreateElement path renders a plain DOM element
// and never hits this).
//
// React Lynx (the production reference) never creates "block"/"if"/"for"
// tagged elements at all for this purpose. Its equivalent invisible grouping
// container is __CreateWrapperElement, whose WrapperElement C++ class always
// sets is_layout_only_ = true unconditionally, which the native painting
// pipeline skips (ElementContainer::CreatePaintingNode short-circuits on
// IsLayoutOnly()) — so it never needs a registered native UI at all. It's
// implemented on both native and the web platform (unlike __CreateBlock).
export const createBlockElement = (pageId: number): ElementRef => {
  return __CreateWrapperElement(pageId);
};
