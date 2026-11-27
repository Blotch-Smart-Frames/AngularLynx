import {
  call,
  closeAndThrow,
  definePolyfills,
  isObject,
  requireCallable,
  lengthOf,
  isConstructor,
  createDataProperty,
  createArray,
} from './shared.js';

/**
 * GetMethod: undefined for undefined or null, which mean "no method".
 */
const getMethod = (object, key) => {
  const method = object[key];
  return method == null ? undefined : requireCallable(method);
};
/**
 * AsyncIteratorClose after an error: waits for return() to settle, then
 * throws the error whatever it did.
 */
const closeAsyncAndThrow = async (iterator, error) => {
  try {
    const method = iterator.return;
    if (method != null) await call(method, iterator);
  } catch {
    // The original error is the one to report.
  }
  throw error;
};
/**
 * The same for a sync iterator, as the spec's async-from-sync iterator closes
 * one: it reads return()'s result as a step, and waits for its value.
 */
const closeSyncAndThrow = async (iterator, error) => {
  try {
    const method = iterator.return;
    if (method != null) {
      const result = call(method, iterator);
      if (isObject(result)) {
        // Reading `done` is a step of its own, which a getter can see.
        // oxlint-disable-next-line no-unused-expressions
        result.done;
        await result.value;
      }
    }
  } catch {
    // The original error is the one to report.
  }
  throw error;
};

/**
 * ES2026 Array.fromAsync: an async version of Array.from. It reads an async
 * iterable as it is, and awaits each value of a sync iterable or array-like.
 */
const fromAsync = async (Constructor, items, mapper, thisArg) => {
  if (mapper !== undefined) requireCallable(mapper);
  // Each method is read once. Reading them throws the TypeError the spec does
  // for undefined or null.
  const asyncMethod = getMethod(items, Symbol.asyncIterator);
  const isAsync = asyncMethod !== undefined;
  const method = isAsync ? asyncMethod : getMethod(items, Symbol.iterator);
  if (method !== undefined) {
    const result = isConstructor(Constructor) ? new Constructor() : [];
    // Iterated by hand rather than with `for await` or `for...of`. From
    // @rspack/core 2.2.9, SWC lowers `for await` even at the main thread's
    // ES2019 target, through a helper it adds to the file: imported from
    // `@swc/helpers`, which this package's folder may not resolve, or, in a
    // file compiled as a script, by `require()`, which a strict ES module
    // doesn't define (the main thread threw as it loaded, when this was a
    // script). Written out, it needs no helper however it's compiled. And
    // PrimJS's `for await` doesn't await a sync iterable's values, as the
    // spec's async-from-sync iterator does; `for...of` would skip the last
    // step's value, which that iterator reads, and close the iterator
    // without waiting for return().
    const iterator = call(method, items);
    if (!isObject(iterator)) throw new TypeError('Iterator is not an object');
    const next = iterator.next;
    const closeAfter = isAsync ? closeAsyncAndThrow : closeSyncAndThrow;
    let index = 0;
    for (; ; index++) {
      // A step that fails, as next() or reading the result, doesn't close
      // the iterator: the spec closes it only for what comes after.
      let value;
      if (isAsync) {
        const step = await call(next, iterator);
        if (!isObject(step)) {
          throw new TypeError('Iterator result is not an object');
        }
        if (step.done) break;
        value = step.value;
      } else {
        const step = call(next, iterator);
        if (!isObject(step)) {
          throw new TypeError('Iterator result is not an object');
        }
        const done = !!step.done;
        const stepValue = step.value;
        try {
          value = await stepValue;
        } catch (error) {
          // A rejected value closes the iterator, unless it's the last
          // step's.
          if (!done) closeAndThrow(iterator, error);
          throw error;
        }
        if (done) break;
      }
      try {
        createDataProperty(
          result,
          index,
          mapper === undefined
            ? value
            : await call(mapper, thisArg, value, index),
        );
      } catch (error) {
        await closeAfter(iterator, error);
      }
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
      mapper === undefined ? value : await call(mapper, thisArg, value, index),
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
