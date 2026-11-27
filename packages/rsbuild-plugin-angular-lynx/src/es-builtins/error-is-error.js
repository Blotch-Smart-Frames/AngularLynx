import { definePolyfills, isObject } from './shared.js';

// ES2026 Error.isError. Only the engine can tell whether an Error constructor
// made an object (its [[ErrorData]] slot). Object.prototype.toString reports
// that mark as '[object Error]', unless the object's Symbol.toStringTag is a
// string, which no built-in error has but a class can add. For a tagged
// object, inheriting from Error.prototype is the closest test left: a tagged
// error is still an error, and an object that's only tagged 'Error' isn't.
// It's an approximation either way: a tagged object made with
// Object.create(Error.prototype) counts as an error, which the native method
// says it isn't. And an untagged object's tag is read twice, here and by
// toString, which is the only way to read the mark.
definePolyfills(Error, {
  isError(value) {
    if (!isObject(value)) return false;
    const tag = value[Symbol.toStringTag];
    return typeof tag === 'string'
      ? Error.prototype.isPrototypeOf(value)
      : Object.prototype.toString.call(value) === '[object Error]';
  },
});
