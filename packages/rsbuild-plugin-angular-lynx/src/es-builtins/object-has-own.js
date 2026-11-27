import { definePolyfills, toObject } from './shared.js';

// ES2022 Object.hasOwn.
definePolyfills(Object, {
  // Angular 22's getSimpleChangesStore (ngOnChanges lifecycle machinery) uses
  // Object.hasOwn() to check if a SimpleChanges store is already attached to
  // the directive instance. Without it, any component or directive that
  // implements ngOnChanges (including FormField from @angular/forms/signals)
  // crashes at instantiation with "Object.hasOwn is not a function".
  hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(toObject(object), key);
  },
});
