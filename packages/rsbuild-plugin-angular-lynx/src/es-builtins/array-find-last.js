import {
  call,
  definePolyfills,
  lengthOf,
  requireCallable,
  toObject,
} from './shared.js';

// ES2023 findLast and findLastIndex.
definePolyfills(Array.prototype, {
  findLast(predicate) {
    const object = toObject(this);
    const length = lengthOf(object);
    requireCallable(predicate);
    const thisArg = arguments[1];
    for (let index = length - 1; index >= 0; index--) {
      const value = object[index];
      if (call(predicate, thisArg, value, index, object)) return value;
    }
    return undefined;
  },
  findLastIndex(predicate) {
    const object = toObject(this);
    const length = lengthOf(object);
    requireCallable(predicate);
    const thisArg = arguments[1];
    for (let index = length - 1; index >= 0; index--) {
      if (call(predicate, thisArg, object[index], index, object)) return index;
    }
    return -1;
  },
});
