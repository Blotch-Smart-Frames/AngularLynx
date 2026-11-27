import { definePolyfills, toThisString } from './shared.js';

// ES2021 replaceAll.
definePolyfills(String.prototype, {
  replaceAll(search, replacement) {
    const subject = toThisString(this);
    if (search instanceof RegExp) {
      // The spec rejects a non-global regex instead of silently replacing only
      // the first match.
      if (!search.global) {
        throw new TypeError('replaceAll must be called with a global RegExp');
      }
      return subject.replace(search, replacement);
    }
    // Escape the needle so it's matched literally, then let `replace` handle
    // function replacements and `$&`-style patterns the same way the real
    // method does.
    const pattern = new RegExp(
      String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g',
    );
    return subject.replace(pattern, replacement);
  },
});
