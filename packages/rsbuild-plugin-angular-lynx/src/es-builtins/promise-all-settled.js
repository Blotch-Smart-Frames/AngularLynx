import { definePolyfills } from './shared.js';

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
});
