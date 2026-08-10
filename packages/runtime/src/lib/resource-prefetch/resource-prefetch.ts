import { Injectable } from '@angular/core';
import type {
  ResourcePrefetchData,
  ResourcePrefetchResult,
} from '@lynx-js/types';

export type { ResourcePrefetchData, ResourcePrefetchResult };

/**
 * Resource priority hint for the native prefetch engine.
 */
export type PrefetchPriority = 'high' | 'medium' | 'low';

/**
 * Cache destination for a prefetched resource.
 * - `'disk'` — persists across app sessions (larger resources)
 * - `'bitmap'` — decoded into memory for immediate display (images)
 */
export type PrefetchCacheTarget = 'disk' | 'bitmap';

/**
 * Describes a single resource to prefetch.
 */
export type PrefetchRequest = {
  /**
   * URL of the resource to prefetch.
   */
  uri: string;
  /**
   * Resource type — determines the native prefetch pipeline.
   */
  type: 'image' | 'video';
  /**
   * Optional priority hint (default determined by native engine).
   */
  priority?: PrefetchPriority;
  /**
   * Where to cache the prefetched resource.
   */
  cacheTarget?: PrefetchCacheTarget;
  /**
   * Custom cache key for manual cache management.
   */
  preloadKey?: string;
  /**
   * Expected resource size in bytes (helps native allocate buffers).
   */
  size?: number;
};

/**
 * Per-resource result from a prefetch or cancel operation.
 */
export type PrefetchResultDetail = {
  code: number;
  msg: string;
  uri: string;
  type: 'image' | 'video';
};

/**
 * Wraps `lynx.requestResourcePrefetch()` and `lynx.cancelResourcePrefetch()`
 * with a Promise-based API for preloading images and videos into the native
 * cache before they're needed for display.
 *
 * Only available on the background thread — these APIs are not exposed on
 * the main thread.
 *
 * @usageNotes
 * ```typescript
 * const prefetch = inject(LynxResourcePrefetch);
 *
 * // Prefetch a single image
 * const result = await prefetch.request([
 *   { uri: 'https://cdn.example.com/hero.jpg', type: 'image' },
 * ]);
 *
 * // Prefetch multiple resources with priority
 * await prefetch.request([
 *   { uri: 'https://cdn.example.com/hero.jpg', type: 'image', priority: 'high' },
 *   { uri: 'https://cdn.example.com/promo.mp4', type: 'video', priority: 'low' },
 * ]);
 *
 * // Cancel an in-flight prefetch
 * await prefetch.cancel([
 *   { uri: 'https://cdn.example.com/promo.mp4', type: 'video' },
 * ]);
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxResourcePrefetch {
  /**
   * Request prefetching of one or more resources into the native cache.
   * Resolves when the native engine acknowledges the request (not necessarily
   * when the download completes).
   */
  request(resources: PrefetchRequest[]): Promise<ResourcePrefetchResult> {
    if (typeof lynx === 'undefined' || !lynx.requestResourcePrefetch) {
      return Promise.reject(
        new Error(
          'lynx.requestResourcePrefetch is not available in this environment',
        ),
      );
    }

    const data = this.#toNativeData(resources);

    return new Promise((resolve) => {
      lynx.requestResourcePrefetch(data, resolve);
    });
  }

  /**
   * Cancel in-flight prefetch requests for the specified resources.
   * Useful when navigating away before prefetched content is needed.
   */
  cancel(resources: PrefetchRequest[]): Promise<ResourcePrefetchResult> {
    if (typeof lynx === 'undefined' || !lynx.cancelResourcePrefetch) {
      return Promise.reject(
        new Error(
          'lynx.cancelResourcePrefetch is not available in this environment',
        ),
      );
    }

    const data = this.#toNativeData(resources);

    return new Promise((resolve) => {
      lynx.cancelResourcePrefetch(data, resolve);
    });
  }

  #toNativeData(resources: PrefetchRequest[]): ResourcePrefetchData {
    return {
      data: resources.map((r) => {
        const hasParam =
          r.priority || r.cacheTarget || r.preloadKey || r.size != null;
        if (!hasParam) {
          return { uri: r.uri, type: r.type };
        }
        return {
          uri: r.uri,
          type: r.type,
          param: {
            // Native type requires `size` when `param` is present
            size: r.size ?? 0,
            ...(r.priority && { priority: r.priority }),
            ...(r.cacheTarget && { cacheTarget: r.cacheTarget }),
            ...(r.preloadKey && { preloadKey: r.preloadKey }),
          },
        };
      }),
    };
  }
}
