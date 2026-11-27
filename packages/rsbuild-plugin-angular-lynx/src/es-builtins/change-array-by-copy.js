import {
  actualIndex,
  copyArrayLike,
  createArray,
  definePolyfills,
  lengthOf,
  requireComparator,
  toIntegerOrInfinity,
  toObject,
  TypedArrayPrototype,
  typedArrayKind,
  typedArrayLength,
} from './shared.js';

definePolyfills(Array.prototype, {
  // ES2023 change array by copy: toReversed, toSorted, toSpliced and with
  // return a new array instead of changing the one they're called on.
  toReversed() {
    const object = toObject(this);
    const length = lengthOf(object);
    const result = createArray(length);
    for (let index = 0; index < length; index++) {
      result[index] = object[length - 1 - index];
    }
    return result;
  },
  toSorted(comparator) {
    requireComparator(comparator);
    const object = toObject(this);
    return copyArrayLike(object, lengthOf(object)).sort(comparator);
  },
  toSpliced(start, skipCount) {
    const object = toObject(this);
    const length = lengthOf(object);
    const relativeStart = toIntegerOrInfinity(start);
    const actualStart =
      relativeStart < 0
        ? Math.max(length + relativeStart, 0)
        : Math.min(relativeStart, length);
    // Without a start nothing is skipped; without a skip count, everything
    // from the start is.
    const actualSkipCount =
      arguments.length === 0
        ? 0
        : arguments.length === 1
          ? length - actualStart
          : Math.min(
              Math.max(toIntegerOrInfinity(skipCount), 0),
              length - actualStart,
            );
    const newLength =
      length + Math.max(arguments.length - 2, 0) - actualSkipCount;
    if (newLength > Number.MAX_SAFE_INTEGER) {
      throw new TypeError('Invalid array length');
    }
    const result = createArray(newLength);
    let to = 0;
    for (let from = 0; from < actualStart; from++) result[to++] = object[from];
    for (let item = 2; item < arguments.length; item++) {
      result[to++] = arguments[item];
    }
    for (let from = actualStart + actualSkipCount; from < length; from++) {
      result[to++] = object[from];
    }
    return result;
  },
  with(index, value) {
    const object = toObject(this);
    const length = lengthOf(object);
    const actual = actualIndex(index, length);
    const result = createArray(length);
    for (let k = 0; k < length; k++) {
      result[k] = k === actual ? value : object[k];
    }
    return result;
  },
});

if (TypedArrayPrototype) {
  definePolyfills(TypedArrayPrototype, {
    toReversed() {
      const Kind = typedArrayKind(this);
      const length = typedArrayLength.call(this);
      const result = new Kind(length);
      for (let index = 0; index < length; index++) {
        result[index] = this[length - 1 - index];
      }
      return result;
    },
    toSorted(comparator) {
      requireComparator(comparator);
      const Kind = typedArrayKind(this);
      const length = typedArrayLength.call(this);
      const result = new Kind(length);
      for (let index = 0; index < length; index++) result[index] = this[index];
      return result.sort(comparator);
    },
    with(index, value) {
      const Kind = typedArrayKind(this);
      const length = typedArrayLength.call(this);
      const relative = toIntegerOrInfinity(index);
      const actual = relative < 0 ? length + relative : relative;
      // Storing the value converts it as the spec does (ToNumber, or ToBigInt
      // for BigInt64Array), once and before the index is checked.
      const converted = new Kind(1);
      converted[0] = value;
      if (actual < 0 || actual >= length) throw new RangeError('Invalid index');
      const result = new Kind(length);
      for (let k = 0; k < length; k++) {
        result[k] = k === actual ? converted[0] : this[k];
      }
      return result;
    },
  });
}
