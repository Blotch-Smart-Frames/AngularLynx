import { definePolyfills, promiseCapability } from './shared.js';

// ES2025 Promise.try.
definePolyfills(Promise, {
  try(callback, ...args) {
    // Destructured, so each function is called with no `this`, as the spec
    // calls them: a custom constructor's resolve and reject can tell.
    const { promise, resolve, reject } = promiseCapability(this);
    let value;
    try {
      value = callback(...args);
    } catch (error) {
      reject(error);
      return promise;
    }
    resolve(value);
    return promise;
  },
});
