import type { LynxEvent, WithPrefixes } from './lynx-event';

// The events only some elements fire, and the type each one's `$event` has.
// The detail types match the Events tables of the element pages in the docs
// (packages/website/docs/api/elements), which say where a field is only on
// some platforms or needs an attribute.

// ---- <image> and <svg> ----------------------------------------------------

/** `<image>` and `<svg>`'s `bindload` detail: the image's own size, in px. */
export type ImageLoadDetail = {
  readonly width: number;
  readonly height: number;
};

/** `<image>`'s `binderror` detail. */
export type ImageErrorDetail = {
  readonly errMsg: string;
  readonly error_code: number;
  readonly lynx_categorized_code: number;
};

export type LynxImageEventMap = WithPrefixes<{
  bindload: LynxEvent<ImageLoadDetail>;
  binderror: LynxEvent<ImageErrorDetail>;
  // Animated images, on iOS and Android. They have no detail.
  bindstartplay: LynxEvent;
  bindcurrentloopcomplete: LynxEvent;
  bindfinalloopcomplete: LynxEvent;
}>;

export type LynxSvgEventMap = WithPrefixes<{
  bindload: LynxEvent<ImageLoadDetail>;
}>;

// ---- <text> ----------------------------------------------------------------

/** `<text>`'s `bindlayout` detail. */
export type TextLayoutDetail = {
  readonly lineCount: number;
  /** A line with `ellipsisCount` above 0 was truncated. */
  readonly lines: readonly {
    readonly start: number;
    readonly end: number;
    readonly ellipsisCount: number;
  }[];
  readonly size: { readonly width: number; readonly height: number };
};

/** `<text>`'s `bindselectionchange` detail (iOS and Android). */
export type TextSelectionChangeDetail = {
  readonly start: number;
  readonly end: number;
  readonly direction: 'forward' | 'backward';
};

export type LynxTextEventMap = WithPrefixes<{
  bindlayout: LynxEvent<TextLayoutDetail>;
  bindselectionchange: LynxEvent<TextSelectionChangeDetail>;
}>;

// ---- <input> and <textarea> ------------------------------------------------

/** `<input>` and `<textarea>`'s `bindinput` detail. */
export type InputDetail = {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  /**
   * `true` while a keyboard that builds characters from several keystrokes,
   * such as a Chinese or Japanese one, is mid-character.
   */
  readonly isComposing?: boolean;
};

/**
 * `<input>` and `<textarea>`'s `bindfocus`, `bindblur` and `bindconfirm`
 * detail: the field's text.
 */
export type InputValueDetail = {
  readonly value: string;
};

