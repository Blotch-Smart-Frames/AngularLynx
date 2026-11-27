import {
  definePolyfills,
  isObject,
  requireCallable,
  toIntegerOrInfinity,
  iteratorRecord,
  DONE,
  stepValue,
  closeIterator,
} from './shared.js';

// ES2025 Set methods. The other argument only has to be set-like: a `size`,
// and `has` and `keys` methods (GetSetRecord), so a Map works too. Each method
// reads whichever of the two sets is smaller, as the spec does, and the
// receiver through the original Set methods, so a subclass's overrides don't
// change the result.
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setValues = Set.prototype.values;
const getSetRecord = (other) => {
  if (!isObject(other)) throw new TypeError('Expected a set-like object');
  const size = +other.size;
  if (size !== size) throw new TypeError("The set-like's size is not a number");
  const integerSize = toIntegerOrInfinity(size);
  if (integerSize < 0) throw new RangeError("The set-like's size is negative");
  const has = requireCallable(other.has);
  const keys = requireCallable(other.keys);
  return { set: other, size: integerSize, has, keys };
};
const copySet = (set) => {
  const copy = new Set();
  for (const value of setValues.call(set)) setAdd.call(copy, value);
  return copy;
};
/**
 * Opens the set-like's keys() iterator (GetIteratorFromMethod).
 */
const keysOf = (record) => {
  const iterator = record.keys.call(record.set);
  if (!isObject(iterator)) throw new TypeError('keys() must return an object');
  return iteratorRecord(iterator);
};
/**
 * Steps through the keys until `visit` returns true, then closes the iterator.
 * Returns whether it stopped early.
 */
const someKey = (keys, visit) => {
  for (let key = stepValue(keys); key !== DONE; key = stepValue(keys)) {
    // CanonicalizeKeyedCollectionKey: -0 is stored as +0.
    if (visit(key === 0 ? 0 : key)) {
      closeIterator(keys.iterator);
      return true;
    }
  }
  return false;
};

definePolyfills(Set.prototype, {
  union(other) {
    setSize.call(this);
    const keys = keysOf(getSetRecord(other));
    const result = copySet(this);
    someKey(keys, (key) => {
      setAdd.call(result, key);
    });
    return result;
  },
  intersection(other) {
    const size = setSize.call(this);
    const record = getSetRecord(other);
    const result = new Set();
    if (size <= record.size) {
      for (const value of setValues.call(this)) {
        if (record.has.call(record.set, value)) setAdd.call(result, value);
      }
    } else {
      someKey(keysOf(record), (key) => {
        if (setHas.call(this, key)) setAdd.call(result, key);
      });
    }
    return result;
  },
  difference(other) {
    const size = setSize.call(this);
    const record = getSetRecord(other);
    const result = copySet(this);
    if (size <= record.size) {
      for (const value of setValues.call(result)) {
        if (record.has.call(record.set, value)) setDelete.call(result, value);
      }
    } else {
      someKey(keysOf(record), (key) => {
        setDelete.call(result, key);
      });
    }
    return result;
  },
  symmetricDifference(other) {
    setSize.call(this);
    const keys = keysOf(getSetRecord(other));
    const result = copySet(this);
    someKey(keys, (key) => {
      if (setHas.call(this, key)) setDelete.call(result, key);
      else setAdd.call(result, key);
    });
    return result;
  },
  isSubsetOf(other) {
    const size = setSize.call(this);
    const record = getSetRecord(other);
    if (size > record.size) return false;
    for (const value of setValues.call(this)) {
      if (!record.has.call(record.set, value)) return false;
    }
    return true;
  },
  isSupersetOf(other) {
    const size = setSize.call(this);
    const record = getSetRecord(other);
    if (size < record.size) return false;
    return !someKey(keysOf(record), (key) => !setHas.call(this, key));
  },
  isDisjointFrom(other) {
    const size = setSize.call(this);
    const record = getSetRecord(other);
    if (size <= record.size) {
      for (const value of setValues.call(this)) {
        if (record.has.call(record.set, value)) return false;
      }
      return true;
    }
    return !someKey(keysOf(record), (key) => setHas.call(this, key));
  },
});
