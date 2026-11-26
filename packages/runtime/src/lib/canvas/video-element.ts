import { LynxElement } from '../lynx-element/lynx-element';
import type { ElementRef } from '../types/lynx';
import { CANVAS_SOURCE, type CanvasSource } from './canvas-source';
import { getVideoFrameSize } from './webgl-bridge';

// A page-unique prefix for video ids, as canvas ids have (canvas-surface.ts):
// two LynxViews in one app each have their own JavaScript, and the shell's
// registry is the app's.
const ID_PREFIX = `v${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;
let nextVideoId = 1;

/** HTMLMediaElement's readyState values. */
const HAVE_NOTHING = 0;
const HAVE_ENOUGH_DATA = 4;

/**
 * `<video>`: Lynx's video element, which can also be read as an image, as
 * an HTMLVideoElement can. `drawImage()` and `createPattern()` on a 2D
 * canvas, and WebGL's `texImage2D()` (three.js's VideoTexture), read the
 * frame it's showing.
 *
 * On iOS and Android the shell's video element (AngularLynxVideo.m,
 * VideoUI.kt) keeps the player's latest frame, which the canvas contexts
 * read by the video's id, as they read a canvas by its id, so the pixels
 * never travel through JavaScript. `videoWidth`, `videoHeight` and
 * `readyState` ask the shell for the frame it has; before the first frame
 * they're 0 and HAVE_NOTHING, and a canvas draws nothing from the video,
 * as a browser does. On Lynx for Web the element is the browser's own
 * HTMLVideoElement, which they read.
 */
export class LynxVideoElement extends LynxElement {
  /** The id that pairs this video with its native view. */
  readonly videoId = `${ID_PREFIX}-${nextVideoId++}`;

  readonly HAVE_NOTHING = HAVE_NOTHING;
  readonly HAVE_METADATA = 1;
  readonly HAVE_CURRENT_DATA = 2;
  readonly HAVE_FUTURE_DATA = 3;
  readonly HAVE_ENOUGH_DATA = HAVE_ENOUGH_DATA;

  constructor(element: ElementRef) {
    super(element);
    this.tagName = 'video';
    if (!__WEB__) {
      // Pairs the native view with the id the canvas contexts read it by.
      this.setAttribute('video-id', this.videoId);
      const videoId = this.videoId;
      Object.defineProperty(this, CANVAS_SOURCE, {
        // A getter: the frame's size is the shell's, and changes as the
        // video plays (a new source, a stream changing resolution).
        get: (): CanvasSource => {
          const { width, height } = getVideoFrameSize(videoId);
          return {
            canvasId: videoId,
            width,
            height,
            readable: true,
            video: true,
            // The shell reads the frame when the context's calls run.
            flush: () => {},
          };
        },
        enumerable: false,
      });
    }
  }

  get #dom(): HTMLVideoElement {
    return this.element as unknown as HTMLVideoElement;
  }

  /**
   * The width of the frame the video shows, in pixels; 0 before the first.
   */
  get videoWidth(): number {
    return __WEB__
      ? this.#dom.videoWidth
      : getVideoFrameSize(this.videoId).width;
  }

  /**
   * The height of the frame the video shows, in pixels; 0 before the first.
   */
  get videoHeight(): number {
    return __WEB__
      ? this.#dom.videoHeight
      : getVideoFrameSize(this.videoId).height;
  }

  /**
   * HAVE_ENOUGH_DATA once the shell has a frame of the video, HAVE_NOTHING
   * before. three.js's VideoTexture uploads a frame each render while it's at
   * least HAVE_CURRENT_DATA. Lynx's player doesn't say how much it has
   * buffered, so the states between aren't told apart.
   */
  get readyState(): number {
    if (__WEB__) return this.#dom.readyState;
    return getVideoFrameSize(this.videoId).width > 0
      ? HAVE_ENOUGH_DATA
      : HAVE_NOTHING;
  }
}
