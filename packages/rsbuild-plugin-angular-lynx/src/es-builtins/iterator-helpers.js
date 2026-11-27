import {
  definePolyfillOverride,
  definePolyfills,
  isObject,
  requireCallable,
  toIntegerOrInfinity,
  iteratorRecord,
  DONE,
  stepValue,
  closeIterator,
  closeAndThrow,
} from './shared.js';

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
