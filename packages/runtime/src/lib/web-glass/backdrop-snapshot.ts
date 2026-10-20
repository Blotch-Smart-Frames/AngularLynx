import {
  cloneBackdrop,
  effectiveBackground,
  type CloneOptions,
} from './backdrop-clone';
import { luminance } from './css-color';
import { drawnScale } from './drawn-scale';

/** An image of what sits behind a glass group. */
export type BackdropSnapshot = {
  image: HTMLCanvasElement;
  /** The captured region, relative to the backdrop root, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** How bright the backdrop's background is, from 0 to 1. */
  luminance: number;
};

export type SnapshotOptions = {
  /** Device pixels per CSS pixel to capture at. */
  scale: number;
} & CloneOptions;

// Keeps the image inside every GPU's texture limit (WebGL 1 guarantees far
// less, but phones and desktops alike accept 4096).
const MAX_IMAGE_SIZE = 4096;

/**
 * Captures part of `root` as an image. The browser can't hand page pixels to
 * WebGL, so the page is redrawn instead: the subtree is copied with inlined
 * styles (see backdrop-clone.ts), wrapped in an SVG `<foreignObject>` and
 * drawn to a canvas. The SVG's viewBox crops it to `region`, so only the area
 * the glass can show is rasterized.
 *
 * Resolves to null when the region doesn't overlap `root`.
 */
export const snapshotBackdrop = async (
  root: HTMLElement,
  options: SnapshotOptions,
): Promise<BackdropSnapshot | null> => {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const bounds = root.getBoundingClientRect();
  const left = Math.max(options.region.left, bounds.left);
  const top = Math.max(options.region.top, bounds.top);
  const right = Math.min(options.region.right, bounds.right);
  const bottom = Math.min(options.region.bottom, bounds.bottom);
  if (right <= left || bottom <= top) return null;
  // The region and the root's box are in screen pixels, but the copy lays out
  // in CSS pixels: the two differ when the page is drawn scaled.
  const zoom = drawnScale(root);
  const x = (left - bounds.left) / zoom;
  const y = (top - bounds.top) / zoom;
  const width = (right - left) / zoom;
  const height = (bottom - top) / zoom;
  const scale = Math.min(
    options.scale,
    MAX_IMAGE_SIZE / Math.max(width, height),
  );

  const markup = new win.XMLSerializer().serializeToString(
    cloneBackdrop(root, options),
  );
  const pixelWidth = Math.max(1, Math.round(width * scale));
  const pixelHeight = Math.max(1, Math.round(height * scale));
  // The image's edges must be opaque: the glass clamps to them where its lens
  // looks past the image, so a transparent row there shows as a dark band.
  // Rounding the image's width and height separately leaves its shape a
  // little off the viewBox's, which the default `preserveAspectRatio` would
  // fit with an empty strip along one edge, so the viewBox is stretched
  // instead. The <foreignObject> matches the copy's frame, which is rounded up
  // to whole pixels (see cloneBackdrop).
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" ` +
    `height="${pixelHeight}" viewBox="${x} ${y} ${width} ${height}" ` +
    `preserveAspectRatio="none">` +
    `<foreignObject width="${Math.ceil(bounds.width / zoom)}" ` +
    `height="${Math.ceil(bounds.height / zoom)}">` +
    `${markup}</foreignObject></svg>`;
  const picture = new win.Image();
  picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await picture.decode();

  const image = doc.createElement('canvas');
  image.width = pixelWidth;
  image.height = pixelHeight;
  image.getContext('2d')!.drawImage(picture, 0, 0, pixelWidth, pixelHeight);
  return {
    image,
    x,
    y,
    width,
    height,
    luminance: luminance(effectiveBackground(root)),
  };
};
