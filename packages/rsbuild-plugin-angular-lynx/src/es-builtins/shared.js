/**
 * What the built-ins in this folder share: how each is defined, and the
 * spec's abstract operations that more than one of them uses.
 *
 * Each other file in the folder adds one built-in, or a few that come
 * together, which Lynx's JavaScript engines lack. The build imports a file at
 * the top of each module that names one of its methods (es-builtins.ts), so
 * an app carries only the ones its code can call. They're ES modules with no
 * imports but this one, so the tests can bundle them into a script and run it
 * in a fresh realm (es-builtins.test.ts).
 *
 * Each method is added only where it's missing, so the web build (a browser,
 * which has them all) keeps its own. They're non-enumerable like the built-ins,
 * so a `for...in` over an array or string doesn't pick them up, and written as
 * object literal methods, so they have the built-ins' names and lengths and
 * can't be called with `new`. ES modules are strict, so a method called on
 * null or a primitive sees that value rather than the global object or a
 * wrapper.
 */

/**
 * Defines `name` unconditionally; also used to replace a method that exists
 * but is inadequate (see number-to-locale-string.js).
 */
export const definePolyfillOverride = (target, name, value) => {
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
export const definePolyfills = (target, methods) => {
  for (const name of Object.keys(methods)) {
    definePolyfill(target, name, methods[name]);
  }
};

export const isObject = (value) =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';
export const requireCallable = (value) => {
  if (typeof value !== 'function') throw new TypeError('Expected a function');
  return value;
};
export const toObject = (value) => {
  if (value == null) {
    throw new TypeError('Cannot convert undefined or null to object');
  }
  return Object(value);
};
export const toThisString = (value) => String(toObject(value));
/**
 * ToIntegerOrInfinity: NaN (and so `undefined`) becomes 0, the fraction is
 * dropped toward zero, and a BigInt or Symbol throws, as unary plus does.
 */
export const toIntegerOrInfinity = (value) => Math.trunc(+value) || 0;
/**
 * LengthOfArrayLike
 */
export const lengthOf = (object) =>
  Math.min(
    Math.max(toIntegerOrInfinity(object.length), 0),
    Number.MAX_SAFE_INTEGER,
  );
/**
 * IsConstructor, without calling it: Reflect.construct throws when the new
 * target isn't a constructor.
 */
export const isConstructor = (value) => {
  if (typeof value !== 'function') return false;
  try {
    Reflect.construct(String, [], value);
    return true;
  } catch {
    return false;
  }
};
export const createDataProperty = (object, key, value) => {
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
export const iteratorRecord = (iterator) => ({ iterator, next: iterator.next });
// What stepValue returns once the iterator is done.
export const DONE = {};
export const stepValue = (record) => {
  const result = record.next.call(record.iterator);
  if (!isObject(result))
    throw new TypeError('Iterator result is not an object');
  return result.done ? DONE : result.value;
};
/**
 * Closing after a normal completion: return() must return an object.
 */
export const closeIterator = (iterator) => {
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
export const closeAndThrow = (iterator, error) => {
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
export const relativeIndex = (object, index) => {
  const length = lengthOf(object);
  let n = toIntegerOrInfinity(index);
  if (n < 0) n += length;
  if (n < 0 || n >= length) return undefined;
  return typeof object === 'string' ? object.charAt(n) : object[n];
};

export const requireComparator = (comparator) => {
  if (comparator !== undefined && typeof comparator !== 'function') {
    throw new TypeError('The comparison function must be a function');
  }
};
/**
 * ArrayCreate: an array of `length` holes, which throws a RangeError past
 * 2^32 - 1 as the spec does.
 */
export const createArray = (length) => {
  const array = [];
  array.length = length;
  return array;
};
export const copyArrayLike = (object, length) => {
  const copy = createArray(length);
  for (let index = 0; index < length; index++) copy[index] = object[index];
  return copy;
};
export const actualIndex = (index, length) => {
  const relative = toIntegerOrInfinity(index);
  const actual = relative < 0 ? length + relative : relative;
  if (actual < 0 || actual >= length) throw new RangeError('Invalid index');
  return actual;
};

// %TypedArray%.prototype, the shared parent of Float64Array.prototype and the
// rest, where the typed arrays' methods live.
export const TypedArrayPrototype =
  typeof Int8Array === 'function'
    ? Object.getPrototypeOf(Int8Array.prototype)
    : undefined;
// These read a typed array's own name and length, which a subclass can't
// override, and return undefined for anything that isn't one.
export const typedArrayName =
  TypedArrayPrototype &&
  Object.getOwnPropertyDescriptor(TypedArrayPrototype, Symbol.toStringTag).get;
export const typedArrayLength =
  TypedArrayPrototype &&
  Object.getOwnPropertyDescriptor(TypedArrayPrototype, 'length').get;
/**
 * TypedArrayCreateSameType: the copy is the receiver's own kind (a Float64Array
 * for a Float64Array), never a subclass.
 */
export const typedArrayKind = (value) => {
  const name = typedArrayName.call(value);
  if (name === undefined) throw new TypeError('Expected a typed array');
  return globalThis[name];
};

/**
 * NewPromiseCapability: a promise of the constructor's kind, with the functions
 * that settle it.
 */
export const promiseCapability = (Constructor) => {
  let resolve;
  let reject;
  const promise = new Constructor((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
};
