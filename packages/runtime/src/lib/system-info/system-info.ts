import { Injectable, signal } from '@angular/core';
import type { SystemInfo, PlatformType } from '@lynx-js/types';
import { callOnBackground, isMainThread } from '../background-call';

/**
 * The OS version the host app sent in its global props, if it sent one. The
 * apps `ng build --platform` makes send `osVersion`, because the native main
 * thread's `SystemInfo` has none (see {@link LynxSystemInfo.osVersion}).
 */
const hostOsVersion = (): string | undefined => {
  const value =
    typeof lynx !== 'undefined'
      ? (lynx.__globalProps as Record<string, unknown> | undefined)?.[
          'osVersion'
        ]
      : undefined;
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/**
 * Wraps the global `SystemInfo` object as an Angular injectable,
 * providing device and platform information from the Lynx runtime.
 *
 * `SystemInfo` is populated once when the Lynx view initializes and
 * is read-only for the lifetime of the app — the values never change.
 *
 * On iOS and Android (Lynx 4.1), the main thread has no global `SystemInfo`,
 * only `lynx.SystemInfo`, so that's read first. The background thread and the
 * web have the global. The main thread's copy has no `osVersion` either: see
 * {@link LynxSystemInfo.osVersion} for where that comes from instead.
 *
 * @usageNotes
 * ```typescript
 * const systemInfo = inject(LynxSystemInfo);
 *
 * // Device dimensions in physical pixels
 * const { pixelWidth, pixelHeight, pixelRatio } = systemInfo;
 *
 * // Logical screen dimensions (CSS pixels)
 * const cssWidth = systemInfo.screenWidth;
 * const cssHeight = systemInfo.screenHeight;
 *
 * // Platform detection
 * if (systemInfo.platform === 'iOS') {
 *   // iOS-specific logic
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxSystemInfo {
  readonly #info: SystemInfo;
  /**
   * The OS version, from wherever it's known: SystemInfo, the host's global
   * props, or the background thread's SystemInfo, which answers later. A
   * signal, so a `computed()` reading {@link osVersion} sees the late answer.
   */
  readonly #osVersion = signal<string | undefined>(undefined);

  constructor() {
    const info =
      (typeof lynx !== 'undefined'
        ? (lynx as { SystemInfo?: SystemInfo }).SystemInfo
        : undefined) ??
      (typeof SystemInfo !== 'undefined' ? SystemInfo : undefined);
    if (!info) {
      throw new Error('SystemInfo is not available in this environment');
    }
    this.#info = info;
    this.#osVersion.set(info.osVersion || hostOsVersion());
    // Lynx builds the native main thread's SystemInfo, where Angular runs,
    // without the OS version (GenerateSystemInfo in Lynx core), so ask the
    // background thread's, which has it. It answers after the first frame, so
    // a host app that knows the version should send it as the `osVersion`
    // global prop, as the generated apps do.
    if (this.#osVersion() === undefined && isMainThread()) {
      callOnBackground('osVersion').then(
        (version) => {
          if (version) this.#osVersion.set(version);
        },
        () => {
          // No background thread to ask: the version stays unknown.
        },
      );
    }
  }

  /**
   * The platform of the current device (e.g. `'iOS'`, `'Android'`).
   */
  get platform(): PlatformType {
    return this.#info.platform;
  }

  /**
   * The Lynx engine version (e.g. `'3.2'`).
   */
  get engineVersion(): string {
    return this.#info.engineVersion;
  }

  /**
   * The current operating system version, such as `'26.1'` on iOS or `'15'`
   * on Android. Empty while it isn't known.
   *
   * The native main thread's SystemInfo lacks it, so there it comes from the
   * host app's `osVersion` global prop, or else from the background thread,
   * which answers shortly after the first frame. It reads a signal, so a
   * `computed()` that reads it updates when the answer arrives.
   */
  get osVersion(): string {
    return this.#osVersion() ?? '';
  }

  /**
   * Physical pixel width of the device screen.
   */
  get pixelWidth(): number {
    return this.#info.pixelWidth;
  }

  /**
   * Physical pixel height of the device screen.
   */
  get pixelHeight(): number {
    return this.#info.pixelHeight;
  }

  /**
   * Device pixel ratio (physical pixels per CSS pixel).
   */
  get pixelRatio(): number {
    return this.#info.pixelRatio;
  }

  /**
   * The JavaScript engine in use (`'v8'`, `'jsc'`, or `'quickjs'`). Only available on the background thread.
   */
  get runtimeType(): 'v8' | 'jsc' | 'quickjs' {
    return this.#info.runtimeType;
  }

  /**
   * Screen width in logical/CSS pixels (`pixelWidth / pixelRatio`).
   */
  get screenWidth(): number {
    return this.#info.pixelWidth / this.#info.pixelRatio;
  }

  /**
   * Screen height in logical/CSS pixels (`pixelHeight / pixelRatio`).
   */
  get screenHeight(): number {
    return this.#info.pixelHeight / this.#info.pixelRatio;
  }

  /**
   * The theme object, if provided by the host application.
   */
  get theme(): object | undefined {
    return this.#info.theme;
  }
}