/** `<input>` and `<textarea>`'s `bindselection` detail. */
export type InputSelectionDetail = {
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

/**
 * `<input>` and `<textarea>`'s `bindbeforeinput` detail (iOS): an edit about
 * to be applied, which replaces `length` characters from `cursor` with
 * `replace`.
 */
export type BeforeInputDetail = {
  /** The text before the edit. */
  readonly value: string;
  readonly cursor: number;
  readonly length: number;
  readonly replace: string;
  readonly isComposing?: boolean;
};

/**
 * `<input>` and `<textarea>`'s `bindkeyboardheightchange` detail, sent while
 * the field has focus: as the keyboard shows, when it changes size, and with
 * `0` as it hides.
 */
export type KeyboardHeightDetail = {
  /**
   * iOS sends points, measured up from the bottom of the window. Android
   * sends physical pixels, measured up from the bottom of the Lynx view.
   */
  readonly height: number;
};

/** `<input>` and `<textarea>`'s `bindkeyboard` detail (iOS). */
export type KeyboardDetail = {
  /** Whether the keyboard is showing or hiding. */
  readonly show: boolean;
  /** As it shows, its height, in points. */
  readonly keyboardHeight?: number;
  /** As it shows, the window's bottom safe-area inset, in points. */
  readonly safeAreaBottom?: number;
};

export type LynxInputEventMap = WithPrefixes<{
  bindinput: LynxEvent<InputDetail>;
  bindfocus: LynxEvent<InputValueDetail>;
  bindblur: LynxEvent<InputValueDetail>;
  bindconfirm: LynxEvent<InputValueDetail>;
  bindselection: LynxEvent<InputSelectionDetail>;
  bindbeforeinput: LynxEvent<BeforeInputDetail>;
  bindkeyboardheightchange: LynxEvent<KeyboardHeightDetail>;
  bindkeyboard: LynxEvent<KeyboardDetail>;
}>;

/** `<textarea>`'s `bindline` detail. */
export type TextareaLineDetail = {
  /**
   * The number of lines. On iOS and Android, `-1` means an edit would have
   * gone over `maxlines`.
   */
  readonly line: number;
};

export type LynxTextareaEventMap = LynxInputEventMap &
  WithPrefixes<{
    bindline: LynxEvent<TextareaLineDetail>;
  }>;

// ---- <scroll-view> and <list> ----------------------------------------------

/** `<scroll-view>`'s scroll events' detail, in px. */
export type ScrollDetail = {
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  /** The change since the last event. */
  readonly deltaX: number;
  readonly deltaY: number;
};

export type LynxScrollViewEventMap = WithPrefixes<{
  bindscroll: LynxEvent<ScrollDetail>;
  bindscrollend: LynxEvent<ScrollDetail>;
  bindscrolltoupper: LynxEvent<ScrollDetail>;
  bindscrolltolower: LynxEvent<ScrollDetail>;
  // iOS and Android.
  bindscrolltoupperedge: LynxEvent<ScrollDetail>;
  bindscrolltoloweredge: LynxEvent<ScrollDetail>;
  bindscrolltonormalstate: LynxEvent<ScrollDetail>;
  bindcontentsizechanged: LynxEvent<ScrollDetail>;
}>;

/** A rendered `<list-item>`'s position, relative to the list, in px. */
export type ListAttachedCell = {
  readonly id: number;
  readonly itemKey: string;
  readonly index: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

/** `<list>`'s `bindscroll`, `bindscrolltoupper` and `bindscrolltolower` detail. */
export type ListScrollDetail = ScrollDetail & {
  readonly listWidth: number;
  readonly listHeight: number;
  /** What scrolled the list: `0` a data update, `1` layout, `2` scrolling. */
  readonly eventSource: 0 | 1 | 2;
  /** The rendered items. Only with `need-visible-item-info`. */
  readonly attachedCells?: readonly ListAttachedCell[];
};

/** `<list>`'s `bindscrollstatechange` detail (iOS and Android). */
export type ListScrollStateChangeDetail = {
  /** `1` stopped, `2` dragging, `3` slowing down, `4` animating. */
  readonly state: 1 | 2 | 3 | 4;
};

/** An item in `<list>`'s `bindlayoutcomplete` detail. */
export type ListItemInfo = {
  readonly width: number;
  readonly height: number;
  readonly itemKey: string;
  /** Whether the item is rendered. */
  readonly isBinding: boolean;
  /** The item's position in the whole scroll area, in px. */
  readonly originX: number;
  readonly originY: number;
  readonly updated: boolean;
};

/**
 * `<list>`'s `bindlayoutcomplete` detail. Every field but `layout-id` needs
 * `need-layout-complete-info`.
 */
export type ListLayoutCompleteDetail = {
  /** The list's `layout-id` attribute, or `-1`. */
  readonly 'layout-id': number;
  readonly scrollInfo?: ListScrollDetail;
  /** The indexes the data update inserted, moved, removed and updated. */
  readonly diffResult?: {
    readonly insertions: readonly number[];
    readonly move_from: readonly number[];
    readonly move_to: readonly number[];
    readonly removals: readonly number[];
    readonly update_from: readonly number[];
    readonly update_to: readonly number[];
  };
  readonly visibleItemBeforeUpdate?: readonly ListItemInfo[];
  readonly visibleItemAfterUpdate?: readonly ListItemInfo[];
};

/** `<list>`'s `bindsnap` detail, with `item-snap`: where it's about to snap. */
export type ListSnapDetail = {
  /** The index of the item it snaps to. */
  readonly position: number;
  readonly currentScrollTop: number;
  readonly currentScrollLeft: number;
  readonly targetScrollTop: number;
  readonly targetScrollLeft: number;
};

export type LynxListEventMap = WithPrefixes<{
  bindscroll: LynxEvent<ListScrollDetail>;
  bindscrolltoupper: LynxEvent<ListScrollDetail>;
  bindscrolltolower: LynxEvent<ListScrollDetail>;
  bindscrollstatechange: LynxEvent<ListScrollStateChangeDetail>;
  bindlayoutcomplete: LynxEvent<ListLayoutCompleteDetail>;
  bindsnap: LynxEvent<ListSnapDetail>;
}>;

// ---- <frame> ---------------------------------------------------------------

/** `<frame>`'s `bindload` detail: how loading the embedded bundle went. */
export type FrameLoadDetail = {
  readonly url: string;
  readonly statusCode: number;
  readonly statusMessage: string;
};

/**
 * `<frame>`'s `bindloadmetrics` detail: load timings the embedded page
 * reports (iOS and Android, Lynx 3.9 and later).
 */
export type FrameLoadMetricsDetail = {
  readonly url: string;
  readonly mode: string;
  readonly entry: Readonly<Record<string, unknown>>;
};

export type LynxFrameEventMap = WithPrefixes<{
  bindload: LynxEvent<FrameLoadDetail>;
  bindloadmetrics: LynxEvent<FrameLoadMetricsDetail>;
}>;

// ---- <overlay> -------------------------------------------------------------

/** `<overlay>`'s `bindoverlaytouch` detail (iOS and Android). */
export type OverlayTouchDetail = {
  /** Relative to the window. */
  readonly x: number;
  readonly y: number;
  /** `0` down, `1` move, `2` up, `3` cancel. */
  readonly state: 0 | 1 | 2 | 3;
};

/** `<overlay>`'s `binderror` detail (Android). */
export type OverlayErrorDetail = {
  readonly errorCode: string;
  readonly errorMsg: string;
};

export type LynxOverlayEventMap = WithPrefixes<{
  // iOS and Android. They have no detail.
  bindshowoverlay: LynxEvent;
  binddismissoverlay: LynxEvent;
  // Android's back button. It has no detail.
  bindrequestclose: LynxEvent;
  bindoverlaytouch: LynxEvent<OverlayTouchDetail>;
  binderror: LynxEvent<OverlayErrorDetail>;
}>;

// ---- <refresh> -------------------------------------------------------------

/** `<refresh>`'s `bindstartrefresh` detail. */
export type RefreshStartDetail = {
  /** `true` when the user pulled. */
  readonly isManual: boolean;
};

/** `<refresh>`'s `bindheaderoffset` detail. */
export type RefreshHeaderOffsetDetail = {
  readonly isDragging: boolean;
  /** The pull distance divided by the header's height. */
  readonly offsetPercent: number;
};

/** `<refresh>`'s `bindrefreshstatechange` detail. */
export type RefreshStateChangeDetail = {
  /** `0` idle, `1` pulled far enough to release, `2` refreshing. */
  readonly state: 0 | 1 | 2;
};

export type LynxRefreshEventMap = WithPrefixes<{
  bindstartrefresh: LynxEvent<RefreshStartDetail>;
  bindheaderoffset: LynxEvent<RefreshHeaderOffsetDetail>;
  bindrefreshstatechange: LynxEvent<RefreshStateChangeDetail>;
}>;

// ---- <scroll-coordinator> --------------------------------------------------

/** `<scroll-coordinator>`'s `bindoffset` detail, in px. */
export type ScrollCoordinatorOffsetDetail = {
  /** How far the header has folded. */
  readonly offset: number;
  /** How far it can fold: the header's height minus the toolbar's. */
  readonly height: number;
};

export type LynxScrollCoordinatorEventMap = WithPrefixes<{
  bindoffset: LynxEvent<ScrollCoordinatorOffsetDetail>;
}>;

// ---- <video> ---------------------------------------------------------------

/** `<video>`'s `bindfirstframe` detail. */
export type VideoFirstFrameDetail = {
  /** In seconds. */
  readonly duration: number;
};

/** `<video>`'s `bindtimeupdate` detail, in seconds. */
export type VideoTimeUpdateDetail = {
  readonly current: number;
  readonly duration: number;
};

/** `<video>`'s `bindbuffering` detail. */
export type VideoBufferingDetail = {
  /** How far the video has loaded, in seconds. */
  readonly buffering: number;
};

/** `<video>`'s `binderror` detail. */
export type VideoErrorDetail = {
  readonly errorCode: number;
  readonly errorMsg: string;
};

export type LynxVideoEventMap = WithPrefixes<{
  bindfirstframe: LynxEvent<VideoFirstFrameDetail>;
  bindtimeupdate: LynxEvent<VideoTimeUpdateDetail>;
  bindbuffering: LynxEvent<VideoBufferingDetail>;
  binderror: LynxEvent<VideoErrorDetail>;
  // These have no detail.
  bindplaying: LynxEvent;
  bindpaused: LynxEvent;
  bindstopped: LynxEvent;
  bindended: LynxEvent;
  bindlooped: LynxEvent;
}>;

// ---- <viewpager> -----------------------------------------------------------

/** `<viewpager>`'s `bindchange` and `bindwillchange` detail. */
export type ViewPagerChangeDetail = {
  readonly index: number;
  /** `true` when the user swiped there. */
  readonly isDragged: boolean;
};

/** `<viewpager>`'s `bindoffsetchange` detail. */
export type ViewPagerOffsetChangeDetail = {
  /** The position in pages: `0.5` is halfway between pages 0 and 1. */
  readonly offset: number;
};

export type LynxViewPagerEventMap = WithPrefixes<{
  bindchange: LynxEvent<ViewPagerChangeDetail>;
  bindwillchange: LynxEvent<ViewPagerChangeDetail>;
  bindoffsetchange: LynxEvent<ViewPagerOffsetChangeDetail>;
}>;

// ---- <webview> -------------------------------------------------------------

/** `<webview>`'s `binderror` detail. */
export type WebViewErrorDetail = {
  readonly errorCode: number;
  readonly errorMsg: string;
};

/** `<webview>`'s `bindmessage` detail: what the page sent. */
export type WebViewMessageDetail = {
  readonly msg: string;
};

/** `<webview>`'s `bindopenwindow` and `bindlocationchange` detail (Clay). */
export type WebViewUrlDetail = {
  readonly url: string;
};

export type LynxWebViewEventMap = WithPrefixes<{
  // It has no detail.
  bindload: LynxEvent;
  binderror: LynxEvent<WebViewErrorDetail>;
  bindmessage: LynxEvent<WebViewMessageDetail>;
  bindopenwindow: LynxEvent<WebViewUrlDetail>;
  bindlocationchange: LynxEvent<WebViewUrlDetail>;
}>;

// ---- The element types Angular checks templates against --------------------

/**
 * A Lynx-only tag, such as `image`, as Angular's template checker sees it:
 * an `HTMLElement` whose listeners also know the tag's own events. It's an
 * interface so that these overloads come before `HTMLElement`'s, whose
 * `string` overload would otherwise match first and type `$event` as `Event`.
 */
// oxlint-disable-next-line typescript/consistent-type-definitions -- an interface's own methods replace the base's overloads; an intersection would keep HTMLElement's first
export interface LynxTagElement<Events> extends HTMLElement {
  addEventListener<Name extends keyof (Events & HTMLElementEventMap)>(
    type: Name,
    listener: (
      this: LynxTagElement<Events>,
      event: (Events & HTMLElementEventMap)[Name],
    ) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<Name extends keyof (Events & HTMLElementEventMap)>(
    type: Name,
    listener: (
      this: LynxTagElement<Events>,
      event: (Events & HTMLElementEventMap)[Name],
    ) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare global {
  // The Lynx tags HTML doesn't have. `document.createElement('image')` then
  // returns a LynxTagElement, which Angular's template checker reads
  // `$event`'s type from.
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for global augmentation
  interface HTMLElementTagNameMap {
    image: LynxTagElement<LynxImageEventMap>;
    text: LynxTagElement<LynxTextEventMap>;
    'scroll-view': LynxTagElement<LynxScrollViewEventMap>;
    list: LynxTagElement<LynxListEventMap>;
    overlay: LynxTagElement<LynxOverlayEventMap>;
    refresh: LynxTagElement<LynxRefreshEventMap>;
    'scroll-coordinator': LynxTagElement<LynxScrollCoordinatorEventMap>;
    viewpager: LynxTagElement<LynxViewPagerEventMap>;
    webview: LynxTagElement<LynxWebViewEventMap>;
    // Angular names an <svg> by its namespace, so its type-check code calls
    // `document.createElement(':svg:svg')`, not `createElement('svg')`.
    ':svg:svg': LynxTagElement<LynxSvgEventMap>;
  }

  // The Lynx tags HTML also has keep their DOM types, so their own events
  // are added to the DOM element's listeners instead. Merged into lib.dom's
  // interface, these overloads come before its own, so its `string` overload
  // doesn't match first.
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for global augmentation
  interface HTMLInputElement {
    addEventListener<Name extends keyof LynxInputEventMap>(
      type: Name,
      listener: (
        this: HTMLInputElement,
        event: LynxInputEventMap[Name],
      ) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<Name extends keyof LynxInputEventMap>(
      type: Name,
      listener: (
        this: HTMLInputElement,
        event: LynxInputEventMap[Name],
      ) => unknown,
      options?: boolean | EventListenerOptions,
    ): void;
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for global augmentation
  interface HTMLTextAreaElement {
    addEventListener<Name extends keyof LynxTextareaEventMap>(
      type: Name,
      listener: (
        this: HTMLTextAreaElement,
        event: LynxTextareaEventMap[Name],
      ) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<Name extends keyof LynxTextareaEventMap>(
      type: Name,
      listener: (
        this: HTMLTextAreaElement,
        event: LynxTextareaEventMap[Name],
      ) => unknown,
      options?: boolean | EventListenerOptions,
    ): void;
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for global augmentation
  interface HTMLVideoElement {
    addEventListener<Name extends keyof LynxVideoEventMap>(
      type: Name,
      listener: (
        this: HTMLVideoElement,
        event: LynxVideoEventMap[Name],
      ) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<Name extends keyof LynxVideoEventMap>(
      type: Name,
      listener: (
        this: HTMLVideoElement,
        event: LynxVideoEventMap[Name],
      ) => unknown,
      options?: boolean | EventListenerOptions,
    ): void;
  }
  // `frame` is in HTML's deprecated tag map.
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for global augmentation
  interface HTMLFrameElement {
    addEventListener<Name extends keyof LynxFrameEventMap>(
      type: Name,
      listener: (
        this: HTMLFrameElement,
        event: LynxFrameEventMap[Name],
      ) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<Name extends keyof LynxFrameEventMap>(
      type: Name,
      listener: (
        this: HTMLFrameElement,
        event: LynxFrameEventMap[Name],
      ) => unknown,
      options?: boolean | EventListenerOptions,
    ): void;
  }
}
