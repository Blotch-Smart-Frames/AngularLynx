import {
  definePolyfills,
  promiseCapability,
  requireCallable,
} from './shared.js';

// ES2021 Promise.any.
definePolyfills(Promise, {
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
});
