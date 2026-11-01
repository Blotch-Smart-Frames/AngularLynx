/**
 * The ECMAScript built-ins Lynx's JavaScript engines lack, added before any of
 * the app's code runs (polyfills.js, the build's first preEntry, imports this).
 *
 * The main thread, where Angular and the app run, implements ES2019 and some
 * later additions. Probed on Lynx 4.1, iOS and Android alike, it lacks most of
 * what ES2021 to ES2026 added, from `.at()` and `toSorted()` to
 * `Object.groupBy()` and the Set methods. The background thread also lacks
 * `Promise.allSettled()` and `Promise.any()`. Libraries written for current
 * browsers call these freely, often at module load, where a missing one throws
 * "not a function" and blanks the app before it renders, while every spec
 * passes in Node.
 *
 * This adds every built-in up to ES2026 that JavaScript can define next to the
 * engine's own. It leaves out what only the engine can provide, rather than
 * replace a constructor: RegExp's `d` and `v` flags, Error's `cause` option,
 * `JSON.parse` source text access, resizable ArrayBuffers and `transfer()`,
 * `Atomics.waitAsync` and `Float16Array`. It's written out here rather than
 * taken from core-js: `core-js/es` adds about 400 kB, and also replaces
 * `Promise`, `Set` or `RegExp#exec` wherever core-js judges the engine's own
 * lacking.
 *
 * Each method is added only where it's missing, so the web build (a browser,
 * which has them all) keeps its own. They're non-enumerable like the built-ins,
 * so a `for...in` over an array or string doesn't pick them up, and written as
 * object literal methods, so they have the built-ins' names and lengths and
 * can't be called with `new`.
 *
 * A plain script with no imports, so the tests can run it in a fresh realm.
 * Strict, as the module it's bundled into is, so a method called on null or a
 * primitive sees that value rather than the global object or a wrapper.
 */
'use strict';

/**
 * Defines `name` unconditionally; also used to replace a method that exists
 * but is inadequate (see toLocaleString below).
 */
