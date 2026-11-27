import { definePolyfills, requireCallable } from './shared.js';

/**
 * ES2024 array grouping: calls `callback(item, index)` for each item and adds
 * the item to the group under the key it returns.
 */
const groupItems = (items, callback, add) => {
  if (items == null) throw new TypeError('Cannot group undefined or null');
  requireCallable(callback);
  let index = 0;
  for (const item of items) add(callback(item, index++), item);
};

definePolyfills(Object, {
  groupBy(items, callback) {
    const groups = Object.create(null);
    groupItems(items, callback, (key, item) => {
      // ToPropertyKey, once per key.
      const property = typeof key === 'symbol' ? key : String(key);
      const group = groups[property];
      if (group) group.push(item);
      else groups[property] = [item];
    });
    return groups;
  },
});

definePolyfills(Map, {
  groupBy(items, callback) {
    const groups = new Map();
    groupItems(items, callback, (key, item) => {
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    });
    return groups;
  },
});
