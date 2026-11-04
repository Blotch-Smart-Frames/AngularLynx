/**
 * `<video>` event details on Lynx for Web.
 *
 * Lynx for Web has no Lynx video element: `<video>` is the browser's own
 * HTMLVideoElement, and `@lynx-js/web-core` passes its DOM events through
 * with `detail: domEvent.detail ?? {}`. A media event has no `detail`, so
 * `bindtimeupdate` arrived with `{}` where native Lynx sends
 * `{ current, duration }`, and a handler reading `detail.current.toFixed(1)`
 * threw. The element is there to read on the main thread, so the details
 * native Lynx sends are filled in from it.
 */

/**
 * Seconds, or 0 where the browser has none yet (`NaN` before metadata).
 */
const seconds = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * The detail native Lynx sends with `eventName` from a `<video>`, read from
 * the web preview's HTMLVideoElement, or undefined for an event whose
 * detail web-core already gets right (or that has none).
 */
export const webVideoDetail = (
  eventName: string,
  video: HTMLVideoElement,
): object | undefined => {
  switch (eventName) {
    case 'timeupdate':
      return {
        current: seconds(video.currentTime),
        duration: seconds(video.duration),
      };
    case 'error':
      // MediaError's code (1 to 4) and message stand in for the native
      // player's: both are what the platform says went wrong.
      return {
        errorCode: video.error?.code ?? 0,
        errorMsg: video.error?.message ?? '',
      };
    default:
      return undefined;
  }
};
