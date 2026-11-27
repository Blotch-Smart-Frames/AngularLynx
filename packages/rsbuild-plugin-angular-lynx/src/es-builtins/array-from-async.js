import {
  definePolyfills,
  isObject,
  requireCallable,
  lengthOf,
  isConstructor,
  createDataProperty,
  createArray,
} from './shared.js';

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
      // Iterated by hand rather than with `for await`. From @rspack/core
      // 2.2.9, SWC lowers `for await` even at the main thread's ES2019
      // target, through a helper it adds to the file: imported from
      // `@swc/helpers`, which this package's folder may not resolve, or, in a
      // file compiled as a script, by `require()`, which a strict ES module
      // doesn't define (the main thread threw as it loaded, when this was a
      // script). Written out, it needs no helper however it's compiled.
      const iterator = items[Symbol.asyncIterator]();
      if (!isObject(iterator)) {
        throw new TypeError('Async iterator is not an object');
      }
      const next = iterator.next;
      for (;;) {
        const step = await next.call(iterator);
        if (!isObject(step)) {
          throw new TypeError('Iterator result is not an object');
        }
        if (step.done) break;
        try {
          await add(step.value);
        } catch (error) {
          // As `for await` does: close the iterator, and throw this error
          // whatever return() does.
          try {
            const method = iterator.return;
            if (method != null) await method.call(iterator);
          } catch {
            // The original error is the one to report.
          }
          throw error;
        }
      }
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