const definePolyfillOverride = (target, name, value) => {
  Object.defineProperty(target, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
};
const definePolyfill = (target, name, value) => {
  if (target && typeof target[name] !== 'function') {
    definePolyfillOverride(target, name, value);
  }
};
/**
 * Adds each of `methods` (an object literal of methods) that `target` lacks.
 */
const definePolyfills = (target, methods) => {
  for (const name of Object.keys(methods)) {
    definePolyfill(target, name, methods[name]);
  }
};

const isObject = (value) =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';
const requireCallable = (value) => {
  if (typeof value !== 'function') throw new TypeError('Expected a function');
  return value;
};
const toObject = (value) => {
  if (value == null) {
    throw new TypeError('Cannot convert undefined or null to object');
  }
  return Object(value);
};
const toThisString = (value) => String(toObject(value));
/**
 * ToIntegerOrInfinity: NaN (and so `undefined`) becomes 0, the fraction is
 * dropped toward zero, and a BigInt or Symbol throws, as unary plus does.
 */
const toIntegerOrInfinity = (value) => Math.trunc(+value) || 0;
/**
 * LengthOfArrayLike
 */
const lengthOf = (object) =>
  Math.min(
    Math.max(toIntegerOrInfinity(object.length), 0),
    Number.MAX_SAFE_INTEGER,
  );
/**
 * IsConstructor, without calling it: Reflect.construct throws when the new
 * target isn't a constructor.
 */
const isConstructor = (value) => {
  if (typeof value !== 'function') return false;
  try {
    Reflect.construct(String, [], value);
    return true;
  } catch {
    return false;
  }
};
const createDataProperty = (object, key, value) => {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

/**
 * GetIteratorDirect: the iterator and its next method, read once. It and the
 * protocol steps below (IteratorStepValue and IteratorClose) serve the Set
 * methods and the iterator helpers.
 */
const iteratorRecord = (iterator) => ({ iterator, next: iterator.next });
// What stepValue returns once the iterator is done.
const DONE = {};
const stepValue = (record) => {
  const result = record.next.call(record.iterator);
  if (!isObject(result))
    throw new TypeError('Iterator result is not an object');
  return result.done ? DONE : result.value;
};
/**
 * Closing after a normal completion: return() must return an object.
 */
const closeIterator = (iterator) => {
  const method = iterator.return;
  if (method == null) return;
  if (!isObject(requireCallable(method).call(iterator))) {
    throw new TypeError('Iterator result is not an object');
  }
};
/**
 * Closing after an error: whatever return() does, the error is the one
 * thrown.
 */
const closeAndThrow = (iterator, error) => {
  try {
    const method = iterator.return;
    if (method != null) method.call(iterator);
  } catch {
    // The original error is the one to report.
  }
  throw error;
};

/**
 * ES2022 `.at()`, on arrays, strings and typed arrays.
 */
const relativeIndex = (object, index) => {
  const length = lengthOf(object);
  let n = toIntegerOrInfinity(index);
  if (n < 0) n += length;
  if (n < 0 || n >= length) return undefined;
  return typeof object === 'string' ? object.charAt(n) : object[n];
};

const requireComparator = (comparator) => {
  if (comparator !== undefined && typeof comparator !== 'function') {
    throw new TypeError('The comparison function must be a function');
  }
};
/**
 * ArrayCreate: an array of `length` holes, which throws a RangeError past
 * 2^32 - 1 as the spec does.
 */
const createArray = (length) => {
  const array = [];
  array.length = length;
  return array;
};
const copyArrayLike = (object, length) => {
  const copy = createArray(length);
  for (let index = 0; index < length; index++) copy[index] = object[index];
  return copy;
};
const actualIndex = (index, length) => {
  const relative = toIntegerOrInfinity(index);
  const actual = relative < 0 ? length + relative : relative;
  if (actual < 0 || actual >= length) throw new RangeError('Invalid index');
  return actual;
};

definePolyfills(Array.prototype, {
  at(index) {
    return relativeIndex(toObject(this), index);
  },
  findLast(predicate) {
    const object = toObject(this);
    const length = lengthOf(object);
    requireCallable(predicate);
    const thisArg = arguments[1];
    for (let index = length - 1; index >= 0; index--) {
      const value = object[index];
      if (predicate.call(thisArg, value, index, object)) return value;
    }
    return undefined;
  },
  findLastIndex(predicate) {
    const object = toObject(this);
    const length = lengthOf(object);
    requireCallable(predicate);
    const thisArg = arguments[1];
    for (let index = length - 1; index >= 0; index--) {
      if (predicate.call(thisArg, object[index], index, object)) return index;
    }
    return -1;
  },
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

// %TypedArray%.prototype, the shared parent of Float64Array.prototype and the
// rest, where the typed arrays' methods live.
const TypedArrayPrototype =
  typeof Int8Array === 'function'
    ? Object.getPrototypeOf(Int8Array.prototype)
    : undefined;
// These read a typed array's own name and length, which a subclass can't
// override, and return undefined for anything that isn't one.
const typedArrayName =
  TypedArrayPrototype &&
  Object.getOwnPropertyDescriptor(TypedArrayPrototype, Symbol.toStringTag).get;
const typedArrayLength =
  TypedArrayPrototype &&
  Object.getOwnPropertyDescriptor(TypedArrayPrototype, 'length').get;
/**
 * TypedArrayCreateSameType: the copy is the receiver's own kind (a Float64Array
 * for a Float64Array), never a subclass.
 */
const typedArrayKind = (value) => {
  const name = typedArrayName.call(value);
  if (name === undefined) throw new TypeError('Expected a typed array');
  return globalThis[name];
};

if (TypedArrayPrototype) {
  definePolyfills(TypedArrayPrototype, {
    at(index) {
      typedArrayKind(this);
      return relativeIndex(this, index);
    },
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

/**
 * ES2024 well-formed Unicode strings: the index of the first surrogate that
 * isn't half of a pair, or -1.
 */
const loneSurrogateIndex = (string, from) => {
  for (let index = from; index < string.length; index++) {
    const code = string.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code <= 0xdbff) {
      const next = string.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }
    }
    return index;
  }
  return -1;
};

definePolyfills(String.prototype, {
  at(index) {
    return relativeIndex(toThisString(this), index);
  },
  isWellFormed() {
    return loneSurrogateIndex(toThisString(this), 0) === -1;
  },
  toWellFormed() {
    const string = toThisString(this);
    let result = '';
    let start = 0;
    for (
      let index = loneSurrogateIndex(string, 0);
      index !== -1;
      index = loneSurrogateIndex(string, start)
    ) {
      result += string.slice(start, index) + '\uFFFD';
      start = index + 1;
    }
    return result + string.slice(start);
  },
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
  // Angular 22's getSimpleChangesStore (ngOnChanges lifecycle machinery) uses
  // Object.hasOwn() to check if a SimpleChanges store is already attached to
  // the directive instance. Without it, any component or directive that
  // implements ngOnChanges (including FormField from @angular/forms/signals)
  // crashes at instantiation with "Object.hasOwn is not a function".
  hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(toObject(object), key);
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

/**
 * NewPromiseCapability: a promise of the constructor's kind, with the functions
 * that settle it.
 */
const promiseCapability = (Constructor) => {
  let resolve;
  let reject;
  const promise = new Constructor((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
};

definePolyfills(Promise, {
  // Angular's `@defer` block (triggerDeferBlock -> triggerResourceLoading)
  // calls Promise.allSettled() to await all dependency-loading promises before
  // showing the loaded content. The background thread lacks it, and the main
  // thread did on earlier Lynx versions, where every @defer block threw
  // "Promise.allSettled is not a function" as soon as its trigger fired.
  allSettled(promises) {
    return this.all(
      Array.from(promises, (promise) =>
        this.resolve(promise).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        ),
      ),
    );
  },
  any(promises) {
    const capability = promiseCapability(this);
    try {
      const resolve = requireCallable(this.resolve);
      const errors = [];
      // One more than the promises still pending, until all are counted.
      let remaining = 1;
      const rejectIfAllRejected = () => {
        if (--remaining === 0) {
          // Both of Lynx's threads have AggregateError.
          capability.reject(
            new AggregateError(errors, 'All promises were rejected'),
          );
        }
      };
      for (const promise of promises) {
        const index = errors.length;
        errors.push(undefined);
        remaining++;
        let rejected = false;
        resolve.call(this, promise).then(capability.resolve, (error) => {
          if (rejected) return;
          rejected = true;
          errors[index] = error;
          rejectIfAllRejected();
        });
      }
      rejectIfAllRejected();
    } catch (error) {
      capability.reject(error);
    }
    return capability.promise;
  },
  withResolvers() {
    return promiseCapability(this);
  },
  try(callback, ...args) {
    const capability = promiseCapability(this);
    let value;
    try {
      value = callback(...args);
    } catch (error) {
      capability.reject(error);
      return capability.promise;
    }
    capability.resolve(value);
    return capability.promise;
  },
});

/**
 * ES2026 Array.fromAsync: an async version of Array.from. It reads an async
 * iterable as it is, and awaits each value of a sync iterable or array-like.
 */
const fromAsync = async (Constructor, items, mapper, thisArg) => {
  if (mapper !== undefined) requireCallable(mapper);
  // Reading the methods throws the TypeError the spec does for undefined or
  // null.
  const isAsync = items[Symbol.asyncIterator] != null;
  if (isAsync || items[Symbol.iterator] != null) {
    const result = isConstructor(Constructor) ? new Constructor() : [];
    let index = 0;
    const add = async (value) => {
      createDataProperty(
        result,
        index,
        mapper === undefined ? value : await mapper.call(thisArg, value, index),
      );
      index++;
    };
    if (isAsync) {
      for await (const value of items) await add(value);
    } else {
      // Not `for await`: on the main thread, PrimJS's doesn't await a sync
      // iterable's values, as the spec's async-from-sync iterator does.
      // `for...of` still closes the iterator when a value rejects or the
      // mapper throws, as the spec does.
      for (const value of items) await add(await value);
    }
    result.length = index;
    return result;
  }
  // Otherwise an array-like, whose values are awaited too.
  const arrayLike = Object(items);
  const length = lengthOf(arrayLike);
  const result = isConstructor(Constructor)
    ? new Constructor(length)
    : createArray(length);
  for (let index = 0; index < length; index++) {
    const value = await arrayLike[index];
    createDataProperty(
      result,
      index,
      mapper === undefined ? value : await mapper.call(thisArg, value, index),
    );
  }
  result.length = length;
  return result;
};

definePolyfills(Array, {
  // A plain function that returns a promise, like the built-in, rather than
  // an async function.
  fromAsync(items) {
    return fromAsync(this, items, arguments[1], arguments[2]);
  },
});

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

// ES2025 iterator helpers and ES2026 Iterator.concat. %IteratorPrototype% is
// the prototype every built-in iterator and generator inherits from, so the
// helpers reach all of them: `map.values().filter(...).toArray()`.
const IteratorPrototype = Object.getPrototypeOf(
  Object.getPrototypeOf([][Symbol.iterator]()),
);
/**
 * What flatMap and Iterator.from read: an iterable's iterator, or an iterator
 * itself.
 */
const iteratorOrIterable = (value, allowStrings) => {
  if (!isObject(value) && !(allowStrings && typeof value === 'string')) {
    throw new TypeError('Expected an iterator or an iterable');
  }
  const method = value[Symbol.iterator];
  const iterator = method == null ? value : requireCallable(method).call(value);
  if (!isObject(iterator)) throw new TypeError('Expected an iterator');
  return iteratorRecord(iterator);
};

// The helpers return Iterator Helper objects, which act like the generators
// the spec defines them with: each next() runs `step` to the next value or
// DONE, and return() before the end closes the iterators they read. A
// generator function can't do this: closing one that hasn't started skips its
// `finally`, so the iterator it reads would stay open.
const IteratorHelperPrototype = Object.create(IteratorPrototype);
const helperStates = new WeakMap();
const createHelper = (step, close) => {
  const helper = Object.create(IteratorHelperPrototype);
  helperStates.set(helper, { step, close, running: false, done: false });
  return helper;
};
const helperState = (helper) => {
  const state = helperStates.get(helper);
  if (!state) throw new TypeError('Expected an Iterator Helper');
  if (state.running) throw new TypeError('Iterator Helper is already running');
  return state;
};
definePolyfills(IteratorHelperPrototype, {
  next() {
    const state = helperState(this);
    if (state.done) return { value: undefined, done: true };
    state.running = true;
    let value;
    try {
      value = state.step();
    } catch (error) {
      state.done = true;
      throw error;
    } finally {
      state.running = false;
    }
    if (value === DONE) {
      state.done = true;
      return { value: undefined, done: true };
    }
    return { value, done: false };
  },
  return() {
    const state = helperState(this);
    if (!state.done) {
      state.done = true;
      state.close();
    }
    return { value: undefined, done: true };
  },
});
Object.defineProperty(IteratorHelperPrototype, Symbol.toStringTag, {
  value: 'Iterator Helper',
  configurable: true,
});

/**
 * Each helper checks its receiver is an object, then its argument; a bad
 * argument closes the receiver, which the caller handed over to be consumed.
 */
const thisIterator = (value) => {
  if (!isObject(value)) throw new TypeError('Expected an iterator object');
  return value;
};
const callableOrClose = (iterator, value) => {
  if (typeof value !== 'function') {
    closeAndThrow(iterator, new TypeError('Expected a function'));
  }
};
const limitOrClose = (iterator, limit) => {
  let number;
  try {
    number = +limit;
  } catch (error) {
    closeAndThrow(iterator, error);
  }
  const integer = toIntegerOrInfinity(number);
  if (number !== number || integer < 0) {
    closeAndThrow(iterator, new RangeError('Expected a non-negative limit'));
  }
  return integer;
};
/**
 * Runs `predicate` until it returns `wanted`, then closes the iterator and
 * returns `{ value }` for the value it was called with.
 */
const findMatch = (receiver, predicate, wanted) => {
  const iterator = thisIterator(receiver);
  callableOrClose(iterator, predicate);
  const record = iteratorRecord(iterator);
  let counter = 0;
  for (
    let value = stepValue(record);
    value !== DONE;
    value = stepValue(record)
  ) {
    let result;
    try {
      result = predicate(value, counter++);
    } catch (error) {
      closeAndThrow(iterator, error);
    }
    if (!!result === wanted) {
      closeIterator(iterator);
      return { value };
    }
  }
  return undefined;
};

definePolyfills(IteratorPrototype, {
  map(mapper) {
    const iterator = thisIterator(this);
    callableOrClose(iterator, mapper);
    const record = iteratorRecord(iterator);
    let counter = 0;
    return createHelper(
      () => {
        const value = stepValue(record);
        if (value === DONE) return DONE;
        try {
          return mapper(value, counter++);
        } catch (error) {
          closeAndThrow(iterator, error);
        }
      },
      () => closeIterator(iterator),
    );
  },
  filter(predicate) {
    const iterator = thisIterator(this);
    callableOrClose(iterator, predicate);
    const record = iteratorRecord(iterator);
    let counter = 0;
    return createHelper(
      () => {
        for (;;) {
          const value = stepValue(record);
          if (value === DONE) return DONE;
          let selected;
          try {
            selected = predicate(value, counter++);
          } catch (error) {
            closeAndThrow(iterator, error);
          }
          if (selected) return value;
        }
      },
      () => closeIterator(iterator),
    );
  },
  take(limit) {
    const iterator = thisIterator(this);
    let remaining = limitOrClose(iterator, limit);
    const record = iteratorRecord(iterator);
    return createHelper(
      () => {
        if (remaining === 0) {
          closeIterator(iterator);
          return DONE;
        }
        if (remaining !== Infinity) remaining--;
        return stepValue(record);
      },
      () => closeIterator(iterator),
    );
  },
  drop(limit) {
    const iterator = thisIterator(this);
    let remaining = limitOrClose(iterator, limit);
    const record = iteratorRecord(iterator);
    return createHelper(
      () => {
        while (remaining > 0) {
          if (remaining !== Infinity) remaining--;
          if (stepValue(record) === DONE) return DONE;
        }
        return stepValue(record);
      },
      () => closeIterator(iterator),
    );
  },
  flatMap(mapper) {
    const iterator = thisIterator(this);
    callableOrClose(iterator, mapper);
    const record = iteratorRecord(iterator);
    let counter = 0;
    // The iterator of the last mapper result, while it has values left.
    let inner;
    return createHelper(
      () => {
        for (;;) {
          if (inner) {
            let value;
            try {
              value = stepValue(inner);
            } catch (error) {
              closeAndThrow(iterator, error);
            }
            if (value !== DONE) return value;
            inner = undefined;
          }
          const value = stepValue(record);
          if (value === DONE) return DONE;
          try {
            inner = iteratorOrIterable(mapper(value, counter++), false);
          } catch (error) {
            closeAndThrow(iterator, error);
          }
        }
      },
      () => {
        if (inner) {
          try {
            closeIterator(inner.iterator);
          } catch (error) {
            closeAndThrow(iterator, error);
          }
        }
        closeIterator(iterator);
      },
    );
  },
  reduce(reducer) {
    const iterator = thisIterator(this);
    callableOrClose(iterator, reducer);
    const record = iteratorRecord(iterator);
    let accumulator;
    let counter = 0;
    if (arguments.length < 2) {
      accumulator = stepValue(record);
      if (accumulator === DONE) {
        throw new TypeError('Reduce of empty iterator with no initial value');
      }
      counter = 1;
    } else {
      accumulator = arguments[1];
    }
    for (
      let value = stepValue(record);
      value !== DONE;
      value = stepValue(record)
    ) {
      try {
        accumulator = reducer(accumulator, value, counter++);
      } catch (error) {
        closeAndThrow(iterator, error);
      }
    }
    return accumulator;
  },
  toArray() {
    const record = iteratorRecord(thisIterator(this));
    const items = [];
    for (
      let value = stepValue(record);
      value !== DONE;
      value = stepValue(record)
    ) {
      items.push(value);
    }
    return items;
  },
  forEach(callback) {
    const iterator = thisIterator(this);
    callableOrClose(iterator, callback);
    const record = iteratorRecord(iterator);
    let counter = 0;
    for (
      let value = stepValue(record);
      value !== DONE;
      value = stepValue(record)
    ) {
      try {
        callback(value, counter++);
      } catch (error) {
        closeAndThrow(iterator, error);
      }
    }
  },
  some(predicate) {
    return findMatch(this, predicate, true) !== undefined;
  },
  every(predicate) {
    return findMatch(this, predicate, false) === undefined;
  },
  find(predicate) {
    const match = findMatch(this, predicate, true);
    return match === undefined ? undefined : match.value;
  },
});

/* oxlint-disable func-style, @blotch/no-function-declaration -- see below */
if (typeof globalThis.Iterator !== 'function') {
  /**
   * The global Iterator: an abstract class (`new Iterator()` throws, a
   * subclass constructs) whose prototype is %IteratorPrototype%, so
   * `x instanceof Iterator` is true for every built-in iterator. A class
   * can't take an existing object as its prototype, and an arrow function has
   * no `new.target`, hence the function expression.
   */
  const Iterator = function Iterator() {
    if (new.target === undefined || new.target === Iterator) {
      throw new TypeError('Abstract class Iterator not directly constructable');
    }
  };
  Object.defineProperty(Iterator, 'prototype', {
    value: IteratorPrototype,
    writable: false,
  });
  definePolyfillOverride(IteratorPrototype, 'constructor', Iterator);
  definePolyfillOverride(IteratorPrototype, Symbol.toStringTag, 'Iterator');
  definePolyfillOverride(globalThis, 'Iterator', Iterator);
}
/* oxlint-enable func-style, @blotch/no-function-declaration */

// What Iterator.from wraps an iterator that doesn't inherit from Iterator in,
// so it gets the helpers.
const WrapForValidIteratorPrototype = Object.create(IteratorPrototype);
const wrappedRecords = new WeakMap();
const wrappedRecord = (wrapper) => {
  const record = wrappedRecords.get(wrapper);
  if (!record) throw new TypeError('Expected an iterator from Iterator.from');
  return record;
};
definePolyfills(WrapForValidIteratorPrototype, {
  next() {
    const record = wrappedRecord(this);
    return record.next.call(record.iterator);
  },
  return() {
    const { iterator } = wrappedRecord(this);
    const method = iterator.return;
    if (method == null) return { value: undefined, done: true };
    return requireCallable(method).call(iterator);
  },
});

definePolyfills(globalThis.Iterator, {
  from(value) {
    const record = iteratorOrIterable(value, true);
    if (IteratorPrototype.isPrototypeOf(record.iterator))
      return record.iterator;
    const wrapper = Object.create(WrapForValidIteratorPrototype);
    wrappedRecords.set(wrapper, record);
    return wrapper;
  },
  concat() {
    const iterables = [];
    for (let index = 0; index < arguments.length; index++) {
      const iterable = arguments[index];
      if (!isObject(iterable)) throw new TypeError('Expected an iterable');
      iterables.push({
        iterable,
        open: requireCallable(iterable[Symbol.iterator]),
      });
    }
    let position = 0;
    // The iterator being read, once opened. Each opens only when the one
    // before it is done.
    let current;
    return createHelper(
      () => {
        for (;;) {
          if (!current) {
            if (position === iterables.length) return DONE;
            const { iterable, open } = iterables[position++];
            const iterator = open.call(iterable);
            if (!isObject(iterator))
              throw new TypeError('Expected an iterator');
            current = iteratorRecord(iterator);
          }
          const value = stepValue(current);
          if (value !== DONE) return value;
          current = undefined;
        }
      },
      () => {
        if (current) closeIterator(current.iterator);
      },
    );
  },
});

// ES2025 RegExp.escape, to match a string literally in a pattern. Following
// EncodeForRegExpEscape, a leading letter or digit is escaped too, so the
// result can follow an escape like `\0` or `\c` without changing it.
const CONTROL_ESCAPES = {
  '\t': 't',
  '\n': 'n',
  '\v': 'v',
  '\f': 'f',
  '\r': 'r',
};
const hexEscape = (code, digits) =>
  (digits === 2 ? '\\x' : '\\u') + code.toString(16).padStart(digits, '0');

definePolyfills(RegExp, {
  escape(string) {
    if (typeof string !== 'string') throw new TypeError('Expected a string');
    let escaped = '';
    // By code point, so a surrogate pair stays as it is and a lone surrogate
    // is escaped.
    for (const char of string) {
      const code = char.codePointAt(0);
      if (escaped === '' && /[0-9A-Za-z]/.test(char)) {
        escaped += hexEscape(code, 2);
      } else if ('^$\\.*+?()[]{}|/'.includes(char)) {
        escaped += '\\' + char;
      } else if (char in CONTROL_ESCAPES) {
        escaped += '\\' + CONTROL_ESCAPES[char];
      } else if (
        ',-=<>#&!%:;@~\'`"'.includes(char) ||
        /[ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(
          char,
        ) ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        escaped += code <= 0xff ? hexEscape(code, 2) : hexEscape(code, 4);
      } else {
        escaped += char;
      }
    }
    return escaped;
  },
});

/**
 * Ties-to-even rounding of a non-negative number to an integer.
 */
const roundHalfEven = (value) => {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction !== 0.5) return fraction < 0.5 ? floor : floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
};

// ES2026 Math.sumPrecise: the exact sum, rounded once. `partials` hold the
// running sum exactly, as non-overlapping doubles, smallest first, the way
// Python's exact float sum does; `overflow` counts the 2^1024s that partial
// sums overflowed by, as the proposal's reference polyfill does.
const MAX_ULP = 2 ** 971;
const twoSum = (x, y) => {
  // Needs |x| >= |y|. `low` is what rounding `x + y` to `high` lost.
  const high = x + y;
  return { high, low: y - (high - x) };
};
const sumPartials = (partials, overflow) => {
  let n = partials.length - 1;
  let high = 0;
  let low = 0;
  if (overflow !== 0) {
    const next = n >= 0 ? partials[n] : 0;
    n--;
    if (
      Math.abs(overflow) > 1 ||
      (overflow > 0 && next > 0) ||
      (overflow < 0 && next < 0)
    ) {
      return overflow > 0 ? Infinity : -Infinity;
    }
    // Halved so the arithmetic doesn't overflow.
    ({ high, low } = twoSum(overflow * 2 ** 1023, next / 2));
    low *= 2;
    if (Math.abs(2 * high) === Infinity) {
      // Half an ulp short of 2^1024 rounds to Infinity (ties go to the even
      // neighbor, and Number.MAX_VALUE is odd), unless the next partial pulls
      // it down.
      if (high > 0) {
        return high === 2 ** 1023 &&
          low === -(MAX_ULP / 2) &&
          n >= 0 &&
          partials[n] < 0
          ? Number.MAX_VALUE
          : Infinity;
      }
      return high === -(2 ** 1023) &&
        low === MAX_ULP / 2 &&
        n >= 0 &&
        partials[n] > 0
        ? -Number.MAX_VALUE
        : -Infinity;
    }
    if (low !== 0) {
      partials[++n] = low;
      low = 0;
    }
    high *= 2;
  }
  // Add the partials from the largest until one doesn't fit exactly.
  while (n >= 0) {
    ({ high, low } = twoSum(high, partials[n--]));
    if (low !== 0) break;
  }
  // A remainder of exactly half an ulp rounds to even, unless the next
  // partial has the same sign and so tips it the other way.
  if (
    n >= 0 &&
    ((low < 0 && partials[n] < 0) || (low > 0 && partials[n] > 0))
  ) {
    const y = low * 2;
    const x = high + y;
    if (y === x - high) high = x;
  }
  return high;
};

definePolyfills(Math, {
  // ES2025 Math.f16round: the nearest half-precision float, ties to even.
  f16round(value) {
    const x = +value;
    if (x !== x || x === 0 || x === Infinity || x === -Infinity) return x;
    const magnitude = Math.abs(x);
    // A float16 has 10 fraction bits; below 2^-14 it's subnormal, with steps
    // of 2^-24. Math.log2 can be one off near a power of two.
    let exponent = Math.floor(Math.log2(magnitude));
    if (2 ** exponent > magnitude) exponent--;
    else if (2 ** (exponent + 1) <= magnitude) exponent++;
    const step = 2 ** (Math.max(exponent, -14) - 10);
    const rounded = roundHalfEven(magnitude / step) * step;
    // 65504 is the largest float16; anything that rounds above it overflows.
    const result = rounded > 65504 ? Infinity : rounded;
    return x < 0 ? -result : result;
  },
  sumPrecise(items) {
    if (items == null) throw new TypeError('Expected an iterable of numbers');
    const partials = [];
    let overflow = 0;
    // NaN or an infinity once one turns up (both infinities make NaN), and
    // whether every number so far was -0, which sums to -0.
    let special = 0;
    let onlyMinusZero = true;
    for (const value of items) {
      if (typeof value !== 'number') {
        throw new TypeError('Math.sumPrecise expects only numbers');
      }
      if (special !== special) continue;
      if (value !== value) {
        special = NaN;
      } else if (value === Infinity || value === -Infinity) {
        special = special === -value ? NaN : value;
      } else if (special === 0 && !Object.is(value, -0)) {
        onlyMinusZero = false;
        let x = value;
        let used = 0;
        for (let index = 0; index < partials.length; index++) {
          let y = partials[index];
          if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
          let { high, low } = twoSum(x, y);
          if (Math.abs(high) === Infinity) {
            const sign = high > 0 ? 1 : -1;
            overflow += sign;
            x = x - sign * 2 ** 1023 - sign * 2 ** 1023;
            if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
            ({ high, low } = twoSum(x, y));
          }
          if (low !== 0) partials[used++] = low;
          x = high;
        }
        partials.length = used;
        if (x !== 0) partials.push(x);
      }
    }
    if (special !== 0) return special;
    return onlyMinusZero ? -0 : sumPartials(partials, overflow);
  },
});

// ES2026 Error.isError. Only the engine can tell whether an Error constructor
// made an object, but Object.prototype.toString reports the same mark unless
// the object sets Symbol.toStringTag, which errors don't.
definePolyfills(Error, {
  isError(value) {
    return (
      isObject(value) &&
      Object.prototype.toString.call(value) === '[object Error]'
    );
  },
});

// ES2026 Uint8Array to and from base64 and hex.
const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64URL = BASE64.slice(0, 62) + '-_';
const ALPHABETS = ['base64', 'base64url'];
const LAST_CHUNK_HANDLINGS = ['loose', 'strict', 'stop-before-partial'];
const requireOptions = (options) => {
  if (options !== undefined && !isObject(options)) {
    throw new TypeError('Options must be an object');
  }
};
/**
 * Reads an option once; the first of `values` is its default.
 */
const readOption = (options, name, values) => {
  const value = options === undefined ? undefined : options[name];
  if (value === undefined) return values[0];
  if (!values.includes(value)) throw new TypeError(`Invalid ${name} option`);
  return value;
};
const skipAsciiWhitespace = (string, index) => {
  while (index < string.length && '\t\n\f\r '.includes(string[index])) index++;
  return index;
};
/**
 * DecodeBase64Chunk: two to four characters of the standard alphabet into one
 * to three bytes. In strict mode, the bits a short chunk doesn't use must be
 * zero.
 */
const decodeBase64Chunk = (chunk, strict, bytes) => {
  let n = 0;
  for (const char of (chunk + 'AA').slice(0, 4)) {
    n = n * 64 + BASE64.indexOf(char);
  }
  const decoded = [n >> 16, (n >> 8) & 255, n & 255];
  const count = chunk.length - 1;
  if (strict && count < 3 && decoded[count] !== 0) {
    return new SyntaxError('Extra bits in a base64 chunk');
  }
  for (let index = 0; index < count; index++) bytes.push(decoded[index]);
  return undefined;
};
/**
 * FromBase64, step for step: decodes up to `maxLength` bytes, and reports how
 * many characters it read. An error comes back with the bytes decoded before
 * it, which setFromBase64 still writes.
 */
const decodeBase64 = (string, alphabet, lastChunkHandling, maxLength) => {
  const bytes = [];
  let read = 0;
  let chunk = '';
  let index = 0;
  const result = (error) => ({ read, bytes, error });
  const syntaxError = () => result(new SyntaxError('Invalid base64 string'));
  if (maxLength === 0) return result();
  for (;;) {
    index = skipAsciiWhitespace(string, index);
    if (index === string.length) {
      if (chunk.length > 0) {
        if (lastChunkHandling === 'stop-before-partial') return result();
        if (lastChunkHandling === 'strict' || chunk.length === 1) {
          return syntaxError();
        }
        decodeBase64Chunk(chunk, false, bytes);
      }
      read = string.length;
      return result();
    }
    let char = string[index++];
    if (char === '=') {
      if (chunk.length < 2) return syntaxError();
      index = skipAsciiWhitespace(string, index);
      if (chunk.length === 2) {
        if (index === string.length) {
          return lastChunkHandling === 'stop-before-partial'
            ? result()
            : syntaxError();
        }
        if (string[index] === '=') {
          index = skipAsciiWhitespace(string, index + 1);
        }
      }
      if (index < string.length) return syntaxError();
      const error = decodeBase64Chunk(
        chunk,
        lastChunkHandling === 'strict',
        bytes,
      );
      if (error) return result(error);
      read = string.length;
      return result();
    }
    if (alphabet === 'base64url') {
      if (char === '+' || char === '/') return syntaxError();
      if (char === '-') char = '+';
      else if (char === '_') char = '/';
    }
    if (!BASE64.includes(char)) return syntaxError();
    // Stop before a chunk whose bytes wouldn't fit.
    const remaining = maxLength - bytes.length;
    if (
      (remaining === 1 && chunk.length === 2) ||
      (remaining === 2 && chunk.length === 3)
    ) {
      return result();
    }
    chunk += char;
    if (chunk.length === 4) {
      decodeBase64Chunk(chunk, false, bytes);
      chunk = '';
      read = index;
      if (bytes.length === maxLength) return result();
    }
  }
};
/**
 * FromHex: pairs of hex digits, up to `maxLength` bytes.
 */
const decodeHex = (string, maxLength) => {
  const bytes = [];
  let read = 0;
  if (string.length % 2 !== 0) {
    return {
      read,
      bytes,
      error: new SyntaxError('A hex string must have an even length'),
    };
  }
  while (read < string.length && bytes.length < maxLength) {
    const pair = string.slice(read, read + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
      return { read, bytes, error: new SyntaxError('Invalid hex string') };
    }
    read += 2;
    bytes.push(parseInt(pair, 16));
  }
  return { read, bytes, error: undefined };
};
const requireString = (value) => {
  if (typeof value !== 'string') throw new TypeError('Expected a string');
};
const requireUint8Array = (value) => {
  if (typedArrayName.call(value) !== 'Uint8Array') {
    throw new TypeError('Expected a Uint8Array');
  }
};
/**
 * The setFrom* methods write what they decoded, even before an error, and
 * report how much of the string they read and how many bytes they wrote.
 */
const writeDecoded = (target, { read, bytes, error }) => {
  for (let index = 0; index < bytes.length; index++)
    target[index] = bytes[index];
  if (error) throw error;
  return { read, written: bytes.length };
};

if (typeof Uint8Array === 'function') {
  definePolyfills(Uint8Array, {
    fromBase64(string) {
      requireString(string);
      const options = arguments[1];
      requireOptions(options);
      const alphabet = readOption(options, 'alphabet', ALPHABETS);
      const lastChunkHandling = readOption(
        options,
        'lastChunkHandling',
        LAST_CHUNK_HANDLINGS,
      );
      const { bytes, error } = decodeBase64(
        string,
        alphabet,
        lastChunkHandling,
        Infinity,
      );
      if (error) throw error;
      return new Uint8Array(bytes);
    },
    fromHex(string) {
      requireString(string);
      const { bytes, error } = decodeHex(string, Infinity);
      if (error) throw error;
      return new Uint8Array(bytes);
    },
  });
  definePolyfills(Uint8Array.prototype, {
    toBase64() {
      requireUint8Array(this);
      const options = arguments[0];
      requireOptions(options);
      const table =
        readOption(options, 'alphabet', ALPHABETS) === 'base64'
          ? BASE64
          : BASE64URL;
      const padding = options !== undefined && options.omitPadding ? '' : '=';
      const length = typedArrayLength.call(this);
      let encoded = '';
      for (let index = 0; index < length; index += 3) {
        const left = length - index;
        const n =
          (this[index] << 16) |
          (left > 1 ? this[index + 1] << 8 : 0) |
          (left > 2 ? this[index + 2] : 0);
        encoded +=
          table[n >> 18] +
          table[(n >> 12) & 63] +
          (left > 1 ? table[(n >> 6) & 63] : padding) +
          (left > 2 ? table[n & 63] : padding);
      }
      return encoded;
    },
    toHex() {
      requireUint8Array(this);
      const length = typedArrayLength.call(this);
      let hex = '';
      for (let index = 0; index < length; index++) {
        hex += this[index].toString(16).padStart(2, '0');
      }
      return hex;
    },
    setFromBase64(string) {
      requireUint8Array(this);
      requireString(string);
      const options = arguments[1];
      requireOptions(options);
      const alphabet = readOption(options, 'alphabet', ALPHABETS);
      const lastChunkHandling = readOption(
        options,
        'lastChunkHandling',
        LAST_CHUNK_HANDLINGS,
      );
      return writeDecoded(
        this,
        decodeBase64(
          string,
          alphabet,
          lastChunkHandling,
          typedArrayLength.call(this),
        ),
      );
    },
    setFromHex(string) {
      requireUint8Array(this);
      requireString(string);
      return writeDecoded(this, decodeHex(string, typedArrayLength.call(this)));
    },
  });
}

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

// PrimJS has no `Intl`, so its `Number.prototype.toLocaleString` is just
// `String(n)`: `21.232271760105846`, `1234567` with no separators. Libraries
// use it as the default display format (TanStack Charts' tooltips do), so on
// Lynx those values come out raw. Without Intl, format the way browsers do for
// the default en-US locale: thousands separators, at most three fraction
// digits, plus the common `minimumFractionDigits` / `maximumFractionDigits` /
// `useGrouping` options. Other locales get the same format; apps that need
// real localization should load an Intl polyfill, which this then defers to.
if (typeof Intl === 'undefined') {
  definePolyfillOverride(
    Number.prototype,
    'toLocaleString',
    function (_locales, options) {
      const value = Number(this);
      if (Number.isNaN(value)) return 'NaN';
      if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
      const opts = options || {};
      const min = opts.minimumFractionDigits ?? 0;
      const max = Math.max(min, opts.maximumFractionDigits ?? Math.max(min, 3));
      const fixed = Math.abs(value).toFixed(max);
      const dot = fixed.indexOf('.');
      let integer = dot < 0 ? fixed : fixed.slice(0, dot);
      let fraction = dot < 0 ? '' : fixed.slice(dot + 1).replace(/0+$/, '');
      while (fraction.length < min) fraction += '0';
      if (opts.useGrouping !== false) {
        integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }
      // A value that rounds to zero is shown unsigned, as browsers do.
      const sign = value < 0 && Number(fixed) !== 0 ? '-' : '';
      return sign + integer + (fraction ? `.${fraction}` : '');
    },
  );
}
