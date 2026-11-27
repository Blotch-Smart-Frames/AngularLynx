import {
  definePolyfills,
  relativeIndex,
  toObject,
  toThisString,
  TypedArrayPrototype,
  typedArrayKind,
  typedArrayLength,
} from './shared.js';

// ES2022 `.at()`, on arrays, strings and typed arrays.
definePolyfills(Array.prototype, {
  at(index) {
    return relativeIndex(toObject(this), index);
  },
});

definePolyfills(String.prototype, {
  at(index) {
    return relativeIndex(toThisString(this), index);
  },
});

if (TypedArrayPrototype) {
  definePolyfills(TypedArrayPrototype, {
    at(index) {
      typedArrayKind(this);
      // The typed array's own length, which a `length` getter on a subclass
      // or the array itself can't change.
      return relativeIndex(this, index, typedArrayLength.call(this));
    },
  });
}
