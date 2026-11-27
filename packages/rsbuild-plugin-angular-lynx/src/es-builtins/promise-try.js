import { definePolyfills, promiseCapability } from './shared.js';

// ES2025 Promise.try.
definePolyfills(Promise, {
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
