import {
  actualIndex,
  arrayFrom,
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
    return arrayFrom(length, (index) => object[length - 1 - index]);
  },
  toSorted(comparator) {
    requireComparator(comparator);
    const object = toObject(this);
    // Every element of the copy is its own, so sort() writes them back
    // without reaching a setter on Array.prototype.
    return arrayFrom(lengthOf(object), (index) => object[index]).sort(
      comparator,
    );
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
    const insertCount = Math.max(arguments.length - 2, 0);
    // Subtracting first keeps the sum exact up to 2^53: adding first could
    // round a length past 2^53 - 1 down to it, and pass this check.
    const newLength = length - actualSkipCount + insertCount;
    if (newLength > Number.MAX_SAFE_INTEGER) {
      throw new TypeError('Invalid array length');
    }
    const items = arguments;
    const insertEnd = actualStart + insertCount;
    return arrayFrom(newLength, (index) =>
      index < actualStart
        ? object[index]
        : index < insertEnd
          ? items[index - actualStart + 2]
          : object[index - insertCount + actualSkipCount],
    );
  },
  with(index, value) {
    const object = toObject(this);
    const length = lengthOf(object);
    const actual = actualIndex(index, length);
    return arrayFrom(length, (k) => (k === actual ? value : object[k]));
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
