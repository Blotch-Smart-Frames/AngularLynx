import { Injectable } from '@angular/core';
import type { TextInfo, TextMetrics } from '@lynx-js/types';

/**
 * Wraps `lynx.getTextInfo()` for measuring text dimensions and
 * performing line-breaking calculations.
 *
 * Only works with built-in platform fonts. Custom fonts loaded via
 * `@font-face` or `LynxFont` will fall back to the default
 * system font and produce inaccurate measurements.
 *
 * @usageNotes
 * ```typescript
 * const textMeasure = inject(LynxTextMeasure);
 *
 * const { width } = textMeasure.measure('Hello', { fontSize: '16px' });
 *
 * const { content } = textMeasure.measure('Long text...', {
 *   fontSize: '14px',
 *   maxWidth: '200px',
 *   maxLine: 3,
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxTextMeasure {
  measure(text: string, options: TextInfo): TextMetrics {
    if (typeof lynx === 'undefined') {
      throw new Error('lynx.getTextInfo is not available in this environment');
    }

    if (!text) {
      return { width: 0 };
    }

    return lynx.getTextInfo(text, options);
  }
}
