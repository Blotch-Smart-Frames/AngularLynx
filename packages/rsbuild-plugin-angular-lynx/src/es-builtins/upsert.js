import { definePolyfills, isObject, requireCallable } from './shared.js';

/**
 * ES2026 upsert: get a key's value, adding it first if it's missing.
 */
const defineUpsert = (Kind, requireKey) => {
  const { has, get, set } = Kind.prototype;
  definePolyfills(Kind.prototype, {
    getOrInsert(key, value) {
      if (has.call(this, key)) return get.call(this, key);
      set.call(this, key, value);
      return value;
    },
    getOrInsertComputed(key, callback) {
      requireCallable(callback);
      requireKey(key);
      if (has.call(this, key)) return get.call(this, key);
      // The callback gets the key as the map stores it (+0 for -0), and its
      // value replaces any it added for the key itself.
      const stored = key === 0 ? 0 : key;
      const value = callback(stored);
      set.call(this, stored, value);
      return value;
    },
  });
};
defineUpsert(Map, () => {});
// A WeakMap key must be an object or a symbol that isn't registered with
// Symbol.for (CanBeHeldWeakly), checked before the callback runs.
defineUpsert(WeakMap, (key) => {
  if (
    !isObject(key) &&
    !(typeof key === 'symbol' && Symbol.keyFor(key) === undefined)
  ) {
    throw new TypeError('Invalid value used as weak map key');
  }
});
