import type { ElementRef } from '../../types/lynx';

export const createImageElement = (pageId: number): ElementRef => {
  const element = __CreateImage(pageId);

  // Lynx <image> has no intrinsic "natural" defaults the way the web <img>
  // does — without an explicit mode the native layer falls back to
  // platform-specific behavior (iOS = scaleAspectFill, Android = matrix),
  // which produces inconsistent visuals across devices. Setting these in the
  // creator (rather than relying on per-component config) means every <image>
  // rendered through AngularLynx starts from the same well-defined baseline,
  // matching React Lynx's defaults so behavior is portable across renderers.
  //
  // - mode: 'aspectFit' — preserves aspect ratio inside the box (letterboxes
  //   rather than stretching). Mirrors the web's `object-fit: contain` and is
  //   the safest default for unknown image dimensions.
  // - fadeIn: true — avoids the harsh "pop" when an async-loaded image swaps
  //   in over a transparent slot, which is visually jarring on mobile.
  // - loadingPlaceholder: '' — explicitly clears the slot. Without this,
  //   some native pools reuse the previous element's placeholder, leaking
  //   imagery between recycled list items.
  //
  // Users can still override any of these via [mode]/[fadeIn]/[loadingPlaceholder]
  // bindings, which flow through ngOnChanges → __SetAttribute on the directive.
  __SetConfig(element, {
    mode: 'aspectFit',
    fadeIn: true,
    loadingPlaceholder: '',
  });

  return element;
};
