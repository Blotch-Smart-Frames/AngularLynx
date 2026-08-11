import { Injectable } from '@angular/core';
import type { SystemInfo, PlatformType } from '@lynx-js/types';

/**
 * Wraps the global `SystemInfo` object as an Angular injectable,
 * providing device and platform information from the Lynx runtime.
 *
 * `SystemInfo` is populated once when the Lynx view initializes and
 * is read-only for the lifetime of the app — the values never change.
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

  constructor() {
    if (typeof SystemInfo === 'undefined') {
      throw new Error('SystemInfo is not available in this environment');
    }
    this.#info = SystemInfo;
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
   * The current operating system version.
   */
  get osVersion(): string {
    return this.#info.osVersion;
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
