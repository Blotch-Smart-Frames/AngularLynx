import {
  call,
  definePolyfills,
  promiseCapability,
  requireCallable,
} from './shared.js';

// ES2021 Promise.any.
definePolyfills(Promise, {
  any(promises) {
    // Destructured, so each function is called with no `this`, as the spec
    // calls them: a custom constructor's resolve and reject can tell.
    const { promise: result, resolve, reject } = promiseCapability(this);
    try {
      const promiseResolve = requireCallable(this.resolve);
      const errors = [];
      // One more than the promises still pending, until all are counted.
      let remaining = 1;
      const rejectIfAllRejected = () => {
        if (--remaining === 0) {
          // Both of Lynx's threads have AggregateError.
          reject(new AggregateError(errors, 'All promises were rejected'));
        }
      };
      for (const promise of promises) {
        const index = errors.length;
        errors.push(undefined);
        remaining++;
        let rejected = false;
        call(promiseResolve, this, promise).then(resolve, (error) => {
          if (rejected) return;
          rejected = true;
          errors[index] = error;
          rejectIfAllRejected();
        });
      }
      rejectIfAllRejected();
    } catch (error) {
      reject(error);
    }
    return result;
  },
});
