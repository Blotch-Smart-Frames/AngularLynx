import { definePolyfills, promiseCapability } from './shared.js';

// ES2024 Promise.withResolvers.
definePolyfills(Promise, {
  withResolvers() {
    return promiseCapability(this);
  },
});
