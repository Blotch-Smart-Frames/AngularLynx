import {
  definePolyfills,
  relativeIndex,
  toObject,
  toThisString,
  TypedArrayPrototype,
  typedArrayKind,
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
      return relativeIndex(this, index);
    },
  });
}
