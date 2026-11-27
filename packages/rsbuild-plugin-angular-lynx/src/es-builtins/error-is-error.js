import { definePolyfills, isObject } from './shared.js';

// ES2026 Error.isError. Only the engine can tell whether an Error constructor
// made an object, but Object.prototype.toString reports the same mark unless
// the object sets Symbol.toStringTag, which errors don't.
definePolyfills(Error, {
  isError(value) {
    return (
      isObject(value) &&
      Object.prototype.toString.call(value) === '[object Error]'
    );
  },
});
